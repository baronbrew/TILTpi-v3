// Keeps writing the legacy <data>/global.json and <data>/<Color>.json backups ("Changed?" node),
// so GET /data/... keeps returning the same thing and a downgrade to Node-RED still works.
import fs from 'node:fs';
import path from 'node:path';

const FLUSH_MS = 15000;

export function watchedString(p) {
  return (
    p.Beer + p.unCalSGPoints + p.actualSGPoints + p.actualTempPoints + p.unCalTempPoints +
    p.fermunits + p.tempunits + p.defaultcloudURL + p.customcloudURL + p.logCloudDataCheck +
    p.logLocalDataCheck + p.localloggingInterval + p.loggingInterval + p.minRSSI + p.IDbyMAC +
    p.alphaSG + p.alphaTemp + p.numberSamples + p.smoothSwitch + p.enableRangeBoost + p.rangerHostnames
  );
}

/** File name for a Color; ':' is not allowed on Windows dev machines. */
export function backupFileName(color) {
  return (process.platform === 'win32' ? color.replace(/:/g, '_') : color) + '.json';
}

export class LegacyBackup {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.watched = new Map();
    this.pending = new Map();
    this.timer = setInterval(() => this.flush(), FLUSH_MS);
    this.timer.unref?.();
  }

  /** `p` is the enriched (pre-smoothing) payload. */
  consider(p) {
    const current = watchedString(p);
    if (this.watched.get(p.Color) === current) return;
    this.watched.set(p.Color, current);
    this.pending.set(p.Color, JSON.parse(JSON.stringify(p)));
  }

  flush() {
    for (const [color, payload] of this.pending) {
      const text = JSON.stringify(payload);
      try {
        fs.writeFileSync(path.join(this.dataDir, 'global.json'), text);
        fs.writeFileSync(path.join(this.dataDir, backupFileName(color)), text);
      } catch (err) {
        console.warn('[backup] write failed:', err.message);
      }
    }
    this.pending.clear();
  }

  stop() {
    clearInterval(this.timer);
    this.flush();
  }
}
