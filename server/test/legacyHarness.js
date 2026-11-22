// Runs original Node-RED function-node code from legacy/flow.json so tests can compare the port
// against the real legacy implementation.
import fs from 'node:fs';

const flow = JSON.parse(fs.readFileSync(new URL('../../legacy/flow.json', import.meta.url), 'utf8'));

export class Store {
  constructor(init = {}) {
    this.m = new Map(Object.entries(init));
  }
  get(k) {
    return this.m.get(k);
  }
  set(k, v) {
    if (v === undefined) this.m.delete(k);
    else this.m.set(k, v);
  }
}

/** Fixed-clock Date replacement for deterministic legacy runs. */
export function fixedDate(ms) {
  return class FixedDate extends Date {
    constructor(...a) {
      super(...(a.length ? a : [ms]));
    }
    static now() {
      return ms;
    }
  };
}

/**
 * @param {string} name function node name (must be unique, or pass an id)
 * @returns {(msg:object, env:{flow?:Store, context?:Store, Date?:DateConstructor}) => {ret:any, sent:any[]}}
 */
export function legacyFunction(nameOrId) {
  const nodes = flow.filter((n) => n.type === 'function' && (n.name === nameOrId || n.id === nameOrId));
  if (nodes.length !== 1) throw new Error(`expected 1 function "${nameOrId}", found ${nodes.length}`);
  const fn = new Function('msg', 'node', 'context', 'flow', 'Date', nodes[0].func);
  return (msg, { flow = new Store(), context = new Store(), Date: D = Date } = {}) => {
    const sent = [];
    const node = { send: (m) => sent.push(m), warn() {}, error() {}, log() {} };
    const ret = fn(msg, node, context, flow, D);
    return { ret, sent };
  };
}
