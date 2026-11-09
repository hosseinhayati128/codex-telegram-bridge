import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWire, stringifyWire, idKey, cloneWire, fingerprint } from '../wire.mjs';

test('int64 native request IDs remain distinct and are returned as numeric tokens', () => {
  const a = parseWire('{"id":9007199254740992,"method":"one"}');
  const b = parseWire('{"id":9007199254740993,"method":"two"}');
  assert.notEqual(idKey(a.id), idKey(b.id));
  assert.equal(stringifyWire({ id: b.id, result: { decision: 'accept' } }), '{"id":9007199254740993,"result":{"decision":"accept"}}');
});
test('string and numeric request IDs never alias; Unicode survives a clone', () => {
  assert.notEqual(idKey('12'), idKey(12));
  assert.deepEqual(cloneWire({ id: 0, text: 'پاسخ 🦜' }), { id: 0, text: 'پاسخ 🦜' });
  assert.throws(() => idKey(Number.MAX_SAFE_INTEGER + 1), /unsafe/i);
});
test('fingerprints include all values and ignore object key ordering', () => {
  assert.equal(fingerprint({ b: 2, a: 1n }), fingerprint({ a: 1n, b: 2 }));
  assert.notEqual(fingerprint({ id: 1n }), fingerprint({ id: '1' }));
});
