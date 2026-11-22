// Port of the legacy "Smooth" function node. Keeps per-color sample history.
// The algorithm (including its sample-flag alternation) is kept exactly so readings match.

export class Smoother {
  #state = new Map();

  reset() {
    this.#state.clear();
  }

  /**
   * Mutates and returns `payload` (SG / Temp replaced by smoothed values when enabled).
   * @param {object} payload enriched reading
   * @param {{smoothSwitch?:boolean, alphaSG?:number, alphaTemp?:number, numberSamples?:number}} g
   */
  apply(payload, g) {
    const smoothSwitch = g.smoothSwitch || false;
    if (!(smoothSwitch && payload.SG > 0.5)) return payload;

    const color = payload.Color;
    if (!this.#state.has(color)) this.#state.set(color, {});
    const ctx = this.#state.get(color);

    const SG = payload.SG;
    const Temp = payload.Temp;
    const alphaSG = g.alphaSG / 100 || 0.5;
    const alphaTemp = g.alphaTemp / 100 || 0.5;
    const numberSamples = g.numberSamples * 12 || 36; // 5 s samples → minutes × 12
    const sampleRate = 5000;
    let timeSinceLastSample = ctx.timeSinceLastSample || sampleRate;
    const prevSampleTime = ctx.prevSampleTime || payload.timeStamp;
    const sampleTakenFlag = ctx.sampleTakenFlag || 'not taken';
    const prevSGArray = ctx.SG || [];
    const prevTempArray = ctx.Temp || [];

    if (timeSinceLastSample >= sampleRate && sampleTakenFlag == 'not taken') {
      ctx.sampleTakenFlag = 'taken';
      prevSGArray.push(SG);
      prevTempArray.push(Temp);
      if (prevSGArray.length > numberSamples || prevTempArray.length > numberSamples) {
        prevSGArray.shift();
        prevTempArray.shift();
      }
      ctx.SG = prevSGArray;
      ctx.Temp = prevTempArray;
      ctx.prevSampleTime = payload.timeStamp;
    } else {
      ctx.sampleTakenFlag = 'not taken';
    }
    timeSinceLastSample = payload.timeStamp - prevSampleTime;
    ctx.timeSinceLastSample = timeSinceLastSample;

    let totalSG = 0;
    for (let i = 0; i < prevSGArray.length; i++) totalSG += prevSGArray[i];
    const meanSG = totalSG / prevSGArray.length;
    payload.SG = SG * (1 - alphaSG) + meanSG * alphaSG;

    let totalTemp = 0;
    for (let i = 0; i < prevTempArray.length; i++) totalTemp += prevTempArray[i];
    const meanTemp = totalTemp / prevTempArray.length;
    payload.Temp = Temp * (1 - alphaTemp) + meanTemp * alphaTemp;
    return payload;
  }
}
