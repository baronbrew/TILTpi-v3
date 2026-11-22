// Simulated Tilts for development without Bluetooth hardware.
// Produces raw scans exactly like the real scanner (and aioblescan) would.
import { EventEmitter } from 'node:events';

const FAKE_TILTS = [
  { uuid: 'a495bb30c5b14b44b5121370f02d74de', mac: 'f1:05:c8:64:68:b2', sg: 1.052, temp: 66, pro: false }, // BLACK
  { uuid: 'a495bb10c5b14b44b5121370f02d74de', mac: 'd4:11:22:33:44:55', sg: 1.0123, temp: 68.4, pro: true }, // RED (Pro)
  { uuid: 'a495bb80c5b14b44b5121370f02d74de', mac: 'c0:aa:bb:cc:dd:ee', sg: 1.008, temp: 52, pro: false }, // PINK
];

export class MockScanner extends EventEmitter {
  constructor({ intervalMs = 1000 } = {}) {
    super();
    this.intervalMs = intervalMs;
    this.timer = null;
    this.t = 0;
  }

  async start() {
    this.timer = setInterval(() => {
      this.t++;
      for (const [i, tilt] of FAKE_TILTS.entries()) {
        const drift = Math.sin((this.t + i * 7) / 30);
        const sg = tilt.sg - this.t * 0.00001 + drift * 0.0005;
        const temp = tilt.temp + drift * 0.6;
        this.emit('scan', {
          uuid: tilt.uuid,
          major: tilt.pro ? Math.round(temp * 10) : Math.round(temp),
          minor: tilt.pro ? Math.round(sg * 10000) : Math.round(sg * 1000),
          tx_power: -59,
          rssi: -60 - Math.round(Math.abs(drift) * 20),
          mac: tilt.mac,
        });
      }
    }, this.intervalMs);
  }

  stop() {
    clearInterval(this.timer);
  }
}
