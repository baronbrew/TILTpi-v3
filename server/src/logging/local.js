// Local CSV logging (legacy "Setup Local Log" → "changed?" → file append, "Delete Log", stat).
import fs from 'node:fs';
import path from 'node:path';

export const LOG_HEADER = 'Time,Timepoint,Temp,SG,Beer,Color,Comment,RSSI,Uptime';
const REWRITE_AFTER_MS = 900000; // write an unchanged line at least every 15 min

/** Returns the CSV line if `reading` is due for local logging (updates lastlocalpost), else null. */
export function localLogLineFor(reading, settings, date = new Date()) {
  const g = settings.global;
  const interval = (g.localloggingInterval || 15) * 60000;
  if (!g.logLocalDataCheck || reading.Color === undefined) return null;
  const rt = settings.runtime(reading.Color);
  const lastPost = rt.lastlocalpost || 0;
  if (!(reading.timeStamp - lastPost > interval)) return null;
  const Comment = rt.comment || '';
  const Beer = settings.tilt(reading.Color).Beer || ['Untitled', true];
  const when = date.toLocaleString().replace(',', ' ');
  const txUnsigned = reading.tx_power & 0xff; // "unsigned bonus byte"
  rt.lastlocalpost = reading.timeStamp;
  return (
    when + ',' + reading.Timepoint + ',' + reading.Temp + ',' + reading.SG + ',' + Beer[0] + ',' +
    reading.Color + ',' + Comment + ',' + reading.rssi + ',' + txUnsigned
  );
}

export class LocalLogger {
  /**
   * @param {object} deps
   * @param {string} deps.dataDir
   * @param {import('../settings.js').Settings} deps.settings
   * @param {(text:string)=>void} deps.onSize
   */
  constructor({ dataDir, settings, onSize }) {
    this.file = path.join(dataDir, 'log.csv');
    this.settings = settings;
    this.onSize = onSize;
    this.prev = new Map(); // color -> {data, time}  (legacy "changed?" context)
  }

  init() {
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, LOG_HEADER + '\n');
    this.reportSize();
  }

  consider(reading, now = Date.now()) {
    const line = localLogLineFor(reading, this.settings);
    if (line === null) return;
    this.reportSize();
    const color = reading.Color;
    const fields = line.split(',');
    const current = fields[2] + fields[3] + fields[4] + fields[6];
    const prev = this.prev.get(color) ?? { data: [], time: now };
    if (prev.data !== current || now - prev.time > REWRITE_AFTER_MS) {
      this.prev.set(color, { data: current, time: now });
      if (!this.settings.global.logCloudDataCheck) this.settings.runtime(color).comment = '';
      fs.appendFileSync(this.file, line + '\n');
    }
  }

  /** "Delete Log": rewrite with the header only. */
  reset() {
    fs.writeFileSync(this.file, LOG_HEADER + '\n');
    this.reportSize();
  }

  reportSize() {
    let size = 0;
    try {
      size = fs.statSync(this.file).size;
    } catch {}
    this.onSize(`Size: ${size} bytes`);
  }
}
