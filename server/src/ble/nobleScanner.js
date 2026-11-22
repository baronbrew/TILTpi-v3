// Real Bluetooth scanner using @abandonware/noble (HCI socket; needs CAP_NET_RAW/CAP_NET_ADMIN,
// granted by the systemd unit). Emits 'scan' with aioblescan-compatible objects.
import { EventEmitter } from 'node:events';
import { decodeTiltAdvert } from '../tilt/ibeacon.js';

const STALL_MS = 30000; // restart scanning if no Tilt advert for this long (legacy watchdog)

export class NobleScanner extends EventEmitter {
  constructor({ log = console } = {}) {
    super();
    this.log = log;
    this.noble = null;
    this.lastAdvert = Date.now();
    this.watchdog = null;
    this.restarts = 0;
  }

  async start() {
    const mod = await import('@abandonware/noble');
    this.noble = mod.default ?? mod;
    this.noble.on('stateChange', (state) => {
      this.log.info?.(`[ble] adapter state: ${state}`);
      if (state === 'poweredOn') this.#startScanning();
      else this.noble.stopScanning();
    });
    this.noble.on('discover', (p) => {
      const scan = decodeTiltAdvert(p.advertisement?.manufacturerData, p.address, p.rssi);
      if (!scan) return;
      this.lastAdvert = Date.now();
      this.emit('scan', scan);
    });
    this.noble.on('warning', (w) => this.log.warn?.(`[ble] ${w}`));
    if (this.noble.state === 'poweredOn') this.#startScanning();

    this.watchdog = setInterval(() => {
      if (Date.now() - this.lastAdvert > STALL_MS && this.noble.state === 'poweredOn') {
        this.restarts++;
        this.log.warn?.(`[ble] no Tilt adverts for ${STALL_MS / 1000}s, restarting scan`);
        this.lastAdvert = Date.now();
        this.noble.stopScanning();
        setTimeout(() => this.#startScanning(), 1000);
      }
    }, 5000);
  }

  #startScanning() {
    // allowDuplicates=true: we need every advertisement, not just the first per device.
    this.noble.startScanning([], true, (err) => {
      if (err) this.log.error?.(`[ble] startScanning failed: ${err.message ?? err}`);
    });
  }

  stop() {
    clearInterval(this.watchdog);
    this.noble?.stopScanning();
  }
}
