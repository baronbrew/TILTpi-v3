// Port of the legacy "Add Parameter" function node. Turns a raw Tilt scan into the reading
// payload used everywhere else (display, logging, /macid, legacy backup files).
// Field names, order and value types intentionally match the legacy payload.
import { colorForUuid } from './colors.js';

export const DEFAULT_CLOUD_URL =
  'https://script.google.com/macros/s/AKfycbwNXh6rEWoULd0vxWxDylG_PJwQwe0dn5hdtSkuC4k3D9AXBSA/exec';

/** Legacy stored the docURL as ready-made HTML; the UI builds the same link from the raw URL. */
export function docLinkHtml(url) {
  return url ? '<a href="' + url + '" target="_blank"> | View Cloud Log</a>' : '';
}

/**
 * @param {{uuid:string,major:number,minor:number,tx_power:number,rssi:number,mac:string}} scan
 * @param {import('../settings.js').Settings} settings
 * @param {Date} [date]
 */
export function enrichScan(scan, settings, date = new Date()) {
  const g = settings.global;
  const p = { ...scan };
  p.Color = colorForUuid(scan.uuid);
  if (g.IDbyMAC) {
    p.Color = p.Color + ':' + p.mac;
    p.displayColor = p.Color.split(':');
    p.IDbyMAC = true;
  } else {
    p.displayColor = [p.Color];
    p.IDbyMAC = false;
  }
  const tilt = settings.tilt(p.Color);
  p.Beer = tilt.Beer ?? ['Untitled', true];
  p.actualSGPoints = (tilt.actualSGPoints ?? []).toString();
  p.unCalSGPoints = (tilt.uncalSGPoints ?? []).toString();
  p.actualTempPoints = (tilt.actualTempPoints ?? []).toString();
  p.unCalTempPoints = (tilt.uncalTempPoints ?? []).toString();

  p.timeStamp = date.getTime();
  const timeZone = date.getTimezoneOffset() / 24 / 60;
  p.formatteddate = date.toLocaleString();
  p.Timepoint = p.timeStamp / 1000 / 60 / 60 / 24 + 25569 - timeZone;

  p.fermunits = g.fermdisplayUnits || '';
  if (p.minor > 2000) {
    // Tilt Pro: extra precision
    p.SG = p.minor / 10000;
    p.major /= 10;
    p.hd = true;
  } else {
    p.SG = p.minor / 1000;
    p.hd = false;
  }
  p.Temp = p.major;
  p.tempunits = g.displayUnits || '°F';
  p.doclongurl = docLinkHtml(settings.runtime(p.Color).docURL);
  p.customcloudURL = tilt.cloudURLs; // undefined when never set
  p.defaultcloudURL = [DEFAULT_CLOUD_URL, g.useDefaultCloudURL];
  p.logCloudDataCheck = g.logCloudDataCheck;
  p.logLocalDataCheck = g.logLocalDataCheck;
  p.localloggingInterval = g.localloggingInterval || 15;
  p.loggingInterval = g.loggingInterval || 15;
  p.minRSSI = g.minRSSI;
  p.alphaSG = g.alphaSG;
  p.alphaTemp = g.alphaTemp;
  p.numberSamples = g.numberSamples;
  p.smoothSwitch = g.smoothSwitch;
  p.enableRangeBoost = g.enableRangeBoost ? '%invalid_hostname' : 'false';
  p.rangerHostnames = g.rangerHostnames;
  return p;
}
