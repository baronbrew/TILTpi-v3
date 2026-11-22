import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWpaSupplicant } from '../src/system/provisioning.js';

test('parses the wpa_supplicant.conf that SETUP.html writes', () => {
  const text = 'country=GB\nctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev\nupdate_config=1\n'
    + 'network={\n\tssid="My Net"\n\tpsk="pass=word 1"\n}';
  assert.deepEqual(parseWpaSupplicant(text), { country: 'GB', ssid: 'My Net', psk: 'pass=word 1' });
});

test('handles CRLF line endings and an open network', () => {
  const text = 'country=us\r\nnetwork={\r\n\tssid="Open"\r\n\tpsk=""\r\n}\r\n';
  assert.deepEqual(parseWpaSupplicant(text), { country: 'US', ssid: 'Open', psk: '' });
});

test('peekCloudLogTimezone reads the Timezone SETUP.html adds, without deleting the file', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { peekCloudLogTimezone } = await import('../src/system/provisioning.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiltpi-boot-'));
  assert.equal(peekCloudLogTimezone(dir), undefined);
  const file = path.join(dir, 'cloud_log_red.json');
  fs.writeFileSync(file, JSON.stringify({ Color: 'RED', Comment: '', Beer: ['x', true], Timezone: 'Europe/Berlin', Locale: 'de-DE' }));
  assert.equal(peekCloudLogTimezone(dir), 'Europe/Berlin');
  assert.ok(fs.existsSync(file));
  fs.rmSync(dir, { recursive: true, force: true });
});
