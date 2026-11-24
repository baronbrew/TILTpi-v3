// Raspberry Pi / OS integration for the System tab (time, hostname, power, Bluetooth fix,
// kiosk display settings, network links).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { run, query } from './run.js';

export const HOSTNAME_RE =
  /^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$/; // RFC 1123

// ---- time ----
export function listTimezones() {
  try {
    return Intl.supportedValuesOf('timeZone').slice().sort();
  } catch {
    return [];
  }
}

export function currentTimezone() {
  try {
    return fs.readFileSync('/etc/timezone', 'utf8').replace(/(\r\n|\n|\r)/gm, '');
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}

export async function setTimezone(tz) {
  if (!listTimezones().includes(tz)) return { code: 1, stderr: 'Unknown time zone', stdout: '' };
  return run('timedatectl', ['set-timezone', tz], { sudo: true });
}

/** `date '+%F %T'` — via the date command so it reflects a just-changed time zone. */
export async function systemTimeText() {
  const r = await query('date', ['+%F %T']);
  if (r.code === 0 && r.stdout.trim()) return r.stdout.trim();
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function setSystemTime(text) {
  return run('date', ['-s', String(text)], { sudo: true, dryRunResult: String(text) });
}

// ---- power ----
export const reboot = () => run('reboot', [], { sudo: true });
export const shutdown = () => run('shutdown', ['now'], { sudo: true });

// ---- Bluetooth stability fix (slower Bluetooth UART) ----
// Legacy edited /usr/bin/btuart (hciattach 921600 → 115200 baud). From bookworm the kernel attaches
// Bluetooth itself (hci_uart_bcm, ~3,000,000 baud) and btuart never runs, so the same fix is now the
// firmware's krnbt_baudrate parameter in config.txt (takes effect after a restart).
export const BT_FIX_MARK = '# Tilt Pi: BT Stability Fix (slower Bluetooth UART, see System tab)';
export const BT_FIX_LINE = 'dtparam=krnbt_baudrate=115200';

/** config.txt text with the fix block added (on) or removed (off). Pure; other lines kept as is. */
export function withBtStabilityFix(text, on) {
  let out = String(text).replace(/\r\n/g, '\n');
  // Our block (added under its own [all] so it applies whatever section the file ends in).
  out = out.replace(/\n*\[all\]\n# Tilt Pi: BT Stability Fix[^\n]*\n(?:dtparam=krnbt_baudrate=[^\n]*\n?)?/g, '\n');
  out = out.replace(/^[ \t]*dtparam=krnbt_baudrate=[^\n]*\n?/gm, ''); // any other krnbt_baudrate line
  out = out.replace(/\n*$/, '\n');
  if (on) out += `\n[all]\n${BT_FIX_MARK}\n${BT_FIX_LINE}\n`;
  return out;
}

async function setBtStabilityFix(on) {
  const file = path.join(config.bootDir, 'config.txt');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { code: 1, stdout: '', stderr: `can't read ${file}: ${err.message}` };
  }
  const next = withBtStabilityFix(text, on);
  if (next === text.replace(/\r\n/g, '\n')) return { code: 0, stdout: 'unchanged', stderr: '' };
  // config.txt is root's (boot partition): write a copy, then sudo cp it into place.
  const tmp = path.join(os.tmpdir(), `tiltpi-config-${process.pid}.txt`);
  fs.writeFileSync(tmp, next);
  try {
    return await run('cp', [tmp, file], { sudo: true });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
export const btStabilityFix = () => setBtStabilityFix(true);
export const btStabilityRevert = () => setBtStabilityFix(false);

// ---- hostname / links ----
export function getHostname() {
  try {
    return fs.readFileSync('/etc/hostname', 'utf8').trim() || os.hostname();
  } catch {
    return os.hostname();
  }
}

export async function setHostname(name) {
  return run('raspi-config', ['nonint', 'do_hostname', name], { sudo: true });
}

export async function getIpv4() {
  const r = await query('hostname', ['-I']);
  const first = r.stdout.trim().split(/\s+/)[0];
  if (first) return first;
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return '127.0.0.1';
}

// ---- kiosk display (read by deploy/kiosk.sh when the desktop session starts) ----
export function writeKioskConfig(dataDir, { screenZoom, screenTimeout }) {
  const lines = [
    '# Written by Tilt Pi. Read by the kiosk launcher at session start.',
    `ZOOM=${Number(screenZoom) || 1}`,
    `SCREEN_OFF=${Number(screenTimeout) || 0}`,
  ];
  fs.writeFileSync(path.join(dataDir, 'kiosk.conf'), lines.join('\n') + '\n');
}
