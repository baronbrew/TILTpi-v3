// Smoothing (System tab → Tilt Measurement Smoothing), per Tilt color:
//   average = moving average of the readings from the last "Averaging Time" minutes (by timestamp)
//   output  = current × (1 − %) + average × %      (% = Temperature / Gravity Smoothing %)
//
// Legacy's "Smooth" node kept the last `minutes × 12` samples assuming one per 5 s, but how often
// a sample was taken depended on how often the Tilt was heard (and on an alternating flag), so
// "minutes" wasn't really minutes. This version uses the readings' timestamps.

export const MIN_SAMPLE_SPACING_MS = 1000; // ≤ 1 sample/s per Tilt: Range Booster duplicates don't skew it

export class Smoother {
  #state = new Map(); // color -> { samples: [{t, SG, Temp}] }

  reset() {
    this.#state.clear();
  }

  /**
   * Mutates and returns `payload` (SG / Temp replaced by smoothed values when enabled).
   * @param {object} payload enriched reading (timeStamp in ms, SG and Temp numbers)
   * @param {{smoothSwitch?:boolean, alphaSG?:number, alphaTemp?:number, numberSamples?:number}} g
   */
  apply(payload, g) {
    if (!(g.smoothSwitch && payload.SG > 0.5)) return payload;

    const alphaSG = g.alphaSG / 100 || 0.5; // same defaults as legacy
    const alphaTemp = g.alphaTemp / 100 || 0.5;
    const windowMs = Math.max(0, Number(g.numberSamples) || 0) * 60000; // "Averaging Time (Minutes)"
    const t = payload.timeStamp;
    const SG = Number(payload.SG);
    const Temp = Number(payload.Temp);

    let ctx = this.#state.get(payload.Color);
    const last = ctx?.samples[ctx.samples.length - 1];
    if (!ctx || (last && t < last.t)) {
      // first reading, or the clock went backwards (time set manually): start a new window
      ctx = { samples: [] };
      this.#state.set(payload.Color, ctx);
    }
    const samples = ctx.samples;
    const newest = samples[samples.length - 1];
    if (!newest || t - newest.t >= MIN_SAMPLE_SPACING_MS) samples.push({ t, SG, Temp });
    // Drop samples that left the window (always keep the newest).
    let drop = 0;
    while (drop < samples.length - 1 && samples[drop].t < t - windowMs) drop++;
    if (drop) samples.splice(0, drop);

    let totalSG = 0;
    let totalTemp = 0;
    for (const s of samples) {
      totalSG += s.SG;
      totalTemp += s.Temp;
    }
    const meanSG = totalSG / samples.length;
    const meanTemp = totalTemp / samples.length;
    payload.SG = SG * (1 - alphaSG) + meanSG * alphaSG;
    payload.Temp = Temp * (1 - alphaTemp) + meanTemp * alphaTemp;
    return payload;
  }

  /** For tests/diagnostics: number of samples held for a color. */
  sampleCount(color) {
    return this.#state.get(color)?.samples.length ?? 0;
  }
}
