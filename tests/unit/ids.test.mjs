// tests/unit/ids.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomTaskId, randomNonce, digestOf, sha256Hex } from '../../scripts/common/ids.mjs';

test('task ids are 16 lowercase alphanumerics starting with t', () => {
  for (let i = 0; i < 50; i += 1) assert.match(randomTaskId(), /^t[a-z0-9]{15}$/);
});

test('nonces are 32 hex chars and unique', () => {
  const a = randomNonce();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, randomNonce());
});

test('digestOf is stable for equal values and prefixed', () => {
  assert.equal(digestOf({ a: 1, b: ['x'] }), digestOf({ a: 1, b: ['x'] }));
  assert.match(digestOf('x'), /^sha256:[0-9a-f]{64}$/);
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
