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

  /** Add the hostname, or remove it when already present (newest first, max 4). */
  toggleHostname(name) {
    if (!HOSTNAME_RE.test(name)) return false;
    const list = [...(this.settings.global.rangerHostnames ?? [])];
    const i = list.indexOf(name);
    if (i < 0) list.unshift(name);
    else list.splice(i, 1);
    if (list.length > MAX_RANGERS) list.pop();
    this.settings.setGlobal({ rangerHostnames: list });
    this.pollOnce();
    return true;
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
