// "Download via USB": when a USB disk appears, mount its first partition, copy log.csv, unmount.
import fs from 'node:fs';
import path from 'node:path';
import { run } from './run.js';

export const USB_IDLE_TEXT = 'Insert Windows (FAT32, MBR) formatted USB drive.';
const MOUNT_POINT = '/mnt/usb';

export class UsbExporter {
  /** @param {{logFile:string, user:string, onStatus:(text:string)=>void}} deps */
  constructor({ logFile, user, onStatus }) {
    this.logFile = logFile;
    this.user = user;
    this.onStatus = onStatus;
    this.watcher = null;
    this.busyUntil = 0;
    this.idleTimer = null;
  }

  async start() {
    this.onStatus(USB_IDLE_TEXT);
    this.idleTimer = setInterval(() => this.onStatus(USB_IDLE_TEXT), 30000);
    this.idleTimer.unref?.();
    const r = await run('mkdir', ['-p', MOUNT_POINT], { sudo: true });
    if (r.code === 0) {
      await run('chown', ['-R', `${this.user}:${this.user}`, MOUNT_POINT], { sudo: true });
      await run('chmod', ['-R', '775', MOUNT_POINT], { sudo: true });
    }
    if (!fs.existsSync('/dev')) return;
    try {
      this.watcher = fs.watch('/dev', (_event, name) => {
        if (name && /^sd[a-z]$/.test(name)) this.#detected('/dev/' + name);
      });
    } catch (err) {
      console.warn('[usb] cannot watch /dev:', err.message);
    }
  }

  async #detected(device) {
    if (Date.now() < this.busyUntil) return; // legacy "send once" (1 s, drop)
    this.busyUntil = Date.now() + 1000;
    const partition = device + '1';
    this.onStatus(partition + ' detected');
    const uid = `uid=${this.user},gid=${this.user}`;
    let r = await run('mount', ['-o', uid, partition, MOUNT_POINT], { sudo: true });
    if (r.code !== 0) return this.onStatus(r.stderr.trim());
    r = await run('cp', [this.logFile, path.join(MOUNT_POINT, path.basename(this.logFile))], { sudo: true });
    if (r.code !== 0) return this.onStatus(r.stderr.trim());
    r = await run('umount', [MOUNT_POINT], { sudo: true });
    if (r.code !== 0) return this.onStatus(r.stderr.trim());
    this.onStatus('Success, remove USB drive.');
  }

  stop() {
    this.watcher?.close();
    clearInterval(this.idleTimer);
  }
}
