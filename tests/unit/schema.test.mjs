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

test('validation rejects lenient timestamps, out-of-range repair counters, unknown closure reasons, malformed audit fields, and array-nested forbidden keys', () => {
  const base = () => newSessionRecord({ sessionId: 'abc', cwd: '/p', now });
  let record = base();
  record.createdAt = '09/27/2026';
  assert.equal(validateSessionRecord(record).ok, false);
  record = base();
  record.originalRequest = { text: 'x', receivedAt: 'September 27, 2026 10:00:00' };
  assert.equal(validateSessionRecord(record).ok, false);
  record = base();
  record.repair = { completed: -5, maximum: -1, gaps: [], blocksIssued: 999999 };
  assert.equal(validateSessionRecord(record).errors.filter((e) => e.startsWith('repair.')).length, 3);
  record = base();
  record.repair.blocksIssued = 7;
  assert.equal(validateSessionRecord(record).ok, true);
  record = base();
  record.closure = { reason: 'not-a-real-reason', at: record.createdAt };
  assert.equal(validateSessionRecord(record).ok, false);
  record = base();
  record.closure = { reason: 'replaced', at: record.createdAt };
  assert.equal(validateSessionRecord(record).ok, true);
  record = base();
  record.audit = { nonce: 12345, receipt: ['not', 'null'], invalidatedAt: 'garbage', requestedAt: 42 };
  assert.equal(validateSessionRecord(record).errors.filter((e) => e.startsWith('audit.')).length, 4);
  record = base();
  record.audit = { nonce: 'a'.repeat(32), receipt: {}, invalidatedAt: record.createdAt, requestedAt: null };
  assert.equal(validateSessionRecord(record).ok, true);
  record = base();
  record.extensions = { version: 1, adhd: { list: [[{ command: 'rm -rf /' }]] } };
  assert.equal(validateSessionRecord(record).ok, false);
  record = base();
  record.extensions = [];
  assert.equal(validateSessionRecord(record).ok, false);
  record = base();
  delete record.extensions;
  assert.equal(validateSessionRecord(record).ok, true);
});
