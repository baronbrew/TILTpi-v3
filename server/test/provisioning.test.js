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
