// Decode an advertisement into the same object aioblescan's Tilt plugin produced:
// { uuid, major, minor, tx_power, rssi, mac }.
// Manufacturer data layout: 4c 00 | 02 15 | uuid(16) | major(2, BE) | minor(2, BE) | tx(int8)

const PREFIX = Buffer.from('4c000215a495', 'hex');

/**
 * @param {Buffer|undefined} manufacturerData
 * @param {string} address  MAC, any case, ':' separated
 * @param {number} rssi
 */
export function decodeTiltAdvert(manufacturerData, address, rssi) {
  if (!manufacturerData || manufacturerData.length < 25) return null;
  if (!manufacturerData.subarray(0, 6).equals(PREFIX)) return null;
  return {
    uuid: manufacturerData.subarray(4, 20).toString('hex'),
    major: manufacturerData.readUInt16BE(20), // temperature °F (×10 on Tilt Pro)
    minor: manufacturerData.readUInt16BE(22), // SG ×1000 (×10000 on Tilt Pro)
    tx_power: manufacturerData.readInt8(24), // weeks since battery change / codes
    rssi,
    mac: String(address).toLowerCase(),
  };
}
