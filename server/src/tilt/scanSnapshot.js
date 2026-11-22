// Builds the /tiltscan response that other Tilt Pis poll in Range Booster mode
// (legacy: "rate limit by mac" delay → "Array of Scans" → "web response").
//  - every 2.5 s the newest raw scan of each MAC that reported since the last release is released
//  - released scans accumulate until a MAC repeats; then that array becomes the published snapshot
export const RELEASE_INTERVAL_MS = 2500;

export class ScanSnapshot {
  constructor() {
    this.pending = new Map(); // mac -> newest raw scan
    this.macArray = undefined;
    this.scanArray = undefined;
    this.published = undefined;
    this.timer = null;
  }

  start() {
    this.timer = setInterval(() => this.release(), RELEASE_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }

  add(scan) {
    this.pending.set(scan.mac, scan);
  }

  release() {
    const batch = [...this.pending.values()];
    this.pending.clear();
    for (const scan of batch) this.#collect(scan);
  }

  #collect(scan) {
    if (this.macArray === undefined) {
      this.macArray = [scan.mac];
      this.scanArray = [scan];
    } else if (this.macArray.includes(scan.mac)) {
      this.published = this.scanArray;
      this.macArray = undefined;
    } else {
      this.macArray.push(scan.mac);
      this.scanArray.push(scan);
    }
  }

  /** `{}` until the first snapshot exists (legacy behavior). */
  current() {
    return this.published ?? {};
  }
}
