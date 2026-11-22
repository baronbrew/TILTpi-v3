// "Calibration" tab: Select Tilt, Specific Gravity Calibration, Temperature Calibration.
import { useEffect, useState } from 'react';
import { Masonry, Group, Button, Numeric, Switch } from '../widgets.jsx';
import { TiltSelect } from './LoggingTab.jsx';
import { gravityUnit, tempPointShow } from '../units.js';

function PointsTable({ title, uncal, actual, onDelete, show = (v) => v }) {
  return (
    <div className="w-template cal-table">
      <h4>{title}</h4>
      <table>
        <thead>
          <tr><th>Delete</th><th>Pre-Cal/Tilt</th><th>Actual</th></tr>
        </thead>
        <tbody>
          {[0, 1, 2, 3, 4].map((i) => (
            <tr key={i} style={{ visibility: uncal[i] === undefined ? 'hidden' : 'visible' }}>
              <td><button type="button" className="cal-del" onClick={() => onDelete(i)}>X</button></td>
              <td>{show(uncal[i])}</td>
              <td>{show(actual[i])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One calibration group. While "Get Current" is on, both numerics follow the live reading every
 * second; changing either numeric turns it off (legacy behavior).
 * Values are shown and entered in the System tab's units. Gravity is converted to SG here before
 * sending; temperature is sent in the display unit and the server stores it in °F. Either way the
 * stored points stay valid when the unit changes.
 */
function CalibrationGroup({ kind, state, color, send }) {
  const isSG = kind === 'SG';
  const unit = gravityUnit(state.settings.fermdisplayUnits);
  const [auto, setAuto] = useState(true);
  // Values typed in the old unit would be misread after a unit change: go back to live values.
  useEffect(() => setAuto(true), [unit.name, state.settings.displayUnits]);
  const [uncal, setUncal] = useState(undefined);
  const [actual, setActual] = useState(undefined);

  const slot = color ? state.options.indexOf(color) : -1;
  const reading = slot >= 0 ? state.slots[slot] : null;
  useEffect(() => {
    if (!auto || !reading) return;
    if (isSG) {
      setUncal(unit.show(reading.uncalSG));
      setActual(unit.show(reading.SG));
    } else {
      setUncal(Number(reading.displayuncalTemp).toFixed(1));
      setActual(Number(reading.displayTemp).toFixed(1));
    }
  }, [auto, reading, isSG, unit.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const tilt = (color && state.tilts[color]) || {};
  const points = isSG
    ? { uncal: tilt.uncalSGPoints ?? [], actual: tilt.actualSGPoints ?? [] }
    : { uncal: tilt.uncalTempPoints ?? [], actual: tilt.actualTempPoints ?? [] };
  const add = (which) => send(isSG ? 'addSGPoint' : 'addTempPoint', isSG
    ? { color, kind: which, uncal: uncal === undefined ? uncal : unit.sg(uncal), actual: actual === undefined ? actual : unit.sg(actual) }
    : { color, kind: which, uncal, actual });
  const edit = (setter) => (v) => {
    setter(v);
    setAuto(false);
  };
  const range = isSG ? unit.range(0.99, 1.12) : { min: -20, max: 220, step: 0.1 };
  const g = unit.name; // 'SG' | 'Plato' | 'Brix'

  return (
    <Group title={isSG ? (g === 'SG' ? 'Specific Gravity Calibration' : `Gravity Calibration (${g})`) : 'Temperature Calibration'}>
      <Button label={isSG ? 'Calibrate in Water' : 'Calibrate in Ice Water'} onClick={() => add(isSG ? 'water' : 'ice')} />
      <Numeric label={isSG ? `Enter Pre-cal/Tilt ${g}` : 'Enter Pre-cal/Tilt Temp'} value={uncal} {...range} onChange={edit(setUncal)} />
      <Switch label={isSG ? `Get Current ${g}` : 'Get Current Temp'} checked={auto} onChange={setAuto} />
      <Numeric label={isSG ? `Enter Actual ${g}` : 'Enter Actual Temp'} value={actual}
        {...(isSG ? unit.range(0.99, 1.2) : range)} onChange={edit(setActual)} />
      <Button label={isSG ? `Calibrate in Known ${g}` : 'Calibrate in Known Temp'} onClick={() => add('known')} />
      <PointsTable
        title={isSG ? `${g} Calibration Points:` : 'Temp Calibration Points:'}
        uncal={points.uncal}
        actual={points.actual}
        show={isSG ? unit.show : (f) => tempPointShow(f, state.settings.displayUnits)}
        onDelete={(index) => send(isSG ? 'removeSGPoint' : 'removeTempPoint', { color, index })}
      />
      <Button label="Delete All" danger onClick={() => color && send(isSG ? 'clearSGPoints' : 'clearTempPoints', { color })} />
    </Group>
  );
}

export default function CalibrationTab({ state, send, color, setColor }) {
  return (
    <Masonry>
      <Group title="Select Tilt in Range" key="select">
        <TiltSelect state={state} color={color} setColor={setColor} />
      </Group>
      <CalibrationGroup key="sg" kind="SG" state={state} color={color} send={send} />
      <CalibrationGroup key="temp" kind="Temp" state={state} color={color} send={send} />
    </Masonry>
  );
}
