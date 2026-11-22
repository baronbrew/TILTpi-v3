// "Calibration" tab: Select Tilt, Specific Gravity Calibration, Temperature Calibration.
import { useEffect, useState } from 'react';
import { Masonry, Group, Button, Numeric, Switch } from '../widgets.jsx';
import { TiltSelect } from './LoggingTab.jsx';

function PointsTable({ title, uncal, actual, onDelete }) {
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
              <td>{uncal[i]}</td>
              <td>{actual[i]}</td>
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
 */
function CalibrationGroup({ kind, state, color, send }) {
  const isSG = kind === 'SG';
  const [auto, setAuto] = useState(true);
  const [uncal, setUncal] = useState(undefined);
  const [actual, setActual] = useState(undefined);

  const slot = color ? state.options.indexOf(color) : -1;
  const reading = slot >= 0 ? state.slots[slot] : null;
  useEffect(() => {
    if (!auto || !reading) return;
    if (isSG) {
      setUncal(Number(reading.uncalSG).toFixed(4));
      setActual(Number(reading.SG).toFixed(4));
    } else {
      setUncal(Number(reading.displayuncalTemp).toFixed(1));
      setActual(Number(reading.displayTemp).toFixed(1));
    }
  }, [auto, reading, isSG]);

  const tilt = (color && state.tilts[color]) || {};
  const points = isSG
    ? { uncal: tilt.uncalSGPoints ?? [], actual: tilt.actualSGPoints ?? [] }
    : { uncal: tilt.uncalTempPoints ?? [], actual: tilt.actualTempPoints ?? [] };
  const add = (which) => send(isSG ? 'addSGPoint' : 'addTempPoint', { color, kind: which, uncal, actual });
  const edit = (setter) => (v) => {
    setter(v);
    setAuto(false);
  };
  const range = isSG ? { min: 0.99, max: 1.12, step: 0.0001 } : { min: -20, max: 220, step: 0.1 };

  return (
    <Group title={isSG ? 'Specific Gravity Calibration' : 'Temperature Calibration'}>
      <Button label={isSG ? 'Calibrate in Water' : 'Calibrate in Ice Water'} onClick={() => add(isSG ? 'water' : 'ice')} />
      <Numeric label={isSG ? 'Enter Pre-cal/Tilt SG' : 'Enter Pre-cal/Tilt Temp'} value={uncal} {...range} onChange={edit(setUncal)} />
      <Switch label={isSG ? 'Get Current SG' : 'Get Current Temp'} checked={auto} onChange={setAuto} />
      <Numeric label={isSG ? 'Enter Actual SG' : 'Enter Actual Temp'} value={actual}
        {...(isSG ? { min: 0.99, max: 1.2, step: 0.0001 } : range)} onChange={edit(setActual)} />
      <Button label={isSG ? 'Calibrate in Known SG' : 'Calibrate in Known Temp'} onClick={() => add('known')} />
      <PointsTable
        title={isSG ? 'SG Calibration Points:' : 'Temp Calibration Points:'}
        uncal={points.uncal}
        actual={points.actual}
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
