import { createHash } from 'node:crypto';

// Native RequestId is int64|string. JSON.parse alone would round large IDs.
export function parseWire(text) {
  return JSON.parse(text, (_key, value, context) => {
    if (typeof value === 'number' && !Number.isSafeInteger(value) && /^-?\d+$/.test(context?.source || '')) return BigInt(context.source);
    return value;
  });
}
export function stringifyWire(value) {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? JSON.rawJSON(item.toString()) : item);
}
export function idKey(id) {
  if (typeof id === 'string') return `s:${id}`;
  if (typeof id === 'bigint') return `n:${id}`;
  if (typeof id === 'number' && Number.isSafeInteger(id)) return `n:${id}`;
  throw new Error('Invalid or unsafe native request ID');
}
export function cloneWire(value) { return parseWire(stringifyWire(value)); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function fingerprint(value) { return createHash('sha256').update(stringifyWire(canonical(value))).digest('hex'); }
