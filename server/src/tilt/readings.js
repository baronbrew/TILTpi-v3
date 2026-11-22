// Display slots (legacy "Display" switch + storage-1..25 + the per-slot "check" functions).
export const MAX_SLOTS = 25;
export const DISPLAY_TIMEOUT_MS = 120000;

export class ReadingStore {
  constructor() {
    /** Sorted list of Colors seen since the last reset (legacy flow "options"). */
    this.options = [];
    /** @type {(object|undefined)[]} slot i holds the latest reading for options[i] */
    this.slots = new Array(MAX_SLOTS).fill(undefined);
  }

  /** Register a color; returns true when it was new (dropdown options changed). */
  noteColor(color) {
    if (this.options.includes(color)) return false;
    this.options.push(color);
    this.options.sort();
    return true;
  }

  /** Store a processed reading in the first slot whose option the Color contains. */
  store(reading) {
    const i = this.options.findIndex((o) => o !== undefined && reading.Color.includes(o));
    if (i < 0 || i >= MAX_SLOTS) return -1;
    this.slots[i] = reading;
    return i;
  }

  reset() {
    this.options = [];
    this.slots.fill(undefined);
  }

  /**
   * Once-per-second tick: stamp `clock`; if any slot is stale, clear everything.
   * Calls `visit(reading)` for each live reading in slot order (until a reset happens),
   * matching the legacy per-slot inject → check → template → logging chain.
   */
  tick(now, visit, timeout = DISPLAY_TIMEOUT_MS) {
    for (let i = 0; i < MAX_SLOTS; i++) {
      const r = this.slots[i];
      if (!r) continue;
      r.clock = now;
      if (r.clock - r.timeStamp > timeout) {
        this.reset();
        return true;
      }
      visit(r);
    }
    return false;
  }

  /** Legacy GET /macid/:mac. */
  findByMac(mac) {
    let payload = {};
    const all = [];
    for (const r of this.slots) {
      if (r === undefined) continue;
      if (mac === 'all') {
        all.push(r);
        payload = all;
      } else if (mac == r.mac) {
        return r;
      }
    }
    return payload;
  }
}
