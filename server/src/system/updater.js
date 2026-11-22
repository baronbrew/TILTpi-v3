// App version, latest-release check (GitHub API) and self-update.
import fs from 'node:fs';
import path from 'node:path';
import { run } from './run.js';

export const RELEASE_NOTES =
  'Rebuilt on Node.js and React with native JavaScript Bluetooth scanning. Same features, settings and logging as before.';

export function currentVersion(appDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'server', 'package.json'), 'utf8'));
    return { name: 'v.' + pkg.version, notes: RELEASE_NOTES };
  } catch {
    return { name: 'unknown', notes: RELEASE_NOTES };
  }
}

/** Mirrors the legacy "filter" node output: {enabled, label, text}. */
export async function checkLatestRelease(repo, current) {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { 'User-Agent': 'tiltpi', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status !== 200) throw new Error('status ' + res.status);
    const resp = await res.json();
    if (resp.name == current.name) {
      return { enabled: false, label: '', text: 'Running most current version.' };
    }
    return { enabled: true, label: 'Latest Update: ' + resp.name, text: resp.body ?? '' };
  } catch {
    return {
      enabled: false,
      label: 'Lastest Update: Unknown',
      text: 'Failed to retrieve latest release information. Check internet connectivity.',
    };
  }
}

/**
 * Runs deploy/update.sh in its own systemd scope so restarting the tiltpi service
 * does not kill the update half-way.
 */
export function startUpdate(appDir, branch = '') {
  if (branch && !/^[A-Za-z0-9._\/-]+$/.test(branch)) {
    return Promise.resolve({ code: 1, stdout: '', stderr: 'Invalid branch name' });
  }
  const script = path.join(appDir, 'deploy', 'update.sh');
  return run('systemd-run', ['--unit', 'tiltpi-update', '--collect', '/bin/bash', script, ...(branch ? [branch] : [])], {
    sudo: true,
  });
}
