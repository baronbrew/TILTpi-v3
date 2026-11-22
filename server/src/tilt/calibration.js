// Port of the legacy "Interpolate" function node plus the calibration-point editing nodes.
// Interpolation deliberately mirrors the legacy string/number handling (comma strings, sentinel
// points, independent sorting) so calibrated values are bit-for-bit identical.

function linearInterpolation(x, x0, y0, x1, y1) {
  const a = (y1 - y0) / (x1 - x0);
  const b = -a * x0 + y0;
  return a * x + b;
}

const byNumber = (a, b) => a - b;

/** Mutates and returns `p` (an enriched, possibly smoothed reading). */
export function applyCalibration(p) {
  // --- Specific gravity ---
  const SG = p.SG;
  const actualSGPoints = p.actualSGPoints.split(',');
  const unCalSGPoints = p.unCalSGPoints.split(',');
  const unCalSGPointsTemp = p.unCalSGPoints.split(',');
  unCalSGPointsTemp.push(-0.001, SG, Number.MAX_VALUE);
  unCalSGPoints.push(-0.001, Number.MAX_VALUE);
  actualSGPoints.push(-0.001, Number.MAX_VALUE);
  unCalSGPointsTemp.sort(byNumber);
  unCalSGPoints.sort(byNumber);
  actualSGPoints.sort(byNumber);
  const indexSG = unCalSGPointsTemp.indexOf(SG);
  const calSG = linearInterpolation(
    Number(SG),
    Number(unCalSGPoints[indexSG - 1]),
    Number(actualSGPoints[indexSG - 1]),
    Number(unCalSGPoints[indexSG]),
    Number(actualSGPoints[indexSG]),
  );
  p.uncalSG = SG;
  p.uncalPlato = sgToPlato(p.uncalSG);
  p.uncalBrix = sgToBrix(p.uncalSG);
  p.SG = calSG;
  p.Plato = sgToPlato(p.SG);
  p.Brix = sgToBrix(p.SG);
  switch (p.fermunits) {
    case '':
      p.ferm = p.SG.toFixed(p.hd ? 4 : 3);
      p.uncalferm = p.uncalSG.toFixed(p.hd ? 4 : 3);
      break;
    case '°P':
      p.ferm = p.Plato.toFixed(p.hd ? 2 : 1);
      p.uncalferm = p.uncalPlato.toFixed(p.hd ? 2 : 1);
      break;
    case '°Bx':
      p.ferm = p.Brix.toFixed(p.hd ? 2 : 1);
      p.uncalferm = p.uncalBrix.toFixed(p.hd ? 2 : 1);
      break;
  }

  // --- Temperature (cal points are in display units) ---
  let Temp = p.Temp;
  if (p.tempunits === '°C') {
    Temp -= 32;
    Temp *= 0.5555;
  }
  const actualTempPoints = p.actualTempPoints.split(',');
  const unCalTempPoints = p.unCalTempPoints.split(',');
  const unCalTempPointsTemp = p.unCalTempPoints.split(',');
  unCalTempPointsTemp.push(-999, Temp, Number.MAX_VALUE);
  unCalTempPoints.push(-999, Number.MAX_VALUE);
  actualTempPoints.push(-999, Number.MAX_VALUE);
  unCalTempPointsTemp.sort(byNumber);
  unCalTempPoints.sort(byNumber);
  actualTempPoints.sort(byNumber);
  const indexTemp = unCalTempPointsTemp.indexOf(Temp);
  let calTemp = linearInterpolation(
    Number(Temp),
    Number(unCalTempPoints[indexTemp - 1]),
    Number(actualTempPoints[indexTemp - 1]),
    Number(unCalTempPoints[indexTemp]),
    Number(actualTempPoints[indexTemp]),
  );
  if (Number.isNaN(calTemp)) calTemp = 0;
  p.uncalTemp = Temp.toFixed(1);
  p.displayuncalTemp = Temp.toFixed(1);
  p.displayTemp = calTemp.toFixed(1);
  if (p.tempunits === '°C') {
    calTemp *= 1.8;
    calTemp += 32;
  }
  p.Temp = calTemp.toFixed(1);
  return p;
}

export function sgToPlato(sg) {
  return 1111.14 * sg - 630.272 * sg * sg + 135.997 * sg * sg * sg - 616.868;
}

export function sgToBrix(sg) {
  return ((182.4601 * sg - 775.6821) * sg + 1262.7794) * sg - 669.5622;
}

/** Legacy stored points either as arrays or comma strings; normalize to arrays of strings. */
export function toPointArray(v) {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v !== '') return v.split(',');
  return [];
}

/** "Add SG/Temp Cal Points": push into each list and sort each independently. */
export function addPoint(uncalPoints, actualPoints, uncal, actual) {
  const u = [...toPointArray(uncalPoints), uncal].sort(byNumber);
  const a = [...toPointArray(actualPoints), actual].sort(byNumber);
  return { uncal: u, actual: a };
}

export function removePoint(uncalPoints, actualPoints, index) {
  const u = toPointArray(uncalPoints);
  const a = toPointArray(actualPoints);
  u.splice(index, 1);
  a.splice(index, 1);
  return { uncal: u, actual: a };
}
