import test from 'node:test';
import assert from 'node:assert/strict';
import { PicoBooster, picoIpFromBeacon, isPicoUuid, scanFromPico } from '../src/pico.js';

test('IP address decoded from the beacon major/minor (as the Tilt app does)', () => {
  assert.equal(picoIpFromBeacon(49320, 48), '192.168.0.48'); // seen from tiltpi-office's /tiltscan
  assert.equal(picoIpFromBeacon(0x0a00, 0x0105), '10.0.1.5');
  assert.equal(picoIpFromBeacon(0xac10, 0x0001), '172.16.0.1');
  assert.equal(picoIpFromBeacon(999, 999), null); // WiFi setup mode
  assert.equal(picoIpFromBeacon(999, 997), null); // WiFi failed
  assert.equal(picoIpFromBeacon(0x0808, 0x0808), null); // 8.8.8.8: not a LAN address
  assert.ok(isPicoUuid('a495bc02c5b14b44b5121370f02d74de'));
  assert.ok(isPicoUuid('A495BC02-C5B1-4B44-B512-1370F02D74DE'));
  assert.ok(!isPicoUuid('a495bb10c5b14b44b5121370f02d74de'));
});

function setup(responses) {
  const settings = { global: { tiltPicos: {} }, setGlobal(p) { Object.assign(this.global, p); } };
  const fed = [];
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    const body = responses.shift();
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body));
  };
  const p = new PicoBooster({ settings, onScan: (s) => fed.push(s), fetchImpl });
  return { p, settings, fed, urls };
}
const settle = () => new Promise((r) => setTimeout(r, 20));
const tilt = (ts, minor = 1050) => ({ uuid: 'a495bb30c5b14b44b5121370f02d74de', mac: 'aa:bb', major: 66, minor, tx_power: -59, rssi: -70, timestamp: ts });

test('discovered Picos are listed; turning one on polls it and feeds only new readings', async () => {
  const { p, settings, fed, urls } = setup([[tilt(100)], [tilt(100)], [tilt(105, 1049)]]);
  p.noteBeacon({ uuid: 'a495bc02c5b14b44b5121370f02d74de', major: 49320, minor: 48, rssi: -80, mac: 'D8:3A:DD:00:00:01' });
  assert.deepEqual(p.list().map((x) => [x.ip, x.enabled]), [['192.168.0.48', false]]);
  p.setEnabled('d8:3a:dd:00:00:01', true);
  await settle();
  assert.deepEqual(settings.global.tiltPicos, { 'd8:3a:dd:00:00:01': { ip: '192.168.0.48' } });
  assert.equal(urls[0], 'http://192.168.0.48/');
  assert.equal(fed.length, 1);
  p.pollAll(); await settle(); // same timestamp: the Pico is only repeating its last reading
  assert.equal(fed.length, 1);
  p.pollAll(); await settle(); // new timestamp
  assert.equal(fed.length, 2);
  assert.equal(fed[1].minor, 1049);
  assert.equal(p.list()[0].status, true);
});

test('unreachable Pico shows failed; new IP from its beacon is followed', async () => {
  const { p, settings } = setup([new Error('timeout')]);
  p.noteBeacon({ uuid: 'a495bc02c5b14b44b5121370f02d74de', major: 49320, minor: 48, rssi: -80, mac: 'aa:01' });
  p.setEnabled('aa:01', true);
  await settle();
  assert.equal(p.list()[0].status, false);
  p.noteBeacon({ uuid: 'a495bc02c5b14b44b5121370f02d74de', major: 49320, minor: 77, rssi: -80, mac: 'aa:01' });
  assert.equal(settings.global.tiltPicos['aa:01'].ip, '192.168.0.77');
  p.setEnabled('aa:01', false);
  assert.deepEqual(settings.global.tiltPicos, {});
});

test('Pico entries converted to our scan format (real Pico 1009 response)', () => {
  const e = { tx_power: '153', rssi: -76, mac: 'f7fecc28948f', timestamp: 1795395027, uuid: 'a495bb40c5b14b44b5121370f02d74de', major: 999, minor: 1005 };
  assert.deepEqual(scanFromPico(e), { uuid: 'a495bb40c5b14b44b5121370f02d74de', major: 999, minor: 1005, tx_power: -103, rssi: -76, mac: 'f7:fe:cc:28:94:8f' });
  assert.equal(scanFromPico({ ...e, tx_power: -59 }).tx_power, -59);
});
