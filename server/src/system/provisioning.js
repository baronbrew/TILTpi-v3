// First-boot provisioning files written to the SD card's boot partition by SETUP.html.
import fs from 'node:fs';
import path from 'node:path';
import { run } from './run.js';
import { COLORS } from '../tilt/colors.js';
import { config } from '../config.js';

const unquote = (s) => s.trim().replace(/^"(.*)"$/, '$1');

/** wpa_supplicant.conf → raspi-config nonint do_wifi_ssid_passphrase; file removed on success. */
export async function importWifi(bootDir) {
  const file = path.join(bootDir, 'wpa_supplicant.conf');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  let ssid;
  for (const line of text.split(/\r?\n/)) {
    const country = line.match(/^\s*country=([A-Za-z]{2})\s*$/);
    if (country) {
      // Pi OS keeps WiFi rfkill-blocked until a regulatory country is set. SETUP.html always
      // writes country=GB, so only use it when the Pi has no country yet (our images set one).
      const current = await run('raspi-config', ['nonint', 'get_wifi_country'], { sudo: true });
      if (current.code !== 0 || !/^[A-Z]{2}$/.test(current.stdout.trim())) {
        await run('raspi-config', ['nonint', 'do_wifi_country', country[1].toUpperCase()], { sudo: true });
      }
    } else if (line.indexOf('ssid') > -1) {
      ssid = unquote(line.split('=')[1] ?? '');
    } else if (line.indexOf('psk') > -1) {
      const psk = unquote(line.split('=')[1] ?? '');
      const r = await run('raspi-config', ['nonint', 'do_wifi_ssid_passphrase', ssid || 'ssid-not-specified', psk, '0', '0'], { sudo: true });
      if (r.code === 0) await run('rm', [file], { sudo: true });
      else console.warn('[provisioning] wifi setup failed:', r.stderr);
      return r.code === 0;
    }
  }
  return false;
}

/** Reads and deletes every cloud_log_<color>.json present. Returns their parsed contents. */
export async function takeCloudLogFiles(bootDir) {
  const found = [];
  for (const color of COLORS.map((c) => c.toLowerCase())) {
    const file = path.join(bootDir, `cloud_log_${color}.json`);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    found.push(data);
    if (config.dryRun) fs.rmSync(file, { force: true }); // dev: the file is in a local folder
    else await run('rm', [file], { sudo: true });
  }
  return found;
}
