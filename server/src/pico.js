// "Boost Range with Tilt Pico's": Tilt Picos (Bluetooth-to-WiFi bridges) advertise their IP
// address as an iBeacon, so they're discovered by scanning like a Tilt. Each one the user turns on
// is polled every 5 s (GET http://<ip>/, the Pico's Tilt scan list) and its Tilt readings are fed
// into the pipeline as if heard here. Modeled on Range Booster, but by IP (the Pico's hostname
// isn't reliable).
//
// Beacon (Tilt-Hydrometer-Framework7 app.js / Tilt-Pico-2 firmware):
//   uuid a495bc02-c5b1-4b44-b512-1370f02d74de
//   major/minor = IPv4 address as two 16-bit numbers (192.168 / 0.48 → 49320 / 48)
//   major 999 + minor 999/998/997 = Pico in WiFi setup / NTP failed / WiFi failed (no IP yet)
// GET /info returns {tilt_pico_mac_address: WiFi MAC, ...}; on the Pico W the Bluetooth MAC (the
// beacon's address) is the WiFi MAC + 1, e.g. WiFi 28:CD:C1:0D:B8:30 → Bluetooth 28:cd:c1:0d:b8:31.
// GET / returns [{uuid, mac, major, minor, tx_power, rssi, timestamp}, ...]; the Pico keeps a
// Tilt in that list for 120 s after last hearing it, so an entry is only used when its
// timestamp changed (otherwise a Tilt that left would look alive for two more minutes).

export const PICO_UUID = 'a495bc02c5b14b44b5121370f02d74de';
export const POLL_MS = 5000;
const FETCH_TIMEOUT_MS = 4500; // the Pico scans ~1-2 s before answering
const VERIFY_EVERY_MS = 10 * 60000; // re-check who answers at a Pico's address

/** Pico list entry → the scan format our radio produces (mac "aa:bb:..", tx_power signed int8). */
export function scanFromPico(e) {
  const hex = String(e.mac ?? '').toLowerCase().replace(/[^0-9a-f]/g, '');
  const mac = hex.length === 12 ? hex.match(/../g).join(':') : String(e.mac ?? '').toLowerCase();
  let tx = Number(e.tx_power); // the Pico sends the unsigned byte as text, e.g. "153"
  if (tx > 127) tx -= 256;
  return { uuid: String(e.uuid).toLowerCase(), major: Number(e.major), minor: Number(e.minor), tx_power: tx, rssi: Number(e.rssi), mac };
}

export const isPicoUuid = (uuid) => String(uuid).toLowerCase().replace(/-/g, '') === PICO_UUID;

/** IPv4 address from the beacon's major/minor, or null (setup/status codes, non-LAN). */
export function picoIpFromBeacon(major, minor) {
  if (major === 999 && minor >= 997 && minor <= 999) return null;
  const ip = [(major >> 8) & 0xff, major & 0xff, (minor >> 8) & 0xff, minor & 0xff];
  const lan = ip[0] === 10 || (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31) || (ip[0] === 192 && ip[1] === 168);
  return lan ? ip.join('.') : null;
}

/** "28:CD:C1:0D:B8:30" → "28:cd:c1:0d:b8:31" (the Pico W's Bluetooth MAC from its WiFi MAC). */
export function bluetoothMacFromWifi(wifiMac) {
  const hex = String(wifiMac ?? '').toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12) return null;
  const n = (BigInt('0x' + hex) + 1n) & 0xffffffffffffn;
  return n.toString(16).padStart(12, '0').match(/../g).join(':');
}

/**
 * Saved state (settings.global):
 *   knownPicos: { [bluetooth mac]: { ip, wifiMac? } }  every Pico discovered: last good IP (null =
 *               another device took it, waiting for its beacon), WiFi MAC once confirmed
 *   tiltPicos:  { [bluetooth mac]: { ip } }            the ones turned on (polled)
 * A Pico is identified by its Bluetooth MAC, and the device answering at its IP is checked
 * (GET /info) before its readings are used, so a reused address never feeds another device's data.
 */
export class PicoBooster {
  /**
   * @param {{settings:any, onScan:(scan:object)=>void, onChange?:()=>void, fetchImpl?:typeof fetch,
   *   now?:()=>number}} deps
   */
  constructor({ settings, onScan, onChange = () => {}, fetchImpl = fetch, now = Date.now }) {
    this.settings = settings;
    this.onScan = onScan;
    this.onChange = onChange;
    this.fetch = fetchImpl;
    this.now = now;
    this.seen = new Map(); // mac -> { mac, ip, rssi, lastSeen }   (beacons heard this run)
    this.status = {}; // mac -> true (last poll answered) / false (failed)
    this.problem = {}; // mac -> text shown in the list when status is false
    this.verified = new Map(); // mac -> { ip, at }: identity confirmed at this IP
    this.lastTimestamp = new Map(); // `${mac}|${tiltMac}|${uuid}` -> Pico entry timestamp
    this.busy = new Set();
    this.timer = null;
  }

  /** Saved Picos that are turned on: { [mac]: { ip } } */
  get enabled() {
    return this.settings.global.tiltPicos ?? {};
  }

  /** Every Pico discovered so far: { [mac]: { ip, wifiMac? } } */
  get known() {
    return this.settings.global.knownPicos ?? {};
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.pollAll(), POLL_MS);
    this.timer.unref?.();
    this.pollAll();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Change a Pico's saved address (null = unknown) in both lists. */
  #setIp(mac, ip) {
    const patch = {};
    if ((this.known[mac]?.ip ?? null) !== ip) patch.knownPicos = { ...this.known, [mac]: { ...this.known[mac], ip } };
    if (this.enabled[mac] && this.enabled[mac].ip !== ip) patch.tiltPicos = { ...this.enabled, [mac]: { ...this.enabled[mac], ip } };
    if (Object.keys(patch).length) this.settings.setGlobal(patch);
    this.verified.delete(mac);
  }

  /** A Pico beacon was heard (here or via a Range Booster Pi). */
  noteBeacon(scan) {
    const ip = picoIpFromBeacon(scan.major, scan.minor);
    if (!ip) return;
    const mac = String(scan.mac).toLowerCase();
    const prev = this.seen.get(mac);
    this.seen.set(mac, { mac, ip, rssi: scan.rssi, lastSeen: this.now() });
    // This Pico has this address now: any other Pico saved with it loses it (no two share an IP).
    for (const other of new Set([...Object.keys(this.known), ...Object.keys(this.enabled)])) {
      if (other === mac) continue;
      if (this.known[other]?.ip === ip || this.enabled[other]?.ip === ip) {
        console.log(`[pico] ${ip} now belongs to ${mac}; ${other} will wait for its own beacon`);
        this.#setIp(other, null);
        this.seen.delete(other);
        this.onChange();
      }
    }
    const moved = (this.known[mac]?.ip ?? null) !== ip || (this.enabled[mac] && this.enabled[mac].ip !== ip);
    if (!this.known[mac]) console.log(`[pico] discovered ${mac} at ${ip}`);
    else if (moved) console.log(`[pico] ${mac} moved to ${ip}`);
    if (!this.known[mac] || moved) {
      this.#setIp(mac, ip);
      if (this.problem[mac]) {
        delete this.problem[mac];
        delete this.status[mac];
      }
    }
    if (!prev || prev.ip !== ip) this.onChange();
  }

  setEnabled(mac, on) {
    mac = String(mac).toLowerCase();
    const list = { ...this.enabled };
    if (on) {
      const ip = this.seen.get(mac)?.ip ?? list[mac]?.ip ?? this.known[mac]?.ip;
      if (!ip) return false;
      list[mac] = { ip };
    } else {
      delete list[mac];
      delete this.status[mac];
      delete this.problem[mac];
    }
    this.settings.setGlobal({ tiltPicos: list });
    if (on) this.#poll(mac);
    return true;
  }

  /** Remove a Pico that's turned off from the list (e.g. one that's gone for good). */
  forget(mac) {
    mac = String(mac).toLowerCase();
    if (this.enabled[mac]) return false;
    const known = { ...this.known };
    delete known[mac];
    this.settings.setGlobal({ knownPicos: known });
    this.seen.delete(mac);
    this.verified.delete(mac);
    delete this.status[mac];
    delete this.problem[mac];
    console.log(`[pico] forgot ${mac}`);
    this.onChange();
    return true;
  }

  /** For the System tab: every Pico discovered (saved) or heard, by IP. */
  list() {
    const now = this.now();
    const macs = new Set([...Object.keys(this.known), ...Object.keys(this.enabled), ...this.seen.keys()]);
    return [...macs]
      .map((mac) => {
        const s = this.seen.get(mac);
        const saved = this.enabled[mac];
        return {
          mac,
          ip: s?.ip ?? saved?.ip ?? this.known[mac]?.ip ?? null, // null: waiting for its beacon
          enabled: !!saved,
          status: saved ? this.status[mac] : undefined, // true / false / undefined (not polled yet)
          problem: saved && this.status[mac] === false ? (this.problem[mac] ?? 'Connection failed') : null,
          heard: s ? Math.round((now - s.lastSeen) / 1000) : null, // seconds since beacon, null = not this run
          rssi: s?.rssi ?? null,
        };
      })
      .sort((a, b) =>
        a.ip === null || b.ip === null
          ? (a.ip === null) - (b.ip === null) // ones waiting for their beacon last
          : a.ip.localeCompare(b.ip, undefined, { numeric: true }),
      );
  }

  pollAll() {
    for (const mac of Object.keys(this.enabled)) this.#poll(mac);
  }

  /**
   * Is the device at `ip` this Pico? 'yes' | 'no' | 'unknown' (older firmware without /info).
   * Accepted: the WiFi MAC saved from an earlier check; else WiFi MAC + 1 = this Bluetooth MAC; else
   * (unusual MAC pairing) this run's beacon from this Pico announced this IP.
   */
  async #identify(mac, ip) {
    let info;
    try {
      const r = await this.fetch(`http://${ip}/info`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!r.ok) return 'unknown';
      info = await r.json();
    } catch (err) {
      if (err?.name === 'SyntaxError') return 'unknown';
      throw err; // unreachable: reported as a connection failure
    }
    const wifiMac = String(info?.tilt_pico_mac_address ?? '').toLowerCase();
    if (!wifiMac) return 'unknown';
    const savedWifi = this.known[mac]?.wifiMac;
    const ok = savedWifi ? savedWifi === wifiMac : bluetoothMacFromWifi(wifiMac) === mac || this.seen.get(mac)?.ip === ip;
    if (ok && !savedWifi) this.settings.setGlobal({ knownPicos: { ...this.known, [mac]: { ...this.known[mac], ip, wifiMac } } });
    return ok ? 'yes' : 'no';
  }

  async #poll(mac) {
    const ip = this.enabled[mac]?.ip;
    if (!ip || this.busy.has(mac)) return;
    this.busy.add(mac);
    try {
      const v = this.verified.get(mac);
      if (!v || v.ip !== ip || this.now() - v.at > VERIFY_EVERY_MS) {
        if ((await this.#identify(mac, ip)) === 'no') {
          // A different device has this address now: stop using it until this Pico's beacon is heard.
          this.#setIp(mac, null);
          this.#setStatus(mac, false, null, 'Another device has its last address; waiting for its beacon');
          return;
        }
        this.verified.set(mac, { ip, at: this.now() });
      }
      const r = await this.fetch(`http://${ip}/`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const list = await r.json();
      if (!Array.isArray(list)) throw new Error('not a Tilt Pico scan list');
      this.#setStatus(mac, true);
      for (const e of list) {
        if (!e || typeof e.uuid !== 'string') continue;
        if (e.timestamp !== undefined) {
          const key = `${mac}|${e.mac}|${e.uuid}`;
          if (this.lastTimestamp.get(key) === e.timestamp) continue; // not a new reading
          this.lastTimestamp.set(key, e.timestamp);
        }
        this.onScan(scanFromPico(e));
      }
    } catch (err) {
      this.verified.delete(mac); // check who answers again once it's reachable
      this.#setStatus(mac, false, err, 'Connection failed');
    } finally {
      this.busy.delete(mac);
    }
  }

  #setStatus(mac, ok, err, problem) {
    const changed = this.status[mac] !== ok || (!ok && this.problem[mac] !== problem);
    this.status[mac] = ok;
    if (ok) delete this.problem[mac];
    else this.problem[mac] = problem;
    if (!changed) return;
    const ip = this.enabled[mac]?.ip;
    if (ok) console.log(`[pico] ${ip}: connected`);
    else console.warn(`[pico] ${ip ?? mac}: ${problem}`, err ? `(${err?.cause?.code ?? err?.message ?? err})` : '');
    this.onChange();
  }
}
