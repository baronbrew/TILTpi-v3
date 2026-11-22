// First-boot provisioning files written to the SD card's boot partition by SETUP.html.
import fs from 'node:fs';
import path from 'node:path';
import { run } from './run.js';
import { COLORS } from '../tilt/colors.js';
import { config } from '../config.js';

const unquote = (s) => s.trim().replace(/^"(.*)"$/, '$1');

/** Parses SETUP.html's wpa_supplicant.conf: first network's ssid/psk and the country line. */
export function parseWpaSupplicant(text) {
  const out = { country: undefined, ssid: undefined, psk: undefined };
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(country|ssid|psk)\s*=(.*)$/);
    if (!m || out[m[1]] !== undefined) continue;
    out[m[1]] = m[1] === 'country' ? m[2].trim().toUpperCase() : unquote(m[2]);
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * wpa_supplicant.conf on the boot partition → a saved NetworkManager WiFi profile; file removed on
 * success. Legacy called `raspi-config nonint do_wifi_ssid_passphrase`, which on NetworkManager
 * systems runs `nmcli device wifi connect` — that fails if NM isn't up yet or hasn't scanned the
 * network seconds after boot, and was never retried. A saved profile autoconnects whenever the
 * network appears.
 */
export async function importWifi(bootDir, { attempts = 12, retryMs = 10000 } = {}) {
  const file = path.join(bootDir, 'wpa_supplicant.conf');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  const { country, ssid, psk } = parseWpaSupplicant(text);
  if (!ssid) {
    console.warn('[wifi] wpa_supplicant.conf has no ssid; leaving it in place');
    return false;
  }

  // Pi OS keeps WiFi rfkill-blocked until a regulatory country is set. SETUP.html always writes
  // country=GB, so only use it when the Pi has no country yet (our images set one).
  if (country && /^[A-Z]{2}$/.test(country)) {
    const current = await run('raspi-config', ['nonint', 'get_wifi_country'], { sudo: true });
    if (current.code !== 0 || !/^[A-Z]{2}$/.test(current.stdout.trim())) {
      await run('raspi-config', ['nonint', 'do_wifi_country', country], { sudo: true });
    }
  }
  await run('rfkill', ['unblock', 'wifi'], { sudo: true });

  const name = `tiltpi-${ssid}`;
  const security = psk ? ['wifi-sec.key-mgmt', 'wpa-psk', 'wifi-sec.psk', psk] : [];
  for (let i = 1; i <= attempts; i++) {
    await run('nmcli', ['connection', 'delete', name], { sudo: true }); // replace an older copy
    const r = await run('nmcli', [
      'connection', 'add', 'type', 'wifi', 'con-name', name, 'ssid', ssid,
      ...security, 'connection.autoconnect', 'yes',
    ], { sudo: true });
    if (r.code === 0) {
      console.log(`[wifi] saved network "${ssid}"`);
      await run('rm', [file], { sudo: true });
      // Connect now if it's in range; otherwise NetworkManager connects when it appears.
      const up = await run('nmcli', ['connection', 'up', name], { sudo: true, timeoutMs: 45000 });
      if (up.code !== 0) console.warn(`[wifi] "${ssid}" not connected yet:`, up.stderr.trim());
      return true;
    }
    console.warn(`[wifi] saving network failed (attempt ${i}/${attempts}):`, r.stderr.trim());
    if (i < attempts) await sleep(retryMs);
  }
  return false;
}

/**
 * Timezone/Locale from the first cloud_log_<color>.json that has them (SETUP.html adds the
 * browser's), without consuming the file.
 */
export function peekCloudLogSetup(bootDir) {
  for (const color of COLORS.map((c) => c.toLowerCase())) {
    try {
      const { Timezone, Locale } = JSON.parse(fs.readFileSync(path.join(bootDir, `cloud_log_${color}.json`), 'utf8'));
      if (Timezone || Locale) return { Timezone, Locale };
    } catch {
      // missing or unreadable: try the next color
    }
  }
  return {};
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
