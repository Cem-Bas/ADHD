import test from 'node:test';
import assert from 'node:assert/strict';
import { newSessionRecord, validateSessionRecord, migrateSessionRecord, PHASES, isOpenPhase, isTerminalPhase } from '../../scripts/common/schema.mjs';

const now = Date.parse('2026-09-27T10:00:00Z');

test('a new record validates and starts idle', () => {
  const record = newSessionRecord({ sessionId: 'abc', cwd: '/p', now });
  assert.deepEqual(validateSessionRecord(record), { ok: true, errors: [] });
  assert.equal(record.phase, 'IDLE');
  assert.equal(record.expiresAt, new Date(now + 30 * 86_400_000).toISOString());
});

test('unknown top-level fields, bad phases, and malformed turns are rejected', () => {
  const record = newSessionRecord({ sessionId: 'abc', cwd: '/p', now });
  record.extra = 1;
  record.phase = 'DONE';
  record.userTurns = [{ sequence: 2, text: 'x', receivedAt: 'bad' }];
  const result = validateSessionRecord(record);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('unknown field: extra')));
  assert.ok(result.errors.some((e) => e.includes('phase')));
  assert.ok(result.errors.some((e) => e.includes('userTurns[0]')));
});

test('extensions may hold metadata but never executable-looking keys', () => {
  const record = newSessionRecord({ sessionId: 'abc', cwd: '/p', now });
  record.extensions = { version: 1, adhd: { note: 'ok', nested: [{ label: 'x' }] } };
  assert.equal(validateSessionRecord(record).ok, true);
  record.extensions = { version: 1, adhd: { command: 'rm -rf /' } };
  assert.equal(validateSessionRecord(record).ok, false);
  record.extensions = { version: 1, ['__proto__']: {} };
  assert.equal(validateSessionRecord(record).ok, false);
  record.extensions = { adhd: {} };
  assert.equal(validateSessionRecord(record).ok, false);
});

test('migration accepts v1, rejects newer and unknown versions', () => {
  const record = newSessionRecord({ sessionId: 'abc', cwd: '/p', now });
  assert.equal(migrateSessionRecord(record).ok, true);
  assert.equal(migrateSessionRecord({ ...record, schemaVersion: 2 }).ok, false);
  assert.equal(migrateSessionRecord({ ...record, schemaVersion: 'x' }).ok, false);
  assert.equal(migrateSessionRecord('nope').ok, false);
});

test('phase helpers agree with the phase list', () => {
  assert.equal(PHASES.length, 14);
  assert.equal(isOpenPhase('DEGRADED_REPORT_REQUIRED'), true);
  assert.equal(isOpenPhase('REPAIR_3'), true);
  assert.equal(isOpenPhase('REPORT_REQUIRED'), true);
  assert.equal(isOpenPhase('IDLE'), false);
  assert.equal(isTerminalPhase('BOUNDED_STOP'), true);
  assert.equal(isTerminalPhase('ACTIVE'), false);
});
