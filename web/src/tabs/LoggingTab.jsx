// "Logging" tab: Quick Start, Cloud Settings, Tilt Pi Settings.
import { useState } from 'react';
import { Masonry, Group, Dropdown, TextInput, Switch, Slider, Text, Button } from '../widgets.jsx';
import SafeHtml from '../SafeHtml.jsx';

export function TiltSelect({ state, color, setColor }) {
  return (
    <Dropdown
      label="TILT | "
      placeholder="Select Tilt Color"
      options={state.options.map((c) => ({ label: c, value: c }))}
      value={color}
      onChange={setColor}
    />
  );
}

function CloudStatus({ state, color }) {
  const s = state.ui.cloudStatus ?? {};
  const forSelected = s.tiltcolor !== undefined && s.tiltcolor === color;
  const link = forSelected ? state.tilts[color]?.docURL : '';
  return (
    <div className="w-template cloud-status">
      <div>
        <strong>Cloud Status: </strong>
        <br />
        {!forSelected && <SafeHtml html={s.cloudwait} />}
      </div>
      <div>
        <SafeHtml html={s.result} />
        {link && (
          <a href={link} target="_blank" rel="noreferrer"> | View Cloud Log</a>
        )}
      </div>
    </div>
  );
}

/** Comma-separated cloud URLs (legacy storage) → list; commas typed in a line also split it. */
const splitUrls = (text) => String(text ?? '').split(',').map((u) => u.trim()).filter(Boolean);

/**
 * Custom cloud URLs for one Tilt, one per line, plus an empty line to add another. Enter adds the
 * URL and moves to a new empty line; clearing a line removes that URL. Still saved as the legacy
 * comma-separated string (so "a,b" typed in one line works too).
 */
function CloudUrlList({ color, value, send }) {
  const urls = splitUrls(value);
  const [focusNew, setFocusNew] = useState(false);
  const save = (list) => send('setCloudURL', { color, value: list.join(',') });
  const edit = (i) => (text) => {
    const next = [...urls];
    next.splice(i, 1, ...splitUrls(text)); // empty → removes the line
    save(next);
  };
  return (
    <>
      {urls.map((url, i) => (
        <TextInput key={i + ':' + url} label={`Cloud URL ${i + 1}`} value={url} onCommit={edit(i)} />
      ))}
      <TextInput
        key={'new:' + urls.length}
        label={urls.length ? `Add Cloud URL ${urls.length + 1}` : 'Cloud URL'}
        value=""
        autoFocus={focusNew}
        onCommit={(text) => {
          const added = splitUrls(text);
          if (!added.length) return;
          setFocusNew(true); // next empty line gets the cursor
          save([...urls, ...added]);
        }}
      />
    </>
  );
}

export default function LoggingTab({ state, send, color, setColor }) {
  const g = state.settings;
  const tilt = (color && state.tilts[color]) || {};
  const beer = tilt.Beer ?? ['', true];
  const beerText = color ? (beer[1] === true ? beer[0] : beer.join(',')) : '';
  const cloudURLText = g.useDefaultCloudURL ? state.defaultCloudURL : tilt.cloudURLs || (color ? 'Not set for ' + color : '');
  const [cloudMinutes, setCloudMinutes] = useState(null);
  const [localMinutes, setLocalMinutes] = useState(null);

  return (
    <Masonry>
      <Group title="Quick Start" key="quick">
        <TiltSelect state={state} color={color} setColor={setColor} />
        <TextInput label="Set Beer Name" value={beerText} onCommit={(v) => send('setBeerName', { color, value: v })} />
        <TextInput label="Enter GMAIL email" value="" onCommit={(v) => send('submitEmail', { color, email: v })} />
        <CloudStatus state={state} color={color} />
      </Group>

      <Group title="Cloud Settings" key="cloud">
        {g.useDefaultCloudURL || !color ? (
          <TextInput label="Cloud URL" value={cloudURLText} onCommit={(v) => send('setCloudURL', { color, value: v })} />
        ) : (
          <CloudUrlList key={color} color={color} value={tilt.cloudURLs} send={send} />
        )}
        <Switch label="Use Default Cloud URL for All" checked={g.useDefaultCloudURL}
          onChange={(v) => send('setUseDefaultCloudURL', { value: v })} />
        <Dropdown label="Logging Template" placeholder="v2 (default)"
          options={[{ label: 'v2', value: 'B2' }, { label: 'classic', value: 'B1' }]}
          value={state.ui.loggingTemplate} onChange={(v) => send('setLoggingTemplate', { value: v })} />
        <Switch label="Start Logging to the Cloud" checked={g.logCloudDataCheck}
          onChange={(v) => send('setLogCloud', { color, value: v })} />
        <Slider label="Time Interval" min={5} max={60} step={5} value={g.loggingInterval}
          onInput={setCloudMinutes}
          onCommit={(v) => { setCloudMinutes(null); send('setCloudInterval', { value: v }); }} />
        <Text label="Minutes:" value={cloudMinutes ?? g.loggingInterval} layout="row-left" />
        <TextInput label="Comment" value="" onCommit={(v) => send('submitComment', { color, comment: v })} />
      </Group>

      <Group title="Tilt Pi Settings" key="local">
        <Switch label="Start Logging to Tilt Pi" checked={g.logLocalDataCheck}
          onChange={(v) => send('setLogLocal', { color, value: v })} />
        <Slider label="Time Interval" min={0.1} max={60} step={0.1} value={g.localloggingInterval}
          onInput={setLocalMinutes}
          onCommit={(v) => { setLocalMinutes(null); send('setLocalInterval', { value: v }); }} />
        <Text label="Minimum Minutes:" value={localMinutes ?? g.localloggingInterval} layout="row-left" />
        <Button label="Download Log" onClick={() => { window.location = '/log.csv'; }} />
        <Text label="Download via USB" value={state.ui.usbStatus} layout="col-center" />
        <Text value={state.ui.logSize} layout="row-left" />
        <Button label="Delete Log" danger onClick={() => send('deleteLog')} />
      </Group>
    </Masonry>
  );
}
