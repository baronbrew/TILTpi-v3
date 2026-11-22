// Single place where the app runs OS commands. Uses execFile (no shell) so user input can never
// be interpreted by a shell. In dry-run mode (development) commands are logged and "succeed".
import { execFile } from 'node:child_process';
import { config } from '../config.js';

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{sudo?:boolean, timeoutMs?:number, dryRunResult?:string}} [opts]
 * @returns {Promise<{code:number, stdout:string, stderr:string}>}
 */
export function run(cmd, args = [], { sudo = false, timeoutMs = 60000, dryRunResult = '' } = {}) {
  const file = sudo ? 'sudo' : cmd;
  const argv = sudo ? ['-n', cmd, ...args] : args;
  if (config.dryRun) {
    console.log(`[dry-run] ${file} ${argv.map((a) => JSON.stringify(a)).join(' ')}`);
    return Promise.resolve({ code: 0, stdout: dryRunResult, stderr: '' });
  }
  return new Promise((resolve) => {
    execFile(file, argv, { timeout: timeoutMs }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      if (err && !stderr) stderr = err.message;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** Same as run() but never dry-run: for harmless read-only queries (hostname -I, date...). */
export function query(cmd, args = [], timeoutMs = 10000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({ code: err ? 1 : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}
