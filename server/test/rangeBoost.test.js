import test from 'node:test';
import assert from 'node:assert/strict';
import { RangeBooster } from '../src/rangeBoost.js';

function booster(answering) {
  const settings = {
    global: { rangerHostnames: [] },
    setGlobal(p) { Object.assign(this.global, p); },
  };
  const scans = [];
  const fetchImpl = async (url) => {
    if (!answering.includes(url)) throw new Error('ENOTFOUND');
    return new Response(JSON.stringify([{ mac: 'aa' }]));
  };
  // Test lookup: "*.local" and IPs resolve to themselves, bare names don't resolve (like this LAN).
  const lookup = async (name) => {
    if (name.endsWith('.local') || /^[\d.]+$/.test(name)) return name;
    throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
  };
  const b = new RangeBooster({ settings, onScan: (s) => scans.push(s), fetchImpl, lookup });
  return { b, settings, scans };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

test('bare hostname falls back to .local and remembers it', async () => {
  const { b, scans } = booster(['http://tiltpi-office.local:1880/tiltscan']);
  b.addHostname('tiltpi-office');
  await settle();
  assert.equal(b.status['tiltpi-office'], true);
  assert.equal(b.urlFor('tiltpi-office'), 'http://tiltpi-office.local:1880/tiltscan');
  assert.equal(scans.length, 1);
});

test('unreachable host is red; removing it clears its status', async () => {
  const { b, settings } = booster([]);
  b.addHostname('tiltpi-nowhere');
  await settle();
  assert.equal(b.status['tiltpi-nowhere'], false);
  b.removeHostname('tiltpi-nowhere');
  assert.equal(b.status['tiltpi-nowhere'], undefined);
  assert.deepEqual(settings.global.rangerHostnames, []);
});

test('IP addresses are used as-is', async () => {
  const { b } = booster(['http://192.168.0.127:1880/tiltscan']);
  b.addHostname('192.168.0.127');
  await settle();
  assert.equal(b.status['192.168.0.127'], true);
});

test('a slow-to-fail host does not make working hosts fail', async () => {
  const { b, settings } = booster(['http://tiltpi-office.local:1880/tiltscan']);
  const slow = b.lookup;
  b.lookup = async (name) => {
    if (name.startsWith('tiltpi-dead')) await new Promise((r) => setTimeout(r, 50));
    return slow(name);
  };
  settings.global.rangerHostnames = ['tiltpi-dead', 'tiltpi-office'];
  b.pollOnce();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(b.status['tiltpi-office'], true);
  assert.equal(b.status['tiltpi-dead'], false);
});
