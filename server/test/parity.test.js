// Parity tests: new implementation vs. the original legacy Node-RED function code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyFunction, Store, fixedDate } from './legacyHarness.js';
import { enrichScan } from '../src/tilt/enrich.js';
import { Smoother } from '../src/tilt/smoothing.js';
import { applyCalibration, addPoint, removePoint, cToFPoint, toPointArray } from '../src/tilt/calibration.js';
import { cloudPostsFor } from '../src/logging/cloud.js';
import { localLogLineFor } from '../src/logging/local.js';
import { UUID_TO_COLOR } from '../src/tilt/colors.js';

const legacyAddParameter = legacyFunction('Add Parameter');
const legacySmooth = legacyFunction('Smooth');
const legacyInterpolate = legacyFunction('Interpolate');
const legacyCloudPost = legacyFunction('Setup Cloud Post');
const legacyLocalLog = legacyFunction('Setup Local Log');
const legacyAddSG = legacyFunction('Add SG Cal Points');
const legacyRemoveSG = legacyFunction('Remove SG Cal Point');

// Deterministic pseudo-random numbers
function rng(seed) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
}

/** Build matching legacy flow context and new Settings-like object. */
function makeEnv(opts) {
  const { IDbyMAC, displayUnits, fermdisplayUnits, color, sgPoints, tempPoints, smooth } = opts;
  const flow = new Store({
    IDbyMAC,
    displayUnits,
    fermdisplayUnits,
    cloudURL: ['https://script.google.com/macros/s/AKfycbwNXh6rEWoULd0vxWxDylG_PJwQwe0dn5hdtSkuC4k3D9AXBSA/exec', true],
    logCloudDataCheck: true,
    logLocalDataCheck: true,
    loggingInterval: 15,
    localloggingInterval: 15,
    minRSSI: -105,
    alphaSG: smooth.alphaSG,
    alphaTemp: smooth.alphaTemp,
    numberSamples: smooth.numberSamples,
    smoothSwitch: smooth.on,
    enableRangeBoost: 'false',
    rangerHostnames: [],
    [`${color}-Beer`]: ['IPA', true],
    [`actualSGpoints-${color}`]: sgPoints.actual,
    [`uncalSGpoints-${color}`]: sgPoints.uncal,
    [`actualTemppoints-${color}`]: tempPoints.actual,
    [`uncalTemppoints-${color}`]: tempPoints.uncal,
  });
  // The port stores temperature points in °F; legacy kept them in the display unit.
  const storedTemp = (pts) => (displayUnits === '°C' ? toPointArray(pts).map(cToFPoint) : pts);
  const tilt = {
    Beer: ['IPA', true],
    actualSGPoints: sgPoints.actual,
    uncalSGPoints: sgPoints.uncal,
    actualTempPoints: storedTemp(tempPoints.actual),
    uncalTempPoints: storedTemp(tempPoints.uncal),
  };
  const runtime = new Map();
  const settings = {
    global: {
      IDbyMAC,
      displayUnits,
      fermdisplayUnits,
      useDefaultCloudURL: true,
      logCloudDataCheck: true,
      logLocalDataCheck: true,
      loggingInterval: 15,
      localloggingInterval: 15,
      minRSSI: -105,
      alphaSG: smooth.alphaSG,
      alphaTemp: smooth.alphaTemp,
      numberSamples: smooth.numberSamples,
      smoothSwitch: smooth.on,
      enableRangeBoost: false,
      rangerHostnames: [],
    },
    tilt: (c) => (c === color ? tilt : {}),
    runtime: (c) => {
      if (!runtime.has(c)) runtime.set(c, { comment: '', docURL: '', lastpost: 0, lastlocalpost: 0 });
      return runtime.get(c);
    },
  };
  return { flow, settings };
}

const PROCESSED_FIELDS = [
  'Color', 'displayColor', 'IDbyMAC', 'Beer', 'actualSGPoints', 'unCalSGPoints', 'actualTempPoints',
  'unCalTempPoints', 'timeStamp', 'formatteddate', 'Timepoint', 'fermunits', 'SG', 'major', 'hd', 'Temp',
  'tempunits', 'uncalSG', 'uncalPlato', 'uncalBrix', 'Plato', 'Brix', 'ferm', 'uncalferm', 'uncalTemp',
  'displayuncalTemp', 'displayTemp',
];

test('pipeline (enrich → calibrate, smoothing off) matches legacy for 3000 random readings', () => {
  const rand = rng(42);
  const uuids = Object.keys(UUID_TO_COLOR);
  const calSets = [
    { uncal: [], actual: [] },
    { uncal: ['1.0020'], actual: ['1.0000'] },
    { uncal: ['1.0010', '1.0500'], actual: ['1.0000', '1.0480'] },
    { uncal: '1.0010,1.0500,1.0800', actual: '1.0000,1.0480,1.0790' }, // legacy string form
  ];
  const tempSets = [
    { uncal: [], actual: [] },
    { uncal: ['33.0'], actual: ['32.0'] },
    { uncal: ['1.0', '20.0'], actual: ['0.0', '19.5'] },
  ];
  const legacySmoothCtx = new Map();
  const smoother = new Smoother();
  let t = Date.UTC(2026, 10, 21, 12, 0, 0);

  for (let i = 0; i < 3000; i++) {
    t += Math.floor(rand() * 6000);
    const pro = rand() < 0.3;
    const scan = {
      uuid: uuids[Math.floor(rand() * uuids.length)],
      major: pro ? 500 + Math.floor(rand() * 400) : 30 + Math.floor(rand() * 60),
      minor: pro ? 9900 + Math.floor(rand() * 1300) : 990 + Math.floor(rand() * 130),
      tx_power: -59,
      rssi: -40 - Math.floor(rand() * 60),
      mac: 'aa:bb:cc:dd:ee:' + String(10 + Math.floor(rand() * 5)),
    };
    const IDbyMAC = rand() < 0.3;
    const color = UUID_TO_COLOR[scan.uuid] + (IDbyMAC ? ':' + scan.mac : '');
    const opts = {
      IDbyMAC,
      displayUnits: rand() < 0.5 ? '°F' : '°C',
      fermdisplayUnits: ['', '°P', '°Bx'][Math.floor(rand() * 3)],
      color,
      sgPoints: calSets[Math.floor(rand() * calSets.length)],
      tempPoints: tempSets[Math.floor(rand() * tempSets.length)],
      // Smoothing is time-based now (test/smoothing.test.js), no longer legacy-identical: keep it off
      // here so the rest of the pipeline is still compared against legacy.
      smooth: { on: (rand(), false), alphaSG: 1 + Math.floor(rand() * 100), alphaTemp: 1 + Math.floor(rand() * 100), numberSamples: rand() * 3 },
    };
    const D = fixedDate(t);
    const { flow, settings } = makeEnv(opts);

    // legacy
    const ctxKey = 'smooth';
    if (!legacySmoothCtx.has(ctxKey)) legacySmoothCtx.set(ctxKey, new Store());
    let msg = { payload: { ...scan, Color: UUID_TO_COLOR[scan.uuid] } }; // legacy "Colors" change node
    msg = legacyAddParameter(msg, { flow, Date: D }).ret[0];
    msg = legacySmooth(msg, { flow, context: legacySmoothCtx.get(ctxKey), Date: D }).ret;
    msg = legacyInterpolate(msg, { flow, Date: D }).ret;
    const legacy = msg.payload;

    // new
    const p = enrichScan(scan, settings, new D());
    smoother.apply(p, settings.global);
    applyCalibration(p);

    for (const f of PROCESSED_FIELDS) {
      assert.deepEqual(p[f], legacy[f], `reading ${i} field ${f} (${JSON.stringify(opts)})`);
    }
  }
});

test('cloud post body and URL match legacy', () => {
  const rand = rng(7);
  for (let i = 0; i < 300; i++) {
    const color = rand() < 0.5 ? 'RED' : 'PINK:aa:bb:cc:dd:ee:ff';
    const beer = rand() < 0.5 ? ['Munich Lager #1', true] : ['Hazy IPA', 'sheet123'];
    const comment = rand() < 0.5 ? '' : '{"template":"B2","email":"x@gmail.com"}';
    const useDefault = rand() < 0.5;
    const custom = 'https://a.example/x,https://b.example/y';
    const reading = { Color: color, Timepoint: 46347.5 + rand(), Temp: (60 + rand() * 10).toFixed(1), SG: 1 + rand() * 0.1, timeStamp: 1e12 + i };
    const flow = new Store({
      logCloudDataCheck: true,
      loggingInterval: 15,
      cloudURL: ['https://script.google.com/macros/s/AKfycbwNXh6rEWoULd0vxWxDylG_PJwQwe0dn5hdtSkuC4k3D9AXBSA/exec', useDefault],
      [`${color}-Beer`]: beer,
      [`${color}-Comment`]: comment,
      [`cloudURL-${color}`]: custom,
    });
    const legacy = legacyCloudPost({ payload: { ...reading } }, { flow }).sent;
    const rt = { comment, docURL: '', lastpost: 0, lastlocalpost: 0 };
    const settings = {
      global: { logCloudDataCheck: true, loggingInterval: 15, useDefaultCloudURL: useDefault },
      tilt: () => ({ Beer: beer, cloudURLs: custom }),
      runtime: () => rt,
    };
    const mine = cloudPostsFor({ ...reading }, settings);
    assert.equal(mine.length, legacy.length);
    mine.forEach((m, j) => {
      assert.equal(m.url, legacy[j].url);
      assert.equal(m.body, legacy[j].payload);
      assert.equal(m.cloudwait, legacy[j].cloudwait);
    });
    assert.equal(rt.lastpost, flow.get('lastpost-' + color));
  }
});

test('local log line matches legacy', () => {
  const t = Date.UTC(2026, 10, 21, 18, 9, 20);
  const D = fixedDate(t);
  for (const tx of [-59, 5, -1, 100]) {
    const reading = { Color: 'BLACK', Timepoint: 46347.75, Temp: '57.0', SG: 1.0004, rssi: -58, tx_power: tx, timeStamp: t };
    const flow = new Store({ logLocalDataCheck: true, localloggingInterval: 15, 'BLACK-Beer': ['Stout', true], 'BLACK-Comment': 'hi' });
    const legacy = legacyLocalLog({ payload: { ...reading } }, { flow, Date: D }).ret.payload;
    const rt = { comment: 'hi', lastlocalpost: 0 };
    const settings = { global: { logLocalDataCheck: true, localloggingInterval: 15 }, tilt: () => ({ Beer: ['Stout', true] }), runtime: () => rt };
    assert.equal(localLogLineFor({ ...reading }, settings, new D()), legacy);
  }
});

test('calibration point add/remove matches legacy', () => {
  const flow = new Store({ uncalSGpoint: '1.0050', actualSGpoint: '1.0030', 'uncalSGpoints-RED': '1.0100,1.0010', 'actualSGpoints-RED': '1.0080,1.0000' });
  legacyAddSG({ payload: 'RED', topic: '' }, { flow });
  const r = addPoint('1.0100,1.0010', '1.0080,1.0000', '1.0050', '1.0030');
  assert.deepEqual(r.uncal, flow.get('uncalSGpoints-RED'));
  assert.deepEqual(r.actual, flow.get('actualSGpoints-RED'));

  flow.set('colordropdownSelect', 'RED');
  legacyRemoveSG({ payload: '1' }, { flow });
  const r2 = removePoint(r.uncal, r.actual, 1);
  assert.deepEqual(r2.uncal, flow.get('uncalSGpoints-RED'));
  assert.deepEqual(r2.actual, flow.get('actualSGpoints-RED'));
});
