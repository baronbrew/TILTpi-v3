import test from 'node:test';
import assert from 'node:assert/strict';
import { Smoother } from '../src/tilt/smoothing.js';

const g = (o = {}) => ({ smoothSwitch: true, alphaSG: 100, alphaTemp: 100, numberSamples: 1, ...o });
const reading = (t, SG, Temp = 60, Color = 'RED') => ({ Color, timeStamp: t, SG, Temp });

test('average covers the last N minutes by time, not by number of readings', () => {
  const s = new Smoother();
  // 1 min window; readings every 5 s for 2 min: SG 1.000 for the first minute, then 1.010.
  let out;
  for (let t = 0; t <= 120000; t += 5000) out = s.apply(reading(t, t < 60000 ? 1.0 : 1.01), g());
  // At t=120 s the window is 60..120 s: all 1.010.
  assert.ok(Math.abs(out.SG - 1.01) < 1e-12, String(out.SG));
});

test('same window regardless of how often the Tilt is heard', () => {
  const run = (stepMs) => {
    const s = new Smoother();
    let out;
    for (let t = 0; t <= 120000; t += stepMs) out = s.apply(reading(t, 1 + t / 1e7), g({ numberSamples: 0.5 }));
    return out.SG;
  };
  // A linear ramp averaged over the last 30 s ≈ value at 105 s, at any reading rate.
  const expected = 1 + 105000 / 1e7;
  for (const step of [1000, 2500, 5000, 10000]) assert.ok(Math.abs(run(step) - expected) < 2e-6, `step ${step}`);
});

test('smoothing % mixes current and average like legacy', () => {
  const s = new Smoother();
  s.apply(reading(0, 1.0, 60), g({ alphaSG: 25, alphaTemp: 50 }));
  const out = s.apply(reading(10000, 1.02, 70), g({ alphaSG: 25, alphaTemp: 50 }));
  // mean SG 1.01, mean Temp 65
  assert.ok(Math.abs(out.SG - (1.02 * 0.75 + 1.01 * 0.25)) < 1e-12);
  assert.ok(Math.abs(out.Temp - (70 * 0.5 + 65 * 0.5)) < 1e-12);
});

test('duplicates within a second (Range Booster) count once', () => {
  const s = new Smoother();
  s.apply(reading(0, 1.0), g());
  for (let i = 1; i <= 5; i++) s.apply(reading(i * 100, 1.0), g());
  assert.equal(s.sampleCount('RED'), 1);
});

test('0 minutes = no averaging; off = unchanged; colors are separate', () => {
  const s = new Smoother();
  s.apply(reading(0, 1.0), g({ numberSamples: 0 }));
  assert.equal(s.apply(reading(5000, 1.05), g({ numberSamples: 0 })).SG, 1.05);
  assert.equal(s.apply(reading(10000, 1.07), { ...g(), smoothSwitch: false }).SG, 1.07);
  s.apply(reading(0, 1.03, 60, 'BLUE'), g());
  assert.equal(s.apply(reading(1000, 1.03, 60, 'BLUE'), g()).SG, 1.03);
});

test('clock going backwards starts a new window', () => {
  const s = new Smoother();
  s.apply(reading(100000, 1.0), g());
  const out = s.apply(reading(50000, 1.04), g());
  assert.equal(out.SG, 1.04);
});
