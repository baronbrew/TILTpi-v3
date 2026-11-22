import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cToFPoint, fToCPoint, tempPointsInUnits } from '../src/tilt/calibration.js';
import { Settings } from '../src/settings.js';

test('°C points round-trip exactly through °F storage', () => {
  for (let c = -20; c <= 100; c = Math.round((c + 0.1) * 10) / 10) {
    assert.equal(fToCPoint(cToFPoint(c.toFixed(1))), c.toFixed(1));
  }
  assert.equal(cToFPoint('20.0'), '68.00');
  assert.equal(fToCPoint('33.0'), '0.56'); // °F-entered point shown in °C keeps 2 decimals
});

test('points are given to the pipeline in the display unit', () => {
  assert.deepEqual(tempPointsInUnits(['32.0', '68.00'], '°C'), ['0.0', '20.0']);
  assert.deepEqual(tempPointsInUnits(['32.0', '68.0'], '°F'), ['32.0', '68.0']);
});

test('one-time migration converts °C points saved before, then never again', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiltpi-settings-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    global: { displayUnits: '°C' },
    tilts: { RED: { uncalTempPoints: ['1.0', '20.5'], actualTempPoints: ['0.0', '20.0'] } },
  }));
  const s = new Settings(dir);
  s.load();
  assert.deepEqual(s.tilt('RED').uncalTempPoints, ['33.80', '68.90']);
  assert.deepEqual(s.tilt('RED').actualTempPoints, ['32.00', '68.00']);
  assert.equal(s.global.tempPointsUnit, '°F');
  const again = new Settings(dir); // reload: already migrated
  again.load();
  assert.deepEqual(again.tilt('RED').actualTempPoints, ['32.00', '68.00']);
  fs.rmSync(dir, { recursive: true, force: true });
});
