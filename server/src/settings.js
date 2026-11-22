// Settings store: replaces the Node-RED flow context.
//  - global:  app-wide settings (persisted)
//  - tilts:   per-Tilt settings keyed by Color ("RED" or "RED:aa:bb:..") (persisted)
//  - runtime: per-Tilt values that legacy never persisted (comment, cloud doc link, last posts)
// Persisted to <dataDir>/settings.json. On first start, imported from legacy global.json/<Color>.json.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { toPointArray, cToFPoint } from './tilt/calibration.js';

export const GLOBAL_DEFAULTS = Object.freeze({
  useDefaultCloudURL: true,
  logCloudDataCheck: true,
  logLocalDataCheck: false,
  loggingInterval: 15, // minutes, cloud
  localloggingInterval: 15, // minutes, log.csv
  fermdisplayUnits: '', // '' (SG) | '°P' | '°Bx'
  displayUnits: '°F', // '°F' | '°C'
  minRSSI: -105,
  IDbyMAC: false,
  smoothSwitch: false,
  alphaSG: 100,
  alphaTemp: 100,
  numberSamples: 0.5,
  enableRangeBoost: false,
  rangerHostnames: [],
  screenZoom: 1,
  screenTimeout: null, // seconds; null = never chosen
  locale: '', // date format, e.g. 'en-US'; '' = the Pi's system locale (legacy)
  tempPointsUnit: '', // '°F' once temperature cal points are stored in °F (see migrateTempPoints)
});

const TILT_FIELDS = ['Beer', 'actualSGPoints', 'uncalSGPoints', 'actualTempPoints', 'uncalTempPoints', 'cloudURLs'];

export class Settings extends EventEmitter {
  /** @param {string} dataDir */
  constructor(dataDir) {
    super();
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'settings.json');
    this.global = { ...GLOBAL_DEFAULTS, rangerHostnames: [] };
    /** @type {Record<string, any>} */
    this.tilts = {};
    /** @type {Map<string, {comment:string, docURL:string, lastpost:number, lastlocalpost:number}>} */
    this.runtimeByColor = new Map();
    this.saveTimer = null;
  }

  load() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (fs.existsSync(this.file)) {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      Object.assign(this.global, saved.global ?? {});
      this.tilts = saved.tilts ?? {};
      if (this.#migrateTempPoints()) this.saveNow();
      return { migrated: false };
    }
    const migrated = this.#importLegacy();
    this.#migrateTempPoints();
    this.saveNow();
    return { migrated };
  }

  /**
   * One time: temperature cal points used to be in the display unit (legacy, and this port before
   * they were stored in °F). Points saved while the display unit was °C are converted to °F.
   */
  #migrateTempPoints() {
    if (this.global.tempPointsUnit === '°F') return false;
    if (this.global.displayUnits === '°C') {
      let converted = 0;
      for (const t of Object.values(this.tilts)) {
        for (const k of ['uncalTempPoints', 'actualTempPoints']) {
          if (t[k] === undefined) continue;
          t[k] = toPointArray(t[k]).map(cToFPoint);
          converted += t[k].length;
        }
      }
      if (converted) console.log(`[settings] converted ${converted / 2} °C temperature calibration point(s) to °F`);
    }
    this.global.tempPointsUnit = '°F';
    return true;
  }

  /** Per-Tilt persisted settings (created on demand, not saved until changed). */
  tilt(color) {
    return this.tilts[color] ?? {};
  }

  runtime(color) {
    let r = this.runtimeByColor.get(color);
    if (!r) {
      r = { comment: '', docURL: '', lastpost: 0, lastlocalpost: 0 };
      this.runtimeByColor.set(color, r);
    }
    return r;
  }

  setGlobal(patch) {
    Object.assign(this.global, patch);
    this.#changed();
  }

  setTilt(color, patch) {
    this.tilts[color] = { ...this.tilts[color], ...patch };
    this.#changed();
  }

  #changed() {
    this.emit('change');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 300);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    const data = JSON.stringify({ version: 1, global: this.global, tilts: this.tilts }, null, 2);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, this.file);
  }

  // ---- legacy import ("Restore Global" + "Restore Tilt Settings") ----
  #importLegacy() {
    let imported = false;
    const g = readJson(path.join(this.dataDir, 'global.json'));
    if (g && typeof g === 'object') {
      imported = true;
      const set = (key, value) => {
        if (value !== undefined && value !== null) this.global[key] = value;
      };
      set('logCloudDataCheck', g.logCloudDataCheck);
      set('logLocalDataCheck', g.logLocalDataCheck);
      set('localloggingInterval', g.localloggingInterval);
      set('loggingInterval', g.loggingInterval);
      if (Array.isArray(g.defaultcloudURL)) set('useDefaultCloudURL', g.defaultcloudURL[1] !== false);
      set('fermdisplayUnits', g.fermunits);
      set('displayUnits', g.tempunits);
      set('minRSSI', g.minRSSI);
      set('IDbyMAC', g.IDbyMAC);
      this.global.alphaSG = g.alphaSG || 100;
      this.global.alphaTemp = g.alphaTemp || 100;
      this.global.numberSamples = g.numberSamples || 0.5;
      this.global.smoothSwitch = g.smoothSwitch || false;
      this.global.enableRangeBoost = g.enableRangeBoost === '%invalid_hostname';
      if (Array.isArray(g.rangerHostnames)) this.global.rangerHostnames = g.rangerHostnames;
    }
    for (const name of safeReaddir(this.dataDir)) {
      if (!name.endsWith('.json') || name === 'settings.json') continue;
      const t = readJson(path.join(this.dataDir, name));
      if (!t || typeof t !== 'object' || typeof t.Color !== 'string') continue;
      imported = true;
      this.tilts[t.Color] = {
        Beer: Array.isArray(t.Beer) ? t.Beer : ['Untitled', true],
        actualSGPoints: toPointArray(t.actualSGPoints),
        uncalSGPoints: toPointArray(t.unCalSGPoints),
        actualTempPoints: toPointArray(t.actualTempPoints),
        uncalTempPoints: toPointArray(t.unCalTempPoints),
        ...(typeof t.customcloudURL === 'string' ? { cloudURLs: t.customcloudURL } : {}),
      };
    }
    return imported;
  }
}

export { TILT_FIELDS };

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}
