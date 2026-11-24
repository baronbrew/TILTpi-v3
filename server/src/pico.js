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
// GET / returns [{uuid, mac, major, minor, tx_power, rssi, timestamp}, ...]; the Pico keeps a
// Tilt in that list for 120 s after last hearing it, so an entry is only used when its
// timestamp changed (otherwise a Tilt that left would look alive for two more minutes).

export const PICO_UUID = 'a495bc02c5b14b44b5121370f02d74de';
export const POLL_MS = 5000;
const FETCH_TIMEOUT_MS = 4500; // the Pico scans ~1-2 s before answering

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
    // Every Pico ever discovered is saved with its last good IP (settings.global.knownPicos), so
    // the list keeps it, and it can be turned on, even when its beacon isn't being heard.
    this.status = {}; // mac -> true (last poll answered) / false (failed)
    this.lastTimestamp = new Map(); // `${mac}|${tiltMac}|${uuid}` -> Pico entry timestamp
    this.busy = new Set();
    this.timer = null;
  }

  /** Saved Picos that are turned on: { [mac]: { ip } } */
  get enabled() {
    return this.settings.global.tiltPicos ?? {};
  }

  /** Every Pico discovered so far, with its last good IP: { [mac]: { ip } } */
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

  /** A Pico beacon was heard (here or via a Range Booster Pi). */
  noteBeacon(scan) {
    const ip = picoIpFromBeacon(scan.major, scan.minor);
    if (!ip) return;
    const mac = String(scan.mac).toLowerCase();
    const prev = this.seen.get(mac);
    this.seen.set(mac, { mac, ip, rssi: scan.rssi, lastSeen: this.now() });
    const saved = this.enabled[mac];
    if (saved && saved.ip !== ip) {
      // DHCP gave the Pico a new address: follow it.
      this.settings.setGlobal({ tiltPicos: { ...this.enabled, [mac]: { ...saved, ip } } });
      console.log(`[pico] ${mac} moved to ${ip}`);
    }
    if (this.known[mac]?.ip !== ip) {
      if (!this.known[mac]) console.log(`[pico] discovered ${mac} at ${ip}`);
      this.settings.setGlobal({ knownPicos: { ...this.known, [mac]: { ip } } });
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
    }
    this.settings.setGlobal({ tiltPicos: list });
    if (on) this.#poll(mac);
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
          ip: s?.ip ?? saved?.ip ?? this.known[mac]?.ip,
          enabled: !!saved,
          status: saved ? this.status[mac] : undefined, // true / false / undefined (not polled yet)
          heard: s ? Math.round((now - s.lastSeen) / 1000) : null, // seconds since beacon, null = not this run
          rssi: s?.rssi ?? null,
        };
      })
      .sort((a, b) => String(a.ip).localeCompare(String(b.ip), undefined, { numeric: true }));
  }

  pollAll() {
    for (const mac of Object.keys(this.enabled)) this.#poll(mac);
  }

  async #poll(mac) {
    const ip = this.enabled[mac]?.ip;
    if (!ip || this.busy.has(mac)) return;
    this.busy.add(mac);
    try {
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
      this.#setStatus(mac, false, err);
    } finally {
      this.busy.delete(mac);
    }
  }

  #setStatus(mac, ok, err) {
    if (this.status[mac] === ok) return;
    this.status[mac] = ok;
    const ip = this.enabled[mac]?.ip;
    if (ok) console.log(`[pico] ${ip}: connected`);
    else console.warn(`[pico] ${ip}: connection failed:`, err?.cause?.code ?? err?.message ?? err);
    this.onChange();
  }
}
