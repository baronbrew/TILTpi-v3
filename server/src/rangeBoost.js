// "Boost Range with Multiple Tilt Pi's": poll other Tilt Pis' /tiltscan and feed their raw scans
// into our pipeline as if we had heard them ourselves.
import { HOSTNAME_RE } from './system/system.js';

export const POLL_MS = 2500;
export const MAX_RANGERS = 4;

export const rangerUrl = (host) => 'http://' + host + ':1880/tiltscan';

export class RangeBooster {
  /** @param {{settings:import('./settings.js').Settings, onScan:(scan:object)=>void}} deps */
  constructor({ settings, onScan, onStatus = () => {}, fetchImpl = fetch }) {
    this.settings = settings;
    this.onScan = onScan;
    this.onStatus = onStatus;
    this.fetch = fetchImpl;
    this.timer = null;
    /** hostname -> true (last poll answered) / false (failed). Absent = not checked yet. */
    this.status = {};
    this.useLocal = {}; // hostname -> true when "<name>.local" is the form that answers
    this.busy = new Set();
  }

  #setStatus(host, ok) {
    if (this.status[host] === ok) return;
    this.status[host] = ok;
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
    this.settings.setGlobal({ rangerHostnames: list.slice(0, MAX_RANGERS) });
    this.pollOnce();
    return true;
  }

  removeHostname(name) {
    delete this.status[name];
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
  urlFor(host) {
    return rangerUrl(this.useLocal[host] ? host + '.local' : host);
  }

  async #fetchScans(url) {
    const r = await this.fetch(url, { signal: AbortSignal.timeout(POLL_MS * 2) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const scans = await r.json();
    if (!Array.isArray(scans)) throw new Error('not a /tiltscan reply');
    return scans;
  }

  async #pollHost(host) {
    if (this.busy.has(host)) return; // previous attempt (incl. fallback) still running
    this.busy.add(host);
    try {
      let scans;
      try {
        scans = await this.#fetchScans(this.urlFor(host));
      } catch (err) {
        if (host.includes('.')) throw err; // already qualified (name.local, IP address...)
        this.useLocal[host] = !this.useLocal[host];
        scans = await this.#fetchScans(this.urlFor(host));
      }
      this.#setStatus(host, true);
      for (const s of scans) this.onScan(s);
    } catch {
      this.#setStatus(host, false); // unreachable rangers are otherwise ignored
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
