import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDataRoot, writeSession } from '../helpers.mjs';
import { cleanupExpired } from '../../scripts/common/retention.mjs';
import { newSessionRecord } from '../../scripts/common/schema.mjs';
import { startTask, cancelTask } from '../../scripts/common/session.mjs';
import { saveSession, archiveTask } from '../../scripts/common/store.mjs';

const now = Date.parse('2026-09-27T10:00:00Z');
const day = 86_400_000;

test('expired finished records, abandoned open records, and old diagnostics are removed; live open and recent ones stay', () => {
  const root = tmpDataRoot();
  const done = startTask(newSessionRecord({ sessionId: 'done', cwd: '/p', now: now - 40 * day }), { text: 'a', receivedAt: now - 40 * day, retentionDays: 30 });
  cancelTask(done, now - 40 * day);
  saveSession(root, done);
  archiveTask(root, done);
  const recent = startTask(newSessionRecord({ sessionId: 'recent', cwd: '/p', now: now - day }), { text: 'b', receivedAt: now - day, retentionDays: 30 });
  cancelTask(recent, now - day);
  saveSession(root, recent);
  const open = startTask(newSessionRecord({ sessionId: 'open', cwd: '/p', now: now - 50 * day }), { text: 'c', receivedAt: now - 50 * day, retentionDays: 30 });
  saveSession(root, open);
  const abandoned = startTask(newSessionRecord({ sessionId: 'abandoned', cwd: '/p', now: now - 100 * day }), { text: 'd', receivedAt: now - 100 * day, retentionDays: 30 });
  saveSession(root, abandoned);
  const diag = path.join(root, 'diagnostics');
  fs.mkdirSync(diag, { recursive: true });
  fs.writeFileSync(path.join(diag, 'old.jsonl'), '{}\n');
  const old = new Date(now - 20 * day);
  fs.utimesSync(path.join(diag, 'old.jsonl'), old, old);
  fs.writeFileSync(path.join(diag, 'new.jsonl'), '{}\n');
  const result = cleanupExpired(root, { now });
  assert.deepEqual(result, { removedSessions: 2, removedArchives: 1, removedDiagnostics: 1 });
  assert.deepEqual(fs.readdirSync(path.join(root, 'sessions')).sort(), ['open.json', 'recent.json']);
  assert.deepEqual(fs.readdirSync(diag), ['new.jsonl']);
});

test('retentionDays 0 expires at closure time', () => {
  const root = tmpDataRoot();
  const record = startTask(newSessionRecord({ sessionId: 'zero', cwd: '/p', now }), { text: 'a', receivedAt: now, retentionDays: 0, preferencesSnapshot: { retentionDays: 0 } });
  cancelTask(record, now);
  saveSession(root, record);
  assert.equal(cleanupExpired(root, { now: now + 1 }).removedSessions, 1);
});

test('cleanup removes an expired session visual folder together with its record', () => {
  const root = tmpDataRoot();
  const now = Date.parse('2026-10-02T10:00:00Z');
  const record = newSessionRecord({ sessionId: 'old-sess', cwd: '/p', now: now - 40 * 86_400_000, retentionDays: 30 });
  record.phase = 'COMPLETE';
  writeSession(root, record);
  const dir = path.join(root, 'visual', 'old-sess', 't1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.png'), 'x');
  const result = cleanupExpired(root, { now });
  assert.equal(result.removedSessions, 1);
  assert.equal(fs.existsSync(path.join(root, 'visual', 'old-sess')), false);
});
