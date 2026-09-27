import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDataRoot } from '../helpers.mjs';
import { mutateSession, loadSession, saveSession, archiveTask, findOpenSessionsForCwd, listSessionRecords } from '../../scripts/common/store.mjs';
import { newSessionRecord } from '../../scripts/common/schema.mjs';
import { startTask, appendUserTurn } from '../../scripts/common/session.mjs';
import { appendDiagnostic } from '../../scripts/common/diagnostics.mjs';

const now = Date.parse('2026-09-27T10:00:00Z');

test('mutateSession creates on demand, saves atomically, and reports the load status', () => {
  const root = tmpDataRoot();
  const first = mutateSession(root, 'sess-1', (record) => { startTask(record, { text: 'hi', receivedAt: now }); return { result: 'started' }; }, { create: { cwd: '/p' }, now });
  assert.deepEqual([first.status, first.loaded, first.result], ['ok', 'missing', 'started']);
  const second = mutateSession(root, 'sess-1', (record) => { appendUserTurn(record, { text: 'more', receivedAt: now + 1 }); }, { now: now + 1 });
  assert.equal(second.loaded, 'ok');
  assert.equal(loadSession(root, 'sess-1').record.userTurns.length, 1);
  assert.deepEqual(fs.readdirSync(path.join(root, 'sessions')), ['sess-1.json']);
  const untouched = mutateSession(root, 'sess-1', () => ({ skipSave: true, result: 42 }), { now: now + 2 });
  assert.equal(untouched.result, 42);
  assert.equal(loadSession(root, 'sess-1').record.updatedAt, new Date(now + 1).toISOString());
});

test('missing session without create is reported and corrupt files are quarantined', () => {
  const root = tmpDataRoot();
  assert.equal(mutateSession(root, 'nope', () => ({}), { now }).status, 'missing');
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sessions', 'bad.json'), '{broken');
  const loaded = loadSession(root, 'bad');
  assert.equal(loaded.status, 'corrupt');
  assert.ok(loaded.quarantined.includes('diagnostics'));
  assert.equal(fs.existsSync(path.join(root, 'sessions', 'bad.json')), false);
  fs.writeFileSync(path.join(root, 'sessions', 'bad2.json'), JSON.stringify({ schemaVersion: 1, sessionId: 'bad2', phase: 'NOPE' }));
  assert.equal(loadSession(root, 'bad2').status, 'corrupt');
});

test('saveSession enforces the 2 MiB cap and schema', () => {
  const root = tmpDataRoot();
  const record = startTask(newSessionRecord({ sessionId: 'big', cwd: '/p', now }), { text: 'x'.repeat(2 * 1024 * 1024), receivedAt: now });
  assert.throws(() => saveSession(root, record), /STATE_TOO_LARGE|exceeds/);
  assert.throws(() => saveSession(root, { ...newSessionRecord({ sessionId: 'bad', cwd: '/p', now }), phase: 'NOPE' }), /SCHEMA_INVALID|phase must be one of/);
});

test('archives are separate files, listing distinguishes them, and open sessions resolve by cwd', () => {
  const root = tmpDataRoot();
  const cwd = process.platform === 'win32' ? 'c:/proj' : '/proj';
  const record = startTask(newSessionRecord({ sessionId: 'sess-a', cwd, now }), { text: 'a', receivedAt: now });
  saveSession(root, record);
  archiveTask(root, record);
  const other = startTask(newSessionRecord({ sessionId: 'sess-b', cwd, now }), { text: 'b', receivedAt: now + 5 });
  other.updatedAt = new Date(now + 5).toISOString();
  saveSession(root, other);
  const listed = listSessionRecords(root);
  assert.equal(listed.filter((x) => x.archived).length, 1);
  assert.equal(listed.length, 3);
  assert.deepEqual(findOpenSessionsForCwd(root, cwd).map((x) => x.sessionId), ['sess-b', 'sess-a']);
  assert.deepEqual(findOpenSessionsForCwd(root, '/elsewhere'), []);
});

test('diagnostics are bounded, redacted JSONL and never throw', () => {
  const root = tmpDataRoot();
  appendDiagnostic(root, 'sess-1', { code: 'X', message: `token=abcdefghijkl ${'m'.repeat(1000)}`, details: { big: 'n'.repeat(5000) } }, { now });
  appendDiagnostic(root, '../evil', { code: 'Y', message: 'bad id' }, { now });
  const lines = fs.readFileSync(path.join(root, 'diagnostics', 'sess-1.jsonl'), 'utf8').trim().split('\n');
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.message.includes('abcdefghijkl'), false);
  assert.ok(entry.message.length <= 500);
  assert.ok(entry.details.length <= 2000);
  assert.ok(fs.existsSync(path.join(root, 'diagnostics', 'unattributed.jsonl')));
});
