// Tilt iBeacon UUIDs → color names (legacy "Tilts" switch + "Colors" change nodes).

export const TILT_UUID_PATTERN = /a495bb..c5b14b44b5121370f02d74de/;

export const UUID_TO_COLOR = {
  a495bb10c5b14b44b5121370f02d74de: 'RED',
  a495bb20c5b14b44b5121370f02d74de: 'GREEN',
  a495bb30c5b14b44b5121370f02d74de: 'BLACK',
  a495bb40c5b14b44b5121370f02d74de: 'PURPLE',
  a495bb50c5b14b44b5121370f02d74de: 'ORANGE',
  a495bb60c5b14b44b5121370f02d74de: 'BLUE',
  a495bb70c5b14b44b5121370f02d74de: 'YELLOW',
  a495bb80c5b14b44b5121370f02d74de: 'PINK',
};

export const COLORS = ['RED', 'GREEN', 'BLACK', 'PURPLE', 'ORANGE', 'BLUE', 'YELLOW', 'PINK'];

export function isTiltUuid(uuid) {
  return typeof uuid === 'string' && TILT_UUID_PATTERN.test(uuid);
}

/** Unknown Tilt-like UUIDs keep the uuid itself as their "color", as in the legacy flow. */
export function colorForUuid(uuid) {
  return UUID_TO_COLOR[uuid] ?? uuid;
}
