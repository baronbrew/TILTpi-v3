// "Tilt Pi" tab: one card per display slot (legacy ui_template "1".."25").
import { Masonry } from '../widgets.jsx';
import { noNegZero } from '../format.js';

const cssColor = (c) => (c === 'PINK' ? 'DEEPPINK' : c);
const GRAVITY_NAME = { '': 'Specific Gravity', '°P': 'Plato', '°Bx': 'Brix' };
const num1 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? noNegZero(n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })) : '';
};

// Empty slots render this invisibly so they're exactly as tall as a real card (cards size to
// their content, which depends on the fonts installed).
const PLACEHOLDER = {
  Beer: ['-'], displayColor: ['-'], uncalferm: '1.000', ferm: '1.000', fermunits: '', SG: 0.99,
  displayuncalTemp: '0', displayTemp: '0', tempunits: '°F', Temp: 30, formatteddate: '-', timeStamp: 0, rssi: 0,
};

function TiltCard({ r: reading, now }) {
  const r = reading ?? PLACEHOLDER;
  const color = cssColor(r.displayColor?.[0]);
  // Smoothing on: flag the values as averages so it isn't forgotten.
  const avg = r.smoothSwitch ? (
    <span className="avg" title={`Smoothing on: ${r.numberSamples} min moving average`}>AVG</span>
  ) : null;
  return (
    <section className={'group tilt-card' + (reading ? '' : ' empty')} aria-hidden={reading ? undefined : 'true'}>
      <h1 className="one-line" title={r.Beer?.[0]}>{r.Beer?.[0]}</h1>
      <h1 className="one-line">
        <strong>
          TILT | {r.displayColor?.[0]} {r.displayColor?.[5]} {r.displayColor?.[6]}
        </strong>
        {r.docURL && (
          <a href={r.docURL} target="_blank" rel="noreferrer"> | View Cloud Log</a>
        )}
      </h1>
      <div style={{ background: color, height: 40, width: '100%' }} />
      <h1>{GRAVITY_NAME[r.fermunits ?? ''] ?? 'Specific Gravity'}: {noNegZero(r.uncalferm)} (pre-calibrated)</h1>
      <h2>
        {noNegZero(r.ferm)}
        <span className="unit">{r.fermunits}</span>
        {avg}
      </h2>
      <div style={{ background: color, height: 10, width: `${(r.SG - 0.99) / 0.0013}%` }} />
      <h1>Temperature: {num1(r.displayuncalTemp)} (pre-calibrated)</h1>
      <h2>
        {num1(r.displayTemp)}
        <span className="unit">{r.tempunits}</span>
        {avg}
      </h2>
      <div style={{ background: color, height: 10, width: `${(r.Temp - 30) / 1.85}%` }} />
      <h5>{r.formatteddate}</h5>
      <h5>
        Received {num1(((r.clock ?? now) - r.timeStamp) / 1000)} seconds ago {r.rssi} dBm
      </h5>
    </section>
  );
}

export default function TiltTab({ state }) {
  const count = state.settings.IDbyMAC ? 25 : 8; // slots 9-25 only shown with "ID by MAC"
  const slots = state.slots.slice(0, count);
  return (
    <Masonry>
      {slots.map((r, i) => (
        <TiltCard key={i} now={state.now} r={r && { ...r, docURL: state.tilts[r.Color]?.docURL }} />
      ))}
    </Masonry>
  );
}
