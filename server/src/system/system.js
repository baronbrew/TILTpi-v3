// Raspberry Pi / OS integration for the System tab (time, hostname, power, Bluetooth fix,
// kiosk display settings, network links).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

// ---- Bluetooth UART baud fix for RPi3 ----
export const btStabilityFix = () =>
  run('sed', ['-i', 's/921600 noflow/115200 noflow/g', '/usr/bin/btuart'], { sudo: true });
export const btStabilityRevert = () =>
  run('sed', ['-i', 's/115200 noflow/921600 noflow/g', '/usr/bin/btuart'], { sudo: true });

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
