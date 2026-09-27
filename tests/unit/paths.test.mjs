import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { validateSessionId, resolveDataRoot, normalizeCwd, projectKey, sessionFile, archivedTaskFile, assertInside, diagnosticsFile, projectPreferencesFile } from '../../scripts/common/paths.mjs';

test('accepts realistic session ids and rejects traversal or odd characters', () => {
  for (const ok of ['abc', '77614389-3dec-44de-9fb6-1c672d238d8c', 'A_b-9', 'x'.repeat(128)]) assert.equal(validateSessionId(ok), ok);
  for (const bad of ['', '../x', 'a/b', 'a\\b', '.hidden', 'x'.repeat(129), 'a b', null, 42, 'a.b']) assert.throws(() => validateSessionId(bad), /INVALID_SESSION_ID|session id/);
});

test('resolveDataRoot prefers the flag, then env, and ignores unsubstituted placeholders', () => {
  assert.equal(resolveDataRoot({ flag: '/tmp/flag', env: { CLAUDE_PLUGIN_DATA: '/tmp/env' }, home: '/home/u' }), path.resolve('/tmp/flag'));
  assert.equal(resolveDataRoot({ flag: '${CLAUDE_PLUGIN_DATA}', env: { CLAUDE_PLUGIN_DATA: '/tmp/env' }, home: '/home/u' }), path.resolve('/tmp/env'));
  assert.equal(resolveDataRoot({ flag: undefined, env: { CLAUDE_PLUGIN_DATA: '${CLAUDE_PLUGIN_DATA}' }, home: '/home/u' }), path.join('/home/u', '.claude', 'plugins', 'data', 'adhd-local'));
  assert.equal(resolveDataRoot({ flag: '   ', env: {}, home: '/home/u' }), path.join('/home/u', '.claude', 'plugins', 'data', 'adhd-local'));
});

test('normalizeCwd and projectKey are stable across slashes, trailing separators, and relative input', () => {
  const a = normalizeCwd('/Users/x/proj/');
  const b = normalizeCwd('/Users/x/proj');
  assert.equal(a, b);
  assert.equal(normalizeCwd('C:\\Users\\x\\proj').includes('\\'), false);
  assert.match(projectKey('/Users/x/proj'), /^p[0-9a-f]{16}$/);
  assert.equal(projectKey('/Users/x/proj/'), projectKey('/Users/x/proj'));
  assert.equal(typeof normalizeCwd(undefined), 'string');
  assert.equal(normalizeCwd('.'), normalizeCwd(process.cwd()));
});

test('every data path stays inside the root', () => {
  const root = path.join(path.sep, 'tmp', 'adhd-root');
  assert.equal(sessionFile(root, 'abc'), path.join(root, 'sessions', 'abc.json'));
  assert.equal(archivedTaskFile(root, 'abc', 't0123456789abcde'), path.join(root, 'sessions', 'abc.t0123456789abcde.json'));
  assert.equal(diagnosticsFile(root, 'abc'), path.join(root, 'diagnostics', 'abc.jsonl'));
  assert.match(projectPreferencesFile(root, '/x'), /projects[\\/]p[0-9a-f]{16}[\\/]preferences\.json$/);
  assert.throws(() => assertInside(root, path.join(root, '..', 'escape.json')), /PATH_ESCAPE|escapes/);
  assert.throws(() => assertInside(root, root), /PATH_ESCAPE|escapes/);
  assert.throws(() => archivedTaskFile(root, 'abc', '../evil'), /INVALID_TASK_ID|task id/);
});
