// tests/unit/io.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, parseJson } from '../../scripts/common/io.mjs';

test('parseArgs separates flags with values from bare flags and positionals', () => {
  const parsed = parseArgs(['status', '--data', '/tmp/x', '--json', '--session', 'abc', 'extra']);
  assert.deepEqual(parsed.positional, ['status', 'extra']);
  assert.deepEqual(parsed.flags, { data: '/tmp/x', json: true, session: 'abc' });
});

test('parseJson reports malformed input without throwing', () => {
  assert.equal(parseJson('{"a":1}').value.a, 1);
  assert.equal(parseJson('{oops').ok, false);
});
