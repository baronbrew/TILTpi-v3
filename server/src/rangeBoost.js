// "Boost Range with Multiple Tilt Pi's": poll other Tilt Pis' /tiltscan and feed their raw scans
// into our pipeline as if we had heard them ourselves.
import dns from 'node:dns';
import { HOSTNAME_RE } from './system/system.js';

export const POLL_MS = 2500;
export const MAX_RANGERS = 4;
// Name lookups are done separately from the 5 s fetch timeout and cached: a failing ".local" lookup
// takes ~5 s and they queue behind each other, so with one dead ranger configured the lookups for
// working rangers ran past the fetch timeout and every ranger failed. A failed host is retried
// every 30 s instead of every poll.
export const RETRY_FAILED_MS = 30000;
export const LOOKUP_CACHE_MS = 5 * 60000;

export const rangerUrl = (host) => 'http://' + host + ':1880/tiltscan';

export class RangeBooster {
  /** @param {{settings:import('./settings.js').Settings, onScan:(scan:object)=>void}} deps */
  constructor({ settings, onScan, onStatus = () => {}, fetchImpl = fetch, lookup = dnsLookup }) {
    this.lookup = lookup;
    this.addresses = {}; // name -> { address, until }
    this.settings = settings;
    this.onScan = onScan;
    this.onStatus = onStatus;
    this.fetch = fetchImpl;
    this.timer = null;
    /** hostname -> true (last poll answered) / false (failed). Absent = not checked yet. */
    this.status = {};
    this.useLocal = {}; // hostname -> true when "<name>.local" is the form that answers
    this.busy = new Set();
    this.retryAt = {}; // hostname -> time before which a failed host isn't polled again
  }

  #setStatus(host, ok, err) {
    if (this.status[host] === ok) return;
    this.status[host] = ok;
    if (ok) console.log(`[range] ${host}: connected (${this.urlFor(host)})`);
    else console.warn(`[range] ${host}: connection failed:`, err?.cause?.code ?? err?.message ?? err);
    this.onStatus();
  }

  start() {
    if (this.settings.global.enableRangeBoost) this.#startPolling();
  }

  setEnabled(enabled) {
    this.settings.setGlobal({ enableRangeBoost: !!enabled });
    if (enabled) this.#startPolling();
    else this.stop();
  }

  /** Add the hostname (newest first, max 4: the oldest drops off, as in legacy). */
  addHostname(name) {
    if (!HOSTNAME_RE.test(name)) return false;
    const list = (this.settings.global.rangerHostnames ?? []).filter((h) => h !== name);
    list.unshift(name);
    delete this.retryAt[name]; // re-adding checks it right away
    this.settings.setGlobal({ rangerHostnames: list.slice(0, MAX_RANGERS) });
    this.pollOnce();
    return true;
  }

  removeHostname(name) {
    delete this.status[name];
    delete this.retryAt[name];
    const list = this.settings.global.rangerHostnames ?? [];
    this.settings.setGlobal({ rangerHostnames: list.filter((h) => h !== name) });
  }

  /** Legacy text box: add the hostname, or remove it when already present. */
  toggleHostname(name) {
    if ((this.settings.global.rangerHostnames ?? []).includes(name)) {
      this.removeHostname(name);
      return true;
    }
    return this.addHostname(name);
  }

  #startPolling() {
    if (this.timer) return;
    this.pollOnce();
    this.timer = setInterval(() => this.pollOnce(), POLL_MS);
  }

  /**
   * URL currently used for a ranger. Bare names (legacy: "tiltpi-north") only resolve when the
   * router's DNS knows Pi hostnames, so if one fails we also try "<name>.local" (mDNS) and keep
   * whichever answered.
   */
  #name(host) {
    return this.useLocal[host] ? host + '.local' : host;
  }

  urlFor(host) {
    return rangerUrl(this.#name(host));
  }

  async #address(name) {
    const hit = this.addresses[name];
    if (hit && Date.now() < hit.until) return hit.address;
    const address = await this.lookup(name);
    this.addresses[name] = { address, until: Date.now() + LOOKUP_CACHE_MS };
    return address;
  }

  async #fetchScans(name) {
    let address;
    try {
      address = await this.#address(name);
    } catch (err) {
      throw new Error(`${name} not found (${err.code ?? err.message})`);
    }
    const r = await this.fetch(rangerUrl(address), { signal: AbortSignal.timeout(POLL_MS * 2) }).catch((err) => {
      delete this.addresses[name]; // the Pi may have a new address: look it up again next time
      throw err;
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const scans = await r.json();
    if (!Array.isArray(scans)) throw new Error('not a /tiltscan reply');
    return scans;
  }

  async #pollHost(host) {
    if (this.busy.has(host)) return; // previous attempt (incl. fallback) still running
    if (Date.now() < (this.retryAt[host] ?? 0)) return;
    this.busy.add(host);
    try {
      let scans;
      try {
        scans = await this.#fetchScans(this.#name(host));
      } catch (err) {
        if (host.includes('.')) throw err; // already qualified (name.local, IP address...)
        this.useLocal[host] = !this.useLocal[host];
        scans = await this.#fetchScans(this.#name(host));
      }
      delete this.retryAt[host];
      this.#setStatus(host, true);
      for (const s of scans) this.onScan(s);
    } catch (err) {
      this.retryAt[host] = Date.now() + RETRY_FAILED_MS;
      this.#setStatus(host, false, err); // unreachable rangers are otherwise ignored
    } finally {
      this.busy.delete(host);
    }
  }

  pollOnce() {
    for (const host of this.settings.global.rangerHostnames ?? []) this.#pollHost(host);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.status = {}; // not polling: status unknown
    this.onStatus();
  }
}

/** IPv4 address for a hostname (IP addresses come back unchanged). */
async function dnsLookup(name) {
  return (await dns.promises.lookup(name, { family: 4 })).address;
}
