import { REPAIR_PHASES, TERMINAL_PHASES, MAX_REPAIRS, MAX_CONSECUTIVE_BLOCKS } from './schema.mjs';
import { AdhdError } from './errors.mjs';

export { MAX_REPAIRS, MAX_CONSECUTIVE_BLOCKS };

export function repairIndex(phase) {
  if (phase === 'ACTIVE') return 0;
  const index = REPAIR_PHASES.indexOf(phase);
  return index === -1 ? -1 : index + 1;
}

export function nextPhaseAfterFailedEvaluation(phase, maximum = MAX_REPAIRS) {
  const index = repairIndex(phase);
  if (index === -1) throw new AdhdError('INVALID_TRANSITION', `no repair transition from ${phase}`);
  const cap = Math.min(Math.max(0, maximum), MAX_REPAIRS);
  if (index >= cap) return 'REPORT_REQUIRED';
  return REPAIR_PHASES[index];
}

export function allowedTransitions(from, maximum = MAX_REPAIRS) {
  if (from === 'IDLE' || TERMINAL_PHASES.includes(from)) return ['ACTIVE'];
  if (from === 'REPORT_REQUIRED') return ['BOUNDED_STOP', 'DEGRADED_STOP', 'CANCELLED', 'ACTIVE'];
  if (from === 'DEGRADED_REPORT_REQUIRED') return ['DEGRADED_STOP', 'CANCELLED'];
  const index = repairIndex(from);
  if (index === -1) return [];
  const cap = Math.min(Math.max(0, maximum), MAX_REPAIRS);
  const next = index >= cap ? 'REPORT_REQUIRED' : REPAIR_PHASES[index];
  const allowed = ['COMPLETE', next, 'CANCELLED', 'DEGRADED_REPORT_REQUIRED', 'DEGRADED_STOP'];
  if (index > 0) allowed.push('ACTIVE');
  return allowed;
}

export function canTransition(from, to, maximum = MAX_REPAIRS) {
  return allowedTransitions(from, maximum).includes(to);
}

const CLOSURE_REASONS = { COMPLETE: 'complete', BOUNDED_STOP: 'bounded', DEGRADED_STOP: 'degraded', CANCELLED: 'cancelled' };

export function transition(record, to, { now = Date.now(), retentionDays } = {}) {
  const maximum = record.repair && Number.isInteger(record.repair.maximum) ? record.repair.maximum : MAX_REPAIRS;
  if (!canTransition(record.phase, to, maximum)) throw new AdhdError('INVALID_TRANSITION', `${record.phase} -> ${to} is not allowed`);
  const iso = new Date(now).toISOString();
  record.phase = to;
  record.updatedAt = iso;
  if (to === 'ACTIVE') {
    record.repair.completed = 0;
    record.repair.blocksIssued = 0;
    record.repair.gaps = [];
  }
  const index = repairIndex(to);
  if (index > 0) record.repair.completed = index;
  if (TERMINAL_PHASES.includes(to)) {
    if (!(record.closure && ['replaced', 'cleared'].includes(record.closure.reason))) record.closure = { reason: CLOSURE_REASONS[to], at: iso };
    const snapshotDays = record.preferencesSnapshot && Number.isInteger(record.preferencesSnapshot.retentionDays) ? record.preferencesSnapshot.retentionDays : 30;
    const days = Number.isInteger(retentionDays) ? retentionDays : snapshotDays;
    record.expiresAt = new Date(Date.parse(iso) + days * 86_400_000).toISOString();
  }
  return record;
}
