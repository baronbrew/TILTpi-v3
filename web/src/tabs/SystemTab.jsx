// "System" tab.
import { useState } from 'react';
import { Masonry, Group, Dropdown, Button, TextInput, Text, Switch, Numeric, Slider } from '../widgets.jsx';

// Date format choices (cards + log.csv). Labels show a sample, formatted by this browser.
const SAMPLE_DATE = new Date(2026, 10, 22, 13, 44, 38);
const LOCALES = ['en-US', 'en-GB', 'en-CA', 'en-AU', 'en-NZ', 'de-DE', 'fr-FR', 'es-ES', 'es-MX', 'it-IT',
  'nl-NL', 'pt-BR', 'sv-SE', 'da-DK', 'nb-NO', 'fi-FI', 'pl-PL', 'cs-CZ', 'ja-JP', 'ko-KR', 'zh-CN'];
const sample = (locale) => {
  try {
    return SAMPLE_DATE.toLocaleString(locale, { numberingSystem: 'latn' });
  } catch {
    return '';
  }
};
function localeOptions(current) {
  const list = current && !LOCALES.includes(current) ? [current, ...LOCALES] : LOCALES;
  return [{ label: 'Raspberry Pi default', value: '' }, ...list.map((l) => ({ label: `${l}: ${sample(l)}`, value: l }))];
}

const SCREEN_TIMEOUTS = [
  { label: 'Never', value: 0 },
  { label: '1 minute', value: 60 },
  { label: '10 minutes', value: 600 },
  { label: '2 hours', value: 7200 },
  { label: '8 hours', value: 28800 },
  { label: '16 hours', value: 57600 },
];
const MAX_RANGERS = 4;

const LIGHT = { true: 'ok', false: 'fail', undefined: 'unknown' };
const LIGHT_TITLE = { true: 'Connected', false: 'Connection failed', undefined: 'Not checked (Range Booster off)' };

/**
 * Tilt Picos found by their IP beacon (saved by Bluetooth MAC with their last good IP); each has an
 * on/off switch. On = polled every 5 s for the Tilts it hears. Light: green connected, red failed,
 * grey off / not polled yet. Picos that are off can be forgotten (X).
 */
function PicoList({ picos, send }) {
  if (!picos.length) {
    return <Text value="Searching for Tilt Picos… they appear here when their Bluetooth beacon is heard." layout="col-center" />;
  }
  return picos.map((p) => {
    const heard = p.heard === null
      ? (p.ip ? 'last known address, not heard since restart' : 'address unknown, waiting for its beacon')
      : `heard ${p.heard < 60 ? p.heard + ' s' : Math.round(p.heard / 60) + ' min'} ago, ${p.rssi} dBm`;
    const light = p.enabled ? LIGHT[String(p.status)] : 'unknown';
    const title = !p.enabled ? 'Off' : p.status === true ? 'Connected' : p.status === false ? p.problem : 'Connecting…';
    return (
      <Switch key={p.mac} checked={p.enabled} onChange={(v) => send('setPicoEnabled', { mac: p.mac, value: v })}
        label={
          <span className="pico-label" title={`${title} (Bluetooth ${p.mac})`}>
            <span>
              {!p.enabled && (
                <button type="button" className="cal-del pico-forget" title="Forget this Tilt Pico"
                  onClick={(e) => { e.stopPropagation(); send('forgetPico', { mac: p.mac }); }}>X</button>
              )}
              <span className={'ranger-light ' + light} />Tilt Pico {p.ip ?? ''}
            </span>
            <span className="pico-sub">{p.problem ?? heard}</span>
          </span>
        } />
    );
  });
}

/** Range booster Tilt Pis, deletable like the calibration points (fixed height: 4 rows). */
function RangerTable({ hosts, urls, status, onDelete }) {
  return (
    <div className="w-template cal-table ranger-table">
      <table>
        <thead>
          <tr><th>Delete</th><th>Tilt Pi</th></tr>
        </thead>
        <tbody>
          {Array.from({ length: MAX_RANGERS }, (_, i) => (
            <tr key={i} style={{ visibility: hosts[i] === undefined ? 'hidden' : 'visible' }}>
              <td><button type="button" className="cal-del" onClick={() => onDelete(hosts[i])}>X</button></td>
              <td>
                <div>
                  <span className={'ranger-light ' + LIGHT[String(status[hosts[i]])]}
                    title={LIGHT_TITLE[String(status[hosts[i]])]} />
                  {hosts[i]}
                </div>
                <div className="ranger-url">{urls[i]}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SystemTab({ state, statics, send }) {
  const g = state.settings;
  const ui = state.ui;
  const [tz, setTz] = useState(null);
  const [rssi, setRssi] = useState(null);
  const [zoom, setZoom] = useState(null);

  return (
    <Masonry>
      <Group title="Time" key="time">
        <Dropdown label="Time Zone:" placeholder="Select"
          options={statics.timezones.map((t) => ({ label: t, value: t }))}
          value={tz ?? statics.timezone} onChange={setTz} />
        <Button label="Set Time Zone" onClick={() => send('applyTimezone', { tz: tz ?? statics.timezone })} />
        <TextInput label="Adjust System Time Manually" value={ui.systemTime} onCommit={(v) => send('setSystemTime', { value: v })} />
        <Text value={ui.timeStatus} layout="col-center" />
      </Group>

      <Group title="Tilt Pi Display Units" key="units">
        <Switch label="Fahrenheit (default)" checked={g.displayUnits === '°F'} onChange={(on) => send('setTempUnits', { value: on ? '°F' : '°C' })} />
        <Switch label="Celsius" checked={g.displayUnits === '°C'} onChange={(on) => send('setTempUnits', { value: on ? '°C' : '°F' })} />
        <Switch label="SG 15°C/59°F (default)" checked={g.fermdisplayUnits === ''} onChange={(on) => on && send('setFermUnits', { value: '' })} />
        <Switch label="Plato" checked={g.fermdisplayUnits === '°P'} onChange={(on) => on && send('setFermUnits', { value: '°P' })} />
        <Switch label="Brix" checked={g.fermdisplayUnits === '°Bx'} onChange={(on) => on && send('setFermUnits', { value: '°Bx' })} />
        <Dropdown label="Date Format" placeholder="Select" options={localeOptions(g.locale ?? '')}
          value={g.locale ?? ''} onChange={(v) => send('setLocale', { value: v })} />
      </Group>

      <Group title="Tilt Measurement Smoothing" key="smooth">
        <Switch label="Enable Smoothing" checked={g.smoothSwitch} onChange={(v) => send('setSmoothing', { value: v })} />
        <Numeric label="Averaging Time (Minutes)" value={g.numberSamples} min={0} max={120} step={0.1} onChange={(v) => send('setNumberSamples', { value: v })} />
        <Numeric label="Temperature Smoothing %" value={g.alphaTemp} min={1} max={100} step={1} onChange={(v) => send('setAlphaTemp', { value: v })} />
        <Numeric label="Gravity Smoothing %" value={g.alphaSG} min={1} max={100} step={1} onChange={(v) => send('setAlphaSG', { value: v })} />
      </Group>

      <Group title="Filter Tilt by RSSI" key="rssi">
        <Slider label="RSSI Filter" min={-105} max={-35} step={1} value={g.minRSSI}
          onInput={setRssi} onCommit={(v) => { setRssi(null); send('setMinRSSI', { value: v }); }} />
        <Text label="Minimum RSSI in dBm" value={rssi ?? g.minRSSI} layout="row-spread" />
      </Group>

      <Group title="Identify Tilt by MAC Address" key="mac">
        <Switch label="Use MAC address" checked={g.IDbyMAC} onChange={(v) => send('setIDbyMAC', { value: v })} />
      </Group>

      <Group title="App Admin (Tilt Pi)" key="admin">
        <Button label="Update App" onClick={() => send('updateApp')} />
        <Text label={'Current Version: ' + ui.version.name} value={ui.version.notes} layout="col-center" />
        <Text label={ui.latest.label} value={ui.latest.text} layout={'col-center latest' + (ui.latest.enabled ? '' : ' disabled')} />
        <TextInput label='Beta Testing (enter "tiltpi-dev" to test)' value="" onCommit={(v) => send('betaTest', { branch: v })} />
      </Group>

      <Group title="Dashboard Link (local URL)" key="link">
        <Text label="Tilt Pi Local IP Address Link" value={ui.ipLink} layout="col-center" />
        <Text label="Tilt Pi Local Hostname Link" value={ui.hostnameLink} layout="col-center" />
        <Text label="Local Name Check" layout="col-center"
          value={<><span className={'ranger-light ' + LIGHT[String(ui.mdns?.ok ?? undefined)]} />{ui.mdns?.text}</>} />
        <Button label="Test & Reset Local Name" icon="refresh" onClick={() => send('testMdns')} />
        <Button label="Reset Link to tiltpi.local:1880/ui" onClick={() => send('setHostname', { name: 'tiltpi' })} />
        <TextInput label="Set New Hostname (ex. tiltpi-north)" value="" onCommit={(v) => send('setHostname', { name: v })} />
      </Group>

      {/* One layout block so the Tilt Pico group always sits right above the Tilt Pi one. */}
      <div className="group-stack" key="range">
        <Group title="Boost Range with Tilt Pico's">
          <PicoList picos={state.picos ?? []} send={send} />
        </Group>
        <Group title="Boost Range with Mulitple Tilt Pi's">
          <Switch label="Enable Range Booster Mode" checked={g.enableRangeBoost} onChange={(v) => send('setRangeBoost', { value: v })} />
          <TextInput label="Add Tilt Pi (ex. tiltpi-north)" value="" onCommit={(v) => send('addRangerHostname', { name: v })} />
          <RangerTable hosts={g.rangerHostnames ?? []} urls={state.rangerUrls} status={state.rangerStatus ?? {}}
            onDelete={(name) => send('removeRangerHostname', { name })} />
        </Group>
      </div>

      <Group title="Raspberry Pi" key="pi">
        <Dropdown label="Screen Auto Off" placeholder="Select Time Out" options={SCREEN_TIMEOUTS}
          value={g.screenTimeout} onChange={(v) => send('setScreenTimeout', { value: v })} />
        <Slider label="Screen Zoom" min={0.5} max={3} step={0.1} value={g.screenZoom}
          onInput={setZoom} onCommit={(v) => { setZoom(null); send('setScreenZoom', { value: v }); }} />
        <Text label="Zoom:" value={`${zoom ?? g.screenZoom}x`} layout="row-left" />
        <Button label="BT Stability Fix for RPi3" icon="bluetooth" onClick={() => send('btFix')} />
        <Button label="Revert BT Stability Fix for RPi3" icon="restore" onClick={() => send('btRevert')} />
        <Button label="Restart" icon="refresh" onClick={() => send('reboot')} />
        <Button label="Shutdown" icon="power" onClick={() => send('shutdown')} />
      </Group>
    </Masonry>
  );
}
