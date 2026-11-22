import test from 'node:test';
import assert from 'node:assert/strict';
import { MdnsWatchdog, ownNameAnswers } from '../src/system/mdns.js';

test('ownNameAnswers: true when the lookup resolves, false when it fails', async () => {
  assert.equal(await ownNameAnswers('x.local', async () => ({ address: '1.2.3.4' })), true);
  assert.equal(await ownNameAnswers('x.local', async () => { throw new Error('ENOTFOUND'); }), false);
});

test('a healthy name is reported ok without restarting avahi', async () => {
  const seen = [];
  const w = new MdnsWatchdog({ onStatus: (s) => seen.push(s), check: async () => true });
  const s = await w.testAndReset();
  assert.equal(s.ok, true);
  assert.equal(s.restarted, false);
  assert.equal(seen.length, 1);
});

test('concurrent checks share one run', async () => {
  let calls = 0;
  const w = new MdnsWatchdog({ onStatus: () => {}, check: async () => { calls++; return true; } });
  await Promise.all([w.testAndReset(), w.testAndReset()]);
  assert.equal(calls, 1);
});
