// Cloud logging (legacy "Setup Cloud Post" → 1-per-5s rate limit → "Cloud Service" http request
// → "filter cloud response" / "update name, clear comment" / "Reset Result").
import { DEFAULT_CLOUD_URL } from '../tilt/enrich.js';

export const SEND_SPACING_MS = 5000;
export const STATUS_RESET_MS = 30000;
export const REQUEST_TIMEOUT_MS = 60000;
export const WAITING_TEXT = 'Waiting for next time point...';

/**
 * Decide whether `reading` is due for a cloud post; if so, mark it posted and return the
 * requests to send (one per URL). Pure apart from updating `runtime.lastpost`.
 */
export function cloudPostsFor(reading, settings) {
  const g = settings.global;
  const postEnabled = g.logCloudDataCheck || false;
  const interval = (g.loggingInterval || 15) * 60000;
  if (!postEnabled || reading.Color === undefined) return [];
  const rt = settings.runtime(reading.Color);
  const lastPost = rt.lastpost || 0;
  if (!(reading.timeStamp - lastPost > interval)) return [];
  rt.lastpost = reading.timeStamp;

  const Comment = rt.comment || '';
  let Beer = settings.tilt(reading.Color).Beer || ['Untitled', true];
  if (Beer[1] === true) Beer = Beer[0];
  const body = encodeURI(
    'Timepoint=' + reading.Timepoint + '&Temp=' + reading.Temp + '&SG=' + reading.SG +
      '&Beer=' + Beer + '&Color=' + reading.Color + '&Comment=' + Comment,
  );
  if (g.useDefaultCloudURL) {
    return [{ url: DEFAULT_CLOUD_URL, body, cloudwait: 'Contacting Default Cloud URL...<br>(allow up to 30 seconds)' }];
  }
  const cloudURLs = settings.tilt(reading.Color).cloudURLs || 'none';
  if (cloudURLs == 'none') return [];
  return cloudURLs.split(',').map((url, i) => ({
    url,
    body,
    cloudwait: 'Contacting Cloud URL ' + (i + 1) + '...<br>(allow up to 30 seconds)',
  }));
}

export class CloudLogger {
  /**
   * @param {object} deps
   * @param {import('../settings.js').Settings} deps.settings
   * @param {(toast:object)=>void} deps.toast
   * @param {(status:object)=>void} deps.onStatus       Cloud Status box contents changed
   * @param {(color:string)=>void} deps.onBeerUpdated   cloud assigned a beer name/id to a Tilt
   * @param {typeof fetch} [deps.fetchImpl]
   */
  constructor({ settings, toast, onStatus, onBeerUpdated, fetchImpl = fetch }) {
    this.settings = settings;
    this.toast = toast;
    this.onStatus = onStatus;
    this.onBeerUpdated = onBeerUpdated;
    this.fetch = fetchImpl;
    this.queue = [];
    this.lastSendAt = 0;
    this.drainTimer = null;
    this.resetTimer = null;
    this.status = { cloudwait: '', result: '', tiltcolor: undefined };
  }

  /** Called from the 1 s tick for every displayed reading. */
  consider(reading) {
    for (const req of cloudPostsFor(reading, this.settings)) this.#enqueue(req);
  }

  #enqueue(req) {
    this.queue.push(req);
    this.#drain();
  }

  #drain() {
    if (this.drainTimer || this.queue.length === 0) return;
    const wait = Math.max(0, this.lastSendAt + SEND_SPACING_MS - Date.now());
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      const req = this.queue.shift();
      if (req) {
        this.lastSendAt = Date.now();
        this.#send(req);
      }
      this.#drain();
    }, wait);
  }

  async #send(req) {
    this.#setStatus({ cloudwait: req.cloudwait, result: undefined, tiltcolor: undefined });
    let payload;
    try {
      const res = await this.fetch(req.url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
        body: req.body,
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await res.text();
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    } catch (err) {
      this.toast({ message: 'Alert: ' + (err?.cause?.message || err?.message || String(err)), displayTime: 3 });
      return;
    }
    this.handleResponse(payload, req);
  }

  /** "update name, clear comment" + "filter cloud response". */
  handleResponse(payload, req) {
    if (payload && typeof payload === 'object' && typeof payload.beername === 'string') {
      if (payload.beername.indexOf(',') > -1) {
        const color = payload.tiltcolor;
        this.settings.setTilt(color, { Beer: payload.beername.split(',') });
        const rt = this.settings.runtime(color);
        rt.comment = '';
        if (payload.doclongurl !== undefined) rt.docURL = payload.doclongurl;
        this.onBeerUpdated(color);
      }
    }
    const result = payload && typeof payload === 'object' ? payload.result : undefined;
    const tiltcolor = payload && typeof payload === 'object' ? payload.tiltcolor : undefined;
    this.#setStatus({ cloudwait: req.cloudwait, result, tiltcolor });
  }

  #setStatus(status) {
    this.status = status;
    this.onStatus(status);
    clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => {
      this.status = { cloudwait: '', result: WAITING_TEXT, tiltcolor: undefined };
      this.onStatus(this.status);
    }, STATUS_RESET_MS);
    this.resetTimer.unref?.();
  }

  stop() {
    clearTimeout(this.drainTimer);
    clearTimeout(this.resetTimer);
  }
}
