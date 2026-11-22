// "Boost Range with Multiple Tilt Pi's": poll other Tilt Pis' /tiltscan and feed their raw scans
// into our pipeline as if we had heard them ourselves.
import { HOSTNAME_RE } from './system/system.js';

export const POLL_MS = 2500;
export const MAX_RANGERS = 4;

export const rangerUrl = (host) => 'http://' + host + ':1880/tiltscan';

export class RangeBooster {
  /** @param {{settings:import('./settings.js').Settings, onScan:(scan:object)=>void}} deps */
  constructor({ settings, onScan, fetchImpl = fetch }) {
    this.settings = settings;
    this.onScan = onScan;
    this.fetch = fetchImpl;
    this.timer = null;
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

  pollOnce() {
    for (const host of this.settings.global.rangerHostnames ?? []) {
      this.fetch(rangerUrl(host), { signal: AbortSignal.timeout(POLL_MS * 2) })
        .then((r) => r.json())
        .then((scans) => {
          if (Array.isArray(scans)) for (const s of scans) this.onScan(s);
        })
        .catch(() => {}); // unreachable rangers are ignored, as before
    }
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}
