import { REPAIR_PHASES, TERMINAL_PHASES } from './schema.mjs';
import { AdhdError } from './errors.mjs';

export const MAX_REPAIRS = 6;
export const MAX_CONSECUTIVE_BLOCKS = 7;

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

export function allowedTransitions(from) {
  if (from === 'IDLE' || TERMINAL_PHASES.includes(from)) return ['ACTIVE'];
  if (from === 'REPORT_REQUIRED') return ['BOUNDED_STOP', 'DEGRADED_STOP', 'CANCELLED'];
  if (from === 'DEGRADED_REPORT_REQUIRED') return ['DEGRADED_STOP', 'CANCELLED'];
  const index = repairIndex(from);
  if (index === -1) return [];
  const next = index >= MAX_REPAIRS ? 'REPORT_REQUIRED' : REPAIR_PHASES[index];
  return ['COMPLETE', next, 'CANCELLED', 'DEGRADED_REPORT_REQUIRED', 'DEGRADED_STOP'];
}

export function canTransition(from, to) {
  return allowedTransitions(from).includes(to);
}

const CLOSURE_REASONS = { COMPLETE: 'complete', BOUNDED_STOP: 'bounded', DEGRADED_STOP: 'degraded', CANCELLED: 'cancelled' };

export function transition(record, to, { now = Date.now(), retentionDays } = {}) {
  if (!canTransition(record.phase, to)) throw new AdhdError('INVALID_TRANSITION', `${record.phase} -> ${to} is not allowed`);
  const iso = new Date(now).toISOString();
  record.phase = to;
  record.updatedAt = iso;
  const index = repairIndex(to);
  if (index > 0) record.repair.completed = index;
  if (TERMINAL_PHASES.includes(to)) {
    if (!(record.closure && ['replaced', 'cleared'].includes(record.closure.reason))) record.closure = { reason: CLOSURE_REASONS[to], at: iso };
    const days = Number.isInteger(retentionDays) ? retentionDays : Number.isInteger(record.preferencesSnapshot.retentionDays) ? record.preferencesSnapshot.retentionDays : 30;
    record.expiresAt = new Date(Date.parse(iso) + days * 86_400_000).toISOString();
  }
  return record;
}
