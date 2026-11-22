// TiltPiApp: owns all state and wires scanner → pipeline → display/logging, and handles UI commands.
// The HTTP/WebSocket layer (http/server.js) only translates requests into calls on this class.
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { Settings } from './settings.js';
import { isTiltUuid } from './tilt/colors.js';
import { enrichScan, DEFAULT_CLOUD_URL } from './tilt/enrich.js';
import { Smoother } from './tilt/smoothing.js';
import { applyCalibration, addPoint, removePoint, cToFPoint } from './tilt/calibration.js';
import { ReadingStore } from './tilt/readings.js';
import { ScanSnapshot } from './tilt/scanSnapshot.js';
import { CloudLogger } from './logging/cloud.js';
import { LocalLogger } from './logging/local.js';
import { LegacyBackup } from './logging/legacyBackup.js';
import { RangeBooster, MAX_RANGERS } from './rangeBoost.js';
import { UsbExporter } from './system/usb.js';
import * as sys from './system/system.js';
import { importWifi, takeCloudLogFiles, peekCloudLogSetup } from './system/provisioning.js';
import { normalizeLocale, temperatureUnitFor } from './locale.js';
import { MdnsWatchdog, CHECK_MS as MDNS_CHECK_MS } from './system/mdns.js';
import { currentVersion, checkLatestRelease, startUpdate } from './system/updater.js';

// Cloud provisioning (SETUP.html) waits for these instead of legacy's fixed 60 s before "Send IP Addr".
const WAIT_POLL_MS = 2000;
const WAIT_FOR_IP_MS = 5 * 60000; // network up (has an IPv4 address)
const WAIT_FOR_REGISTRATION_MS = 60000; // first post's reply assigned the cloud sheet

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Polls `check` until it returns truthy or `timeoutMs` passes; returns the last result. */
async function waitFor(check, timeoutMs, pollMs = WAIT_POLL_MS) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await check();
    if (v || Date.now() >= end) return v;
    await sleep(pollMs);
  }
}

async function dryRunCloudFetch(url, { body }) {
  console.log(`[dry-run] POST ${url} ${body}`);
  // Shaped like the Google Script's reply (HTML in "result"), so the UI can be checked in dev.
  const params = new URLSearchParams(decodeURI(body));
  const color = params.get('Color') ?? 'BLACK';
  const beer = params.get('Beer') ?? 'Untitled';
  // An email comment registers a new cloud log: the reply carries "name,<sheet id>", like the script.
  const beername = (params.get('Comment') ?? '').includes('@') ? beer.split(',')[0] + ',dryrun-sheet' : beer;
  return new Response(JSON.stringify({
    result: `${beer.split(',')[0]}<br><strong>TILT | ${color}</strong><br>Success logging to the cloud. (dry-run, not sent)`
      + '<br><a class="link external" href="https://example.com/">View Cloud Log</a>',
    beername,
    tiltcolor: color,
  }));
}

export class TiltPiApp extends EventEmitter {
  /** @param {typeof import('./config.js').config} config @param {{scanner?:any}} [opts] */
  constructor(config, { scanner } = {}) {
    super();
    this.config = config;
    this.settings = new Settings(config.dataDir);
    this.readings = new ReadingStore();
    this.smoother = new Smoother();
    this.snapshot = new ScanSnapshot();
    this.backup = new LegacyBackup(config.dataDir);
    this.scanner = scanner;
    this.timers = [];

    // UI-visible state that is not a setting (legacy: last message replayed by each widget)
    this.ui = {
      cloudStatus: { cloudwait: '', result: '', tiltcolor: undefined },
      loggingTemplate: 'B2',
      logSize: '',
      usbStatus: '',
      timeStatus: '',
      systemTime: '',
      ipLink: '',
      hostnameLink: '',
      mdns: { ok: null, text: 'Not checked yet' },
      version: currentVersion(config.appDir),
      latest: { enabled: false, label: '', text: '' },
    };

    this.mdns = new MdnsWatchdog({ onStatus: (s) => this.#setUi({ mdns: s }) });

    this.cloud = new CloudLogger({
      settings: this.settings,
      toast: (t) => this.toast(t),
      onStatus: (s) => this.#setUi({ cloudStatus: s }),
      onBeerUpdated: (color) => this.emit('beerUpdated', color),
      // Development machines must never post fake readings to real cloud endpoints.
      ...(config.dryRun ? { fetchImpl: dryRunCloudFetch } : {}),
    });
    this.local = new LocalLogger({
      dataDir: config.dataDir,
      settings: this.settings,
      onSize: (text) => this.#setUi({ logSize: text }),
    });
    this.usb = new UsbExporter({
      logFile: path.join(config.dataDir, 'log.csv'),
      user: config.user,
      onStatus: (text) => this.#setUi({ usbStatus: text }),
    });
    this.rangeBoost = new RangeBooster({
      settings: this.settings,
      onScan: (s) => this.processScan(s),
      onStatus: () => this.emit('state'),
    });
    this.provisioningPending = true; // legacy "Send Tilt Colors" startup flag
    this.settings.on('change', () => this.emit('state'));
  }

  // ------------------------------------------------------------------ lifecycle
  async start() {
    const { migrated } = this.settings.load();
    if (migrated) console.log('[settings] imported legacy Node-RED settings');
    sys.writeKioskConfig(this.config.dataDir, this.settings.global);
    this.local.init();
    this.snapshot.start();
    this.rangeBoost.start();
    this.usb.start().catch((e) => console.warn('[usb]', e.message));
    importWifi(this.config.bootDir).catch((e) => console.warn('[wifi]', e.message));
    // SETUP.html's time zone/locale are applied before any reading is timestamped or formatted.
    const setup = peekCloudLogSetup(this.config.bootDir);
    await this.#applyTimezone(setup.Timezone);
    this.#applyLocale(setup.Locale);

    this.#every(1000, () => this.tick());
    this.#every(60000, () => this.refreshSystemTime(), true);
    this.#every(86400000, () => this.refreshLatestRelease(), true);
    setTimeout(() => this.refreshLinks(), 10000).unref?.();
    if (!this.config.dryRun) {
      // Local name self-check (see system/mdns.js); first one after avahi has had time to start.
      setTimeout(() => this.mdns.testAndReset(), 60000).unref?.();
      this.#every(MDNS_CHECK_MS, () => this.mdns.testAndReset());
    }
    this.refreshLinks();

    if (this.scanner) {
      this.scanner.on('scan', (scan) => this.onRawScan(scan));
      await this.scanner.start();
    }
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.scanner?.stop();
    this.snapshot.stop();
    this.cloud.stop();
    this.rangeBoost.stop();
    this.usb.stop();
    this.backup.stop();
    this.settings.saveNow();
  }

  #every(ms, fn, immediately = false) {
    const t = setInterval(fn, ms);
    t.unref?.();
    this.timers.push(t);
    if (immediately) fn();
  }

  // ------------------------------------------------------------------ pipeline
  /** Scans heard by our own radio (also published on /tiltscan). */
  onRawScan(scan) {
    this.snapshot.add(scan);
    this.processScan(scan);
  }

  processScan(scan) {
    const g = this.settings.global;
    if (!(scan.rssi >= g.minRSSI)) return;
    if (!isTiltUuid(scan.uuid)) return;
    const p = enrichScan(scan, this.settings);
    if (this.readings.noteColor(p.Color)) this.emit('state');
    this.backup.consider(p);
    this.smoother.apply(p, g);
    applyCalibration(p);
    const slot = this.readings.store(p);
    if (slot === 0 && this.provisioningPending) {
      this.provisioningPending = false;
      this.#provisionCloudLogging().catch((e) => console.warn('[provisioning]', e.message));
    }
  }

  tick() {
    this.readings.tick(Date.now(), (r) => {
      this.cloud.consider(r);
      this.local.consider(r);
    });
    this.emit('state');
  }

  /**
   * SETUP.html puts the browser's time zone in cloud_log_<color>.json. Applied at startup (before
   * any reading is timestamped) and to this process too, so the first log entries are already in
   * local time without a restart.
   */
  async #applyTimezone(tz) {
    if (typeof tz !== 'string' || !tz || tz === sys.currentTimezone()) return;
    const r = await sys.setTimezone(tz);
    if (r.code !== 0) return console.warn(`[provisioning] could not set time zone "${tz}":`, r.stderr);
    process.env.TZ = tz;
    console.log(`[provisioning] time zone set to ${tz}`);
    this.refreshSystemTime();
  }

  /** Browser locale from SETUP.html: date format on the cards and in log.csv, °F/°C for its country. */
  #applyLocale(tag) {
    const locale = normalizeLocale(tag);
    if (!locale || locale === this.settings.global.locale) return;
    const displayUnits = temperatureUnitFor(locale);
    this.settings.setGlobal({ locale, ...(displayUnits ? { displayUnits } : {}) });
    console.log(`[provisioning] locale ${locale}${displayUnits ? ', temperature ' + displayUnits : ''}`);
  }

  /** cloud_log_<color>.json from SETUP.html ("Set Up Tilt Pi" + "Send IP Addr"). */
  async #provisionCloudLogging() {
    for (const file of await takeCloudLogFiles(this.config.bootDir)) {
      const color = file.Color;
      if (typeof color !== 'string') continue;
      await this.#applyTimezone(file.Timezone); // normally already done at startup
      this.#applyLocale(file.Locale); // normally already done at startup
      this.settings.setGlobal({
        useDefaultCloudURL: true,
        logCloudDataCheck: true,
        loggingInterval: 15,
        logLocalDataCheck: true,
        localloggingInterval: 15,
      });
      this.settings.setTilt(color, { Beer: Array.isArray(file.Beer) ? file.Beer : ['Untitled', true] });
      this.local.reset();
      this.#sendSetupPosts(color, file.Comment ?? '').catch((e) => console.warn('[provisioning]', e.message));
    }
  }

  /**
   * "Set Up Tilt Pi" + "Send IP Addr": post the email (the cloud script creates the log and emails
   * it), then post the dashboard link (emailed too). Legacy posted at once and sent the link after a
   * fixed 60 s; here each post waits for what it needs instead.
   */
  async #sendSetupPosts(color, email) {
    const rt = this.settings.runtime(color);
    const hasIp = async () => {
      const ip = await sys.getIpv4();
      return /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !/^(127|169\.254)\./.test(ip) ? ip : '';
    };
    // 1. Network up, so the email post isn't lost to a WiFi connection that's still coming up.
    if (!(await waitFor(hasIp, WAIT_FOR_IP_MS))) console.warn('[provisioning] no IP address yet; posting anyway');
    rt.comment = email;
    rt.lastpost = 0;
    // 2. The reply to that post sets the cloud sheet id (Beer[1]); the link post must carry it or
    //    the script would start a second log. No email → no sheet to wait for (legacy didn't either).
    if (email) {
      const registered = () => this.settings.tilt(color).Beer?.[1] !== true;
      if (!(await waitFor(registered, WAIT_FOR_REGISTRATION_MS))) {
        console.warn('[provisioning] cloud log not confirmed yet; sending dashboard link anyway');
      }
    }
    // 3. Dashboard link from the current address (not the one seen at startup).
    await this.refreshLinks();
    rt.comment = this.ui.ipLink || 'http://tiltpi.local:1880/ui';
    rt.lastpost = 0;
    console.log(`[provisioning] ${color}: setup email${email ? '' : ' (none)'} and dashboard link ${rt.comment} queued`);
  }

  // ------------------------------------------------------------------ UI state
  #setUi(patch) {
    Object.assign(this.ui, patch);
    this.emit('state');
  }

  toast({ topic = '', message = '', displayTime = 3, dialog = null }) {
    this.emit('toast', { topic, message: String(message ?? ''), displayTime, dialog });
  }

  async refreshSystemTime() {
    this.#setUi({ systemTime: await sys.systemTimeText() });
  }

  async refreshLinks() {
    const ip = await sys.getIpv4();
    this.#setUi({
      ipLink: 'http://' + ip + ':1880/ui',
      hostnameLink: 'http://' + sys.getHostname() + '.local:1880/ui',
    });
  }

  async refreshLatestRelease() {
    this.#setUi({ latest: await checkLatestRelease(this.config.repo, this.ui.version) });
  }

  /** Everything the dashboard renders. Sent on connect, after changes, and every second. */
  state() {
    const g = this.settings.global;
    const tilts = {};
    for (const color of new Set([...Object.keys(this.settings.tilts), ...this.readings.options])) {
      const t = this.settings.tilt(color);
      const rt = this.settings.runtime(color);
      tilts[color] = {
        Beer: t.Beer ?? ['Untitled', true],
        actualSGPoints: t.actualSGPoints ?? [],
        uncalSGPoints: t.uncalSGPoints ?? [],
        actualTempPoints: t.actualTempPoints ?? [],
        uncalTempPoints: t.uncalTempPoints ?? [],
        cloudURLs: t.cloudURLs,
        docURL: rt.docURL,
      };
    }
    return {
      now: Date.now(),
      slots: this.readings.slots.map((r) => r ?? null),
      options: this.readings.options,
      settings: g,
      defaultCloudURL: DEFAULT_CLOUD_URL,
      tilts,
      ui: this.ui,
      rangerUrls: Array.from({ length: MAX_RANGERS }, (_, i) =>
        g.rangerHostnames?.[i] ? this.rangeBoost.urlFor(g.rangerHostnames[i]) : '',
      ),
      rangerStatus: this.rangeBoost.status,
    };
  }

  // ------------------------------------------------------------------ commands from the UI
  async command(name, args = {}) {
    const handler = this.commands[name];
    if (!handler) throw new Error('Unknown command: ' + name);
    return handler.call(this, args);
  }

  commands = {
    // ---- Logging tab
    setBeerName({ color, value }) {
      if (!color) return;
      const beer = String(value ?? '').split(',');
      if (beer[1] === undefined) {
        beer[1] = true;
        this.settings.runtime(color).docURL = '';
      }
      this.settings.setTilt(color, { Beer: beer });
      this.toast({
        topic: 'Beer name set for ' + color,
        message: beer[1] === true ? beer[0] : beer[0] + ',' + beer[1],
        displayTime: 5,
      });
    },
    setUseDefaultCloudURL({ value }) {
      this.settings.setGlobal({ useDefaultCloudURL: !!value });
    },
    setCloudURL({ color, value }) {
      if (!color) return;
      // One or more URLs, comma-separated (legacy format); tidy spaces and empty entries.
      const urls = String(value ?? '').split(',').map((u) => u.trim()).filter(Boolean).join(',');
      this.settings.setTilt(color, { cloudURLs: urls });
      if (!urls) return this.toast({ topic: 'Custom cloud URLs cleared for ' + color, message: '' });
      this.toast({ topic: 'Custom cloud URL set for ' + color, message: urls.replace(/,/g, '<br>'), displayTime: 5 });
    },
    setLoggingTemplate({ value }) {
      this.#setUi({ loggingTemplate: value === 'B1' ? 'B1' : 'B2' });
    },
    submitEmail({ color, email }) {
      if (!email) return;
      this.lastEmail = email; // "Use as default email" turned on later adopts it
      if (this.settings.global.useDefaultEmail) this.settings.setGlobal({ defaultEmail: email });
      const gMap = { '°P': 'Plato', '°Bx': 'Brix' };
      const tMap = { '°F': 'Fahrenheit', '°C': 'Celsius' };
      const g = this.settings.global;
      const comment = JSON.stringify({
        template: this.ui.loggingTemplate || 'B2',
        email,
        gunits: gMap[g.fermdisplayUnits] ?? (g.fermdisplayUnits || 'SG'),
        tunits: tMap[g.displayUnits] ?? (g.displayUnits || 'Fahrenheit'),
        Comment: '',
      });
      this.commands.submitComment.call(this, { color, comment });
    },
    setUseDefaultEmail({ value }) {
      const on = !!value;
      // On: remember the email just used (if any). Off: forget it.
      this.settings.setGlobal({
        useDefaultEmail: on,
        defaultEmail: on ? this.settings.global.defaultEmail || this.lastEmail || '' : '',
      });
    },
    submitComment({ color, comment }) {
      if (!comment || !color) return;
      const rt = this.settings.runtime(color);
      rt.comment = comment;
      rt.lastpost = 0;
      rt.lastlocalpost = 0;
      let shown = comment;
      try {
        shown = JSON.parse(comment).email ?? comment;
      } catch {}
      this.toast({ topic: 'TILT | ' + color, message: 'Sending: ' + shown, displayTime: 8 });
    },
    setLogCloud({ color, value }) {
      this.settings.setGlobal({ logCloudDataCheck: !!value });
      if (color) this.settings.runtime(color).lastpost = 0;
      this.toast({
        topic: 'TILT | ' + (color ?? ''),
        message: value ? 'Logging request sent. Waiting for response.' : 'Logging disabled.',
        displayTime: 8,
      });
    },
    setCloudInterval({ value }) {
      this.settings.setGlobal({ loggingInterval: Number(value) });
    },
    setLogLocal({ color, value }) {
      this.settings.setGlobal({ logLocalDataCheck: !!value });
      if (color) this.settings.runtime(color).lastlocalpost = 0;
      this.toast({ message: value ? 'Logging to Tilt Pi enabled.' : 'Logging disabled.', displayTime: 8 });
    },
    setLocalInterval({ value }) {
      this.settings.setGlobal({ localloggingInterval: Number(value) });
    },
    deleteLog() {
      this.local.reset();
    },

    // ---- Calibration tab
    addSGPoint({ color, kind, uncal, actual }) {
      if (!color) return;
      const u = uncal === undefined || uncal === null || uncal === '' ? 0 : Number(uncal).toFixed(4);
      let a = actual === undefined || actual === null || actual === '' ? 0 : Number(actual).toFixed(4);
      if (kind === 'water') a = '1.0000';
      const t = this.settings.tilt(color);
      const r = addPoint(t.uncalSGPoints, t.actualSGPoints, u, a);
      this.settings.setTilt(color, { uncalSGPoints: r.uncal, actualSGPoints: r.actual });
    },
    removeSGPoint({ color, index }) {
      const t = this.settings.tilt(color);
      const r = removePoint(t.uncalSGPoints, t.actualSGPoints, Number(index));
      this.settings.setTilt(color, { uncalSGPoints: r.uncal, actualSGPoints: r.actual });
    },
    clearSGPoints({ color }) {
      this.settings.setTilt(color, { uncalSGPoints: [], actualSGPoints: [] });
    },
    addTempPoint({ color, kind, uncal, actual }) {
      if (!color) return;
      // Entered in the display unit; stored in °F (see tilt/calibration.js).
      const inC = this.settings.global.displayUnits === '°C';
      const toF = (v) => (inC ? cToFPoint(v) : Number(v).toFixed(1));
      const u = uncal === undefined || uncal === null || uncal === '' ? toF(0) : toF(uncal);
      let a = actual === undefined || actual === null || actual === '' ? toF(0) : toF(actual);
      if (kind === 'ice') a = '32.0';
      const t = this.settings.tilt(color);
      const r = addPoint(t.uncalTempPoints, t.actualTempPoints, u, a);
      this.settings.setTilt(color, { uncalTempPoints: r.uncal, actualTempPoints: r.actual });
    },
    removeTempPoint({ color, index }) {
      const t = this.settings.tilt(color);
      const r = removePoint(t.uncalTempPoints, t.actualTempPoints, Number(index));
      this.settings.setTilt(color, { uncalTempPoints: r.uncal, actualTempPoints: r.actual });
    },
    clearTempPoints({ color }) {
      this.settings.setTilt(color, { uncalTempPoints: [], actualTempPoints: [] });
    },

    // ---- System tab
    async applyTimezone({ tz }) {
      const r = await sys.setTimezone(tz);
      if (r.code !== 0) return this.toast({ topic: 'Error', message: r.stderr });
      // Legacy needed a restart; applying it to this process too makes it take effect now.
      process.env.TZ = tz;
      this.#setUi({ timeStatus: '' });
      this.refreshSystemTime();
      this.toast({ topic: 'Time Zone', message: `Time zone set to ${tz}` });
    },
    async setSystemTime({ value }) {
      const r = await sys.setSystemTime(value);
      if (r.code === 0) this.toast({ topic: 'System Time Updated', message: r.stdout.trim() });
      else this.toast({ message: r.stderr.trim() });
      this.refreshSystemTime();
    },
    setLocale({ value }) {
      const locale = value === '' ? '' : normalizeLocale(value);
      if (value !== '' && !locale) return this.toast({ topic: 'Alert', message: `Unknown locale "${value}"` });
      this.settings.setGlobal({ locale });
    },
    setTempUnits({ value }) {
      if (value === '°C' || value === '°F') this.settings.setGlobal({ displayUnits: value });
    },
    setFermUnits({ value }) {
      if (['', '°P', '°Bx'].includes(value)) this.settings.setGlobal({ fermdisplayUnits: value });
    },
    setSmoothing({ value }) {
      this.settings.setGlobal({ smoothSwitch: !!value });
    },
    setAlphaSG({ value }) {
      this.settings.setGlobal({ alphaSG: Number(value) });
    },
    setAlphaTemp({ value }) {
      this.settings.setGlobal({ alphaTemp: Number(value) });
    },
    setNumberSamples({ value }) {
      this.settings.setGlobal({ numberSamples: Number(value) });
    },
    setMinRSSI({ value }) {
      this.settings.setGlobal({ minRSSI: Number(value) });
    },
    setIDbyMAC({ value }) {
      this.settings.setGlobal({ IDbyMAC: !!value });
      this.readings.reset(); // legacy: temporary 5 s display timeout to rebuild the slots
    },
    async updateApp() {
      this.toast({ topic: 'Update', message: 'Downloading update. Tilt Pi will restart when finished.' });
      const r = await startUpdate(this.config.appDir);
      if (r.code !== 0) this.toast({ topic: 'Update failed', message: r.stderr });
    },
    async betaTest({ branch }) {
      if (!branch) return;
      this.toast({ topic: 'Update', message: `Installing branch "${branch}". Tilt Pi will restart when finished.` });
      const r = await startUpdate(this.config.appDir, branch);
      if (r.code !== 0) this.toast({ topic: 'Update failed', message: r.stderr });
    },
    async setHostname({ name }) {
      name = String(name ?? '').trim();
      if (!sys.HOSTNAME_RE.test(name)) {
        return this.toast({ topic: 'Error: Characters not valid.', message: 'Use only numbers, letters, or dashes.' });
      }
      this.toast({ topic: 'Success: New hostname set.', message: name });
      const r = await sys.setHostname(name);
      if (r.code !== 0) return this.toast({ topic: 'Error', message: r.stderr });
      this.toast({
        topic: 'New Tilt Pi Link After Restart:',
        message: 'http://' + (this.config.dryRun ? name : sys.getHostname()) + '.local:1880/ui',
        dialog: { ok: 'Restart Now', cancel: 'Restart Later', command: 'reboot' },
      });
    },
    async testMdns() {
      const s = await this.mdns.testAndReset();
      this.toast({ topic: s.ok ? 'Local Name' : 'Alert', message: s.text });
    },
    async reboot() {
      this.toast({ message: 'Restarting...' });
      await sys.reboot();
    },
    async shutdown() {
      this.toast({ message: 'Shutting down...' });
      await sys.shutdown();
    },
    async btFix() {
      await sys.btStabilityFix();
      this.#restartNeeded();
    },
    async btRevert() {
      await sys.btStabilityRevert();
      this.#restartNeeded();
    },
    setRangeBoost({ value }) {
      this.rangeBoost.setEnabled(!!value);
    },
    toggleRangerHostname({ name }) {
      this.rangeBoost.toggleHostname(String(name ?? '').trim());
    },
    addRangerHostname({ name }) {
      const host = String(name ?? '').trim();
      if (host && !this.rangeBoost.addHostname(host)) {
        this.toast({ topic: 'Alert', message: `"${host}" is not a valid hostname (ex. tiltpi-north)` });
      }
    },
    removeRangerHostname({ name }) {
      this.rangeBoost.removeHostname(String(name ?? ''));
    },
    setScreenZoom({ value }) {
      this.settings.setGlobal({ screenZoom: Number(value) });
      sys.writeKioskConfig(this.config.dataDir, this.settings.global);
      this.toast({ topic: 'Alert', message: 'Restart to Enable New Settings' });
    },
    setScreenTimeout({ value }) {
      this.settings.setGlobal({ screenTimeout: Number(value) });
      sys.writeKioskConfig(this.config.dataDir, this.settings.global);
      this.toast({ topic: 'Alert', message: 'Restart to Enable New Settings' });
    },
  };

  #restartNeeded() {
    this.toast({ topic: 'Restart Needed', message: 'Click restart to save changes.' });
    this.#setUi({ timeStatus: 'Click restart to save changes.' });
  }
}
