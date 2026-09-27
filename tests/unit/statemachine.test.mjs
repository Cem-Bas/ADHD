import test from 'node:test';
import assert from 'node:assert/strict';
import { newSessionRecord } from '../../scripts/common/schema.mjs';
import { nextPhaseAfterFailedEvaluation, canTransition, transition, repairIndex, MAX_REPAIRS, MAX_CONSECUTIVE_BLOCKS } from '../../scripts/common/statemachine.mjs';

const now = Date.parse('2026-09-27T10:00:00Z');

test('failed evaluations walk ACTIVE -> REPAIR_1 ... REPAIR_6 -> REPORT_REQUIRED', () => {
  let phase = 'ACTIVE';
  const seen = [];
  for (let i = 0; i < 7; i += 1) { phase = nextPhaseAfterFailedEvaluation(phase); seen.push(phase); }
  assert.deepEqual(seen, ['REPAIR_1', 'REPAIR_2', 'REPAIR_3', 'REPAIR_4', 'REPAIR_5', 'REPAIR_6', 'REPORT_REQUIRED']);
  assert.throws(() => nextPhaseAfterFailedEvaluation('REPORT_REQUIRED'), /INVALID_TRANSITION|no repair/);
  assert.equal(nextPhaseAfterFailedEvaluation('REPAIR_2', 2), 'REPORT_REQUIRED');
  assert.equal(nextPhaseAfterFailedEvaluation('ACTIVE', 0), 'REPORT_REQUIRED');
  assert.equal(MAX_REPAIRS, 6);
  assert.equal(MAX_CONSECUTIVE_BLOCKS, 7);
});

test('transition table matches the spec', () => {
  assert.equal(canTransition('IDLE', 'ACTIVE'), true);
  assert.equal(canTransition('IDLE', 'COMPLETE'), false);
  assert.equal(canTransition('ACTIVE', 'REPAIR_2'), false);
  assert.equal(canTransition('REPAIR_6', 'REPORT_REQUIRED'), true);
  assert.equal(canTransition('REPAIR_6', 'REPAIR_7'), false);
  assert.equal(canTransition('REPORT_REQUIRED', 'BOUNDED_STOP'), true);
  assert.equal(canTransition('REPORT_REQUIRED', 'COMPLETE'), false);
  assert.equal(canTransition('DEGRADED_REPORT_REQUIRED', 'DEGRADED_STOP'), true);
  assert.equal(canTransition('COMPLETE', 'ACTIVE'), true);
  assert.equal(canTransition('CANCELLED', 'REPAIR_1'), false);
  for (const open of ['ACTIVE', 'REPAIR_4']) { assert.equal(canTransition(open, 'CANCELLED'), true); assert.equal(canTransition(open, 'DEGRADED_REPORT_REQUIRED'), true); }
});

test('transition records repair count, closure, and retention expiry', () => {
  const record = newSessionRecord({ sessionId: 's', cwd: '/p', now });
  record.preferencesSnapshot = { retentionDays: 7 };
  transition(record, 'ACTIVE', { now });
  transition(record, 'REPAIR_1', { now });
  assert.equal(record.repair.completed, 1);
  assert.equal(repairIndex(record.phase), 1);
  transition(record, 'CANCELLED', { now: now + 1000 });
  assert.equal(record.closure.reason, 'cancelled');
  assert.equal(record.expiresAt, new Date(now + 1000 + 7 * 86_400_000).toISOString());
  assert.throws(() => transition(record, 'REPAIR_2', { now }), /INVALID_TRANSITION|is not allowed/);
});

test('returning to ACTIVE resets the repair counters, and a missing preferences snapshot falls back to 30 days', () => {
  const record = newSessionRecord({ sessionId: 's', cwd: '/p', now });
  transition(record, 'ACTIVE', { now });
  transition(record, 'REPAIR_1', { now });
  transition(record, 'REPAIR_2', { now });
  record.repair.blocksIssued = 2;
  record.repair.gaps = [{ code: 'X', detail: 'y' }];
  transition(record, 'COMPLETE', { now });
  assert.equal(record.repair.completed, 2);
  transition(record, 'ACTIVE', { now });
  assert.deepEqual([record.repair.completed, record.repair.blocksIssued, record.repair.gaps], [0, 0, []]);
  const bare = newSessionRecord({ sessionId: 's2', cwd: '/p', now });
  delete bare.preferencesSnapshot;
  transition(bare, 'ACTIVE', { now });
  transition(bare, 'CANCELLED', { now });
  assert.equal(bare.expiresAt, new Date(now + 30 * 86_400_000).toISOString());
});

test('a user turn may return any repair phase or REPORT_REQUIRED to ACTIVE, which resets the counters', () => {
  for (const phase of ['REPAIR_1', 'REPAIR_3', 'REPAIR_6', 'REPORT_REQUIRED']) assert.equal(canTransition(phase, 'ACTIVE'), true, phase);
  assert.equal(canTransition('REPAIR_2', 'ACTIVE', 2), true);
  assert.equal(canTransition('ACTIVE', 'ACTIVE'), false);
  assert.equal(canTransition('DEGRADED_REPORT_REQUIRED', 'ACTIVE'), false);
  const record = newSessionRecord({ sessionId: 's', cwd: '/p', now });
  transition(record, 'ACTIVE', { now });
  for (const phase of ['REPAIR_1', 'REPAIR_2', 'REPAIR_3']) transition(record, phase, { now });
  record.repair.blocksIssued = 3;
  record.repair.gaps = [{ code: 'AUDIT_MISSING', detail: 'x' }];
  transition(record, 'ACTIVE', { now: now + 1 });
  assert.deepEqual([record.phase, record.repair.completed, record.repair.blocksIssued, record.repair.gaps], ['ACTIVE', 0, 0, []]);
  assert.equal(record.updatedAt, new Date(now + 1).toISOString());
  assert.equal(nextPhaseAfterFailedEvaluation(record.phase), 'REPAIR_1');
  transition(record, 'REPAIR_1', { now });
  for (let i = 0; i < 6; i += 1) transition(record, nextPhaseAfterFailedEvaluation(record.phase), { now });
  assert.equal(record.phase, 'REPORT_REQUIRED');
  transition(record, 'ACTIVE', { now });
  assert.deepEqual([record.phase, record.repair.completed], ['ACTIVE', 0]);
});

test('a lowered repair budget reaches REPORT_REQUIRED from its last allowed repair phase', () => {
  assert.equal(canTransition('REPAIR_2', 'REPORT_REQUIRED', 2), true);
  assert.equal(canTransition('REPAIR_2', 'REPAIR_3', 2), false);
  assert.equal(canTransition('ACTIVE', 'REPORT_REQUIRED', 0), true);
  assert.equal(canTransition('REPAIR_2', 'REPORT_REQUIRED'), false);
  const record = newSessionRecord({ sessionId: 's', cwd: '/p', now });
  record.repair.maximum = 2;
  transition(record, 'ACTIVE', { now });
  transition(record, 'REPAIR_1', { now });
  transition(record, 'REPAIR_2', { now });
  transition(record, 'REPORT_REQUIRED', { now });
  assert.equal(record.phase, 'REPORT_REQUIRED');
});
