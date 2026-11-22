// Local name (mDNS) self-check: is "<hostname>.local" still answering?
//
// Seen on tiltpi-cal after months of uptime and WiFi reconnects: avahi-daemon kept running but
// stopped answering, so tiltpi-cal.local didn't resolve, even on the Pi itself, while it still
// resolved other Pis. Restarting avahi-daemon fixed it. A healthy Pi answers its own name in ~20 ms
// (a failed .local lookup takes ~5 s), so we look up our own name and restart avahi if it fails.
import dns from 'node:dns';
import { run } from './run.js';
import { getHostname } from './system.js';

export const CHECK_MS = 5 * 60000;
const LOOKUP_TIMEOUT_MS = 7000;
const AFTER_RESTART_MS = 5000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Resolves our own .local name; true when it answers in time. */
export async function ownNameAnswers(name, lookup = (n) => dns.promises.lookup(n, { family: 4 })) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), LOOKUP_TIMEOUT_MS);
  });
  try {
    return await Promise.race([lookup(name).then(() => true, () => false), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export class MdnsWatchdog {
  /** @param {{onStatus:(s:{ok:boolean|null,text:string})=>void, check?:(name:string)=>Promise<boolean>}} deps */
  constructor({ onStatus, check = ownNameAnswers }) {
    this.onStatus = onStatus;
    this.check = check;
    this.busy = null;
  }

  /** Check now; if our name doesn't answer, restart avahi-daemon and check again. */
  testAndReset() {
    this.busy ??= this.#run().finally(() => {
      this.busy = null;
    });
    return this.busy;
  }

  async #run() {
    const name = getHostname() + '.local';
    if (await this.check(name)) return this.#report(true, `${name} is answering`);
    console.warn(`[mdns] ${name} is not answering; restarting avahi-daemon`);
    const r = await run('systemctl', ['restart', 'avahi-daemon'], { sudo: true });
    if (r.code !== 0) return this.#report(false, `${name} not answering; avahi restart failed`, false);
    await sleep(AFTER_RESTART_MS);
    if (await this.check(name)) return this.#report(true, `${name} is answering (fixed by restarting avahi)`, true);
    return this.#report(false, `${name} not answering, even after restarting avahi`, true);
  }

  #report(ok, text, restarted = false) {
    if (restarted || !ok) console.log('[mdns]', text);
    const status = { ok, text, restarted, checkedAt: Date.now() };
    this.onStatus(status);
    return status;
  }
}
