// Gravity units for the calibration screen. Calibration points are always stored in SG (as legacy),
// so switching units never invalidates them; the screen shows and accepts the selected unit.
// SG -> Plato/Brix are the same formulas the server uses (server/src/tilt/calibration.js).

export const sgToPlato = (sg) => 1111.14 * sg - 630.272 * sg * sg + 135.997 * sg * sg * sg - 616.868;
export const sgToBrix = (sg) => ((182.4601 * sg - 775.6821) * sg + 1262.7794) * sg - 669.5622;

/** Inverse of a function that increases over SG 0.9-1.3 (both formulas do), by bisection. */
function inverse(f, target) {
  let lo = 0.9;
  let hi = 1.3;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const UNITS = {
  '': { name: 'SG', decimals: 4, step: 0.0001, fromSG: (sg) => sg, toSG: (v) => v },
  '°P': { name: 'Plato', decimals: 2, step: 0.01, fromSG: sgToPlato, toSG: (v) => inverse(sgToPlato, v) },
  '°Bx': { name: 'Brix', decimals: 2, step: 0.01, fromSG: sgToBrix, toSG: (v) => inverse(sgToBrix, v) },
};

/** Unit helpers for the System tab's gravity setting ('' = SG, '°P', '°Bx'). */
export function gravityUnit(fermdisplayUnits) {
  const u = UNITS[fermdisplayUnits] ?? UNITS[''];
  return {
    ...u,
    /** SG (number or string) -> value in this unit, as a fixed-decimals string. */
    show: (sg) => (sg === undefined || sg === null || sg === '' ? '' : u.fromSG(Number(sg)).toFixed(u.decimals)),
    /** Value in this unit -> SG string with 4 decimals (how points are stored). */
    sg: (v) => u.toSG(Number(v)).toFixed(4),
    /** SG range -> {min, max} in this unit. */
    range: (minSG, maxSG) => ({
      min: Number(u.fromSG(minSG).toFixed(u.decimals)),
      max: Number(u.fromSG(maxSG).toFixed(u.decimals)),
      step: u.step,
    }),
  };
}
