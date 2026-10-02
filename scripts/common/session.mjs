import path from 'node:path';
import { randomTaskId, randomNonce, digestOf } from './ids.mjs';
import { emptyEvidence, MAX_TOOL_EVENTS, MAX_REPAIRS, MODES, isOpenPhase } from './schema.mjs';
import { transition, repairIndex } from './statemachine.mjs';
import { MUTATING_TOOLS, redact, isReadOnlyCommand } from './evidence.mjs';
import { validateClaim, validateUnresolved, assessLedger } from './ledger.mjs';
import { AdhdError } from './errors.mjs';
import { noteUiEdits, visualGaps } from './visual.mjs';

export const RECEIPT_STATUSES = ['PASS', 'PARTIAL', 'BLOCKED'];
const MAX_ARTIFACTS = 200;
const MAX_CLAIMS = 300;
const MAX_SOURCES = 1000;
const MAX_AGENTS = 100;
const MAX_ANSWERS = 20;
const MAX_ANSWER_CHARS = 20_000;
const MAX_ANSWER_BYTES = 256 * 1024;

function iso(at) {
  return new Date(at).toISOString();
}

export function computeRequestDigest(record) {
  return digestOf({ original: record.originalRequest ? record.originalRequest.text : null, turns: record.userTurns.map((turn) => turn.text), mode: record.mode });
}

const changesState = (event) => MUTATING_TOOLS.has(event.toolName) && !(event.toolName === 'Bash' && isReadOnlyCommand(event.command));

export function computeEvidenceDigest(record) {
  const evidence = record.evidence;
  return digestOf({
    artifacts: evidence.artifacts.map((artifact) => artifact.path),
    commands: evidence.commands.filter((command) => !isReadOnlyCommand(command.command)).map((command) => [command.toolUseId, command.exitStatus, command.ok]),
    toolEvents: evidence.toolEvents.filter(changesState).map((event) => [event.toolUseId, event.ok, event.output.sha256]),
    claims: evidence.claims.map((claim) => [claim.claimId, claim.text, claim.confidence, claim.sources.map((source) => source.url)]),
    unresolved: evidence.unresolved.map((item) => item.question),
    answers: evidence.answers.map((answer) => [answer.contractVersion, answer.text]),
    visual: [evidence.visual.decision ? [evidence.visual.decision.needed, evidence.visual.decision.reason] : null, evidence.visual.checks.map((check) => [check.toolUseId, check.ok, check.blocked, check.at])],
  });
}

export function markLastTurn(record, kind) {
  record.extensions = { version: 1, ...record.extensions, lastTurn: kind };
  return record;
}

export function startTask(record, { text, receivedAt, mode = 'standard', transcriptPath, preferencesSnapshot, retentionDays }) {
  if (preferencesSnapshot) record.preferencesSnapshot = preferencesSnapshot;
  if (transcriptPath) record.transcriptPath = transcriptPath;
  record.taskId = randomTaskId();
  record.contractVersion = 1;
  if (!MODES.includes(mode)) throw new AdhdError('INVALID_MODE', `mode must be one of ${MODES.join(', ')}`);
  record.mode = mode;
  markLastTurn(record, 'user');
  delete record.extensions.pendingMode;
  record.originalRequest = { text, receivedAt: iso(receivedAt) };
  record.userTurns = [];
  record.evidence = emptyEvidence();
  record.audit = { nonce: randomNonce(), receipt: null, invalidatedAt: null, requestedAt: null };
  const requested = record.preferencesSnapshot && Number.isInteger(record.preferencesSnapshot.repairCycles) ? record.preferencesSnapshot.repairCycles : MAX_REPAIRS;
  const maximum = Math.min(Math.max(0, requested), MAX_REPAIRS);
  record.repair = { completed: 0, maximum, gaps: [], blocksIssued: 0 };
  record.closure = null;
  record.phase = 'IDLE';
  transition(record, 'ACTIVE', { now: receivedAt });
  record.requestDigest = computeRequestDigest(record);
  const days = Number.isInteger(retentionDays) ? retentionDays : Number.isInteger(record.preferencesSnapshot.retentionDays) ? record.preferencesSnapshot.retentionDays : 30;
  record.expiresAt = new Date(receivedAt + days * 86_400_000).toISOString();
  return record;
}

export function invalidateAudit(record, at) {
  if (record.audit.receipt) record.audit.invalidatedAt = iso(at);
  record.audit.nonce = randomNonce();
  return record;
}

export function appendUserTurn(record, { text, receivedAt }) {
  if (repairIndex(record.phase) > 0 || record.phase === 'REPORT_REQUIRED') transition(record, 'ACTIVE', { now: receivedAt });
  record.userTurns.push({ sequence: record.userTurns.length + 1, text, receivedAt: iso(receivedAt) });
  markLastTurn(record, 'user');
  record.contractVersion += 1;
  record.requestDigest = computeRequestDigest(record);
  record.repair.blocksIssued = 0;
  invalidateAudit(record, receivedAt);
  return record;
}

export function setMode(record, mode, at) {
  if (!MODES.includes(mode)) throw new AdhdError('INVALID_MODE', `mode must be one of ${MODES.join(', ')}`);
  if (record.mode === mode) return record;
  record.mode = mode;
  if (record.taskId) {
    record.contractVersion += 1;
    record.requestDigest = computeRequestDigest(record);
    invalidateAudit(record, at);
  }
  return record;
}

export function cancelTask(record, at) {
  transition(record, 'CANCELLED', { now: at });
  return record;
}

export function closeReplaced(record, at, reason = 'replaced') {
  record.closure = { reason, at: iso(at) };
  transition(record, 'CANCELLED', { now: at });
  return record;
}

export function recordToolEvent(record, event, at) {
  const evidence = record.evidence;
  evidence.toolEvents.push(event);
  while (evidence.toolEvents.length > MAX_TOOL_EVENTS) {
    evidence.toolEvents.shift();
    evidence.dropped.toolEvents += 1;
  }
  if (event.toolName === 'Bash') {
    evidence.commands.push({ toolUseId: event.toolUseId, command: event.command, exitStatus: event.exitStatus, ok: event.ok, at: event.at });
    if (evidence.commands.length > MAX_TOOL_EVENTS) evidence.commands.splice(0, evidence.commands.length - MAX_TOOL_EVENTS);
  }
  if (changesState(event) && record.audit.receipt && record.audit.invalidatedAt === null) record.audit.invalidatedAt = iso(at);
  noteUiEdits(record, event);
  return record;
}

export function trackAgent(record, input, at) {
  const agents = record.evidence.agents;
  const agentId = String(input.agent_id || '');
  if (input.hook_event_name === 'SubagentStart') {
    agents.push({ agentId, agentType: String(input.agent_type || ''), startedAt: iso(at), stoppedAt: null });
    if (agents.length > MAX_AGENTS) agents.splice(0, agents.length - MAX_AGENTS);
  } else if (input.hook_event_name === 'SubagentStop') {
    const entry = agents.findLast((agent) => agent.agentId === agentId && agent.stoppedAt === null);
    if (entry) entry.stoppedAt = iso(at);
  }
  return record;
}

export function declareArtifacts(record, artifacts, at) {
  if (!Array.isArray(artifacts)) throw new AdhdError('INVALID_ARTIFACT', 'artifacts must be an array');
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact.path !== 'string' || artifact.path.trim() === '') throw new AdhdError('INVALID_ARTIFACT', 'artifact.path must be a non-empty string');
  }
  const existing = new Set(record.evidence.artifacts.map((item) => item.path));
  const incoming = new Set(artifacts.map((artifact) => artifact.path).filter((path) => !existing.has(path)));
  if (existing.size + incoming.size > MAX_ARTIFACTS) throw new AdhdError('TOO_MANY_ARTIFACTS', `at most ${MAX_ARTIFACTS} declared artifacts`);
  for (const artifact of artifacts) {
    const entry = { path: artifact.path, purpose: typeof artifact.purpose === 'string' ? artifact.purpose.slice(0, 300) : '', declaredAt: iso(at) };
    const current = record.evidence.artifacts.find((item) => item.path === artifact.path);
    if (current) Object.assign(current, entry);
    else record.evidence.artifacts.push(entry);
  }
  return record;
}

export function recordAnswer(record, text, at) {
  if (typeof text !== 'string' || text.trim() === '') throw new AdhdError('INVALID_ANSWER', 'answer must be a non-empty string');
  const answers = record.evidence.answers;
  answers.push({ contractVersion: record.contractVersion, text: text.slice(0, MAX_ANSWER_CHARS), truncated: text.length > MAX_ANSWER_CHARS, at: iso(at) });
  if (answers.length > MAX_ANSWERS) answers.splice(0, answers.length - MAX_ANSWERS);
  // The session file is capped at 2 MiB, so answers get a byte budget, not just a character limit.
  while (answers.length > 1 && answers.reduce((sum, answer) => sum + Buffer.byteLength(answer.text, 'utf8'), 0) > MAX_ANSWER_BYTES) answers.shift();
  return record;
}

export function addResearchEvidence(record, { claims = [], sources = [], unresolved = [] } = {}) {
  const errors = [];
  if (!Array.isArray(claims) || !Array.isArray(sources) || !Array.isArray(unresolved)) throw new AdhdError('INVALID_EVIDENCE', 'claims, sources, and unresolved must be arrays');
  claims.forEach((claim, i) => { const result = validateClaim(claim); if (!result.ok) errors.push(`claims[${i}]: ${result.errors.join('; ')}`); });
  unresolved.forEach((item, i) => { const result = validateUnresolved(item); if (!result.ok) errors.push(`unresolved[${i}]: ${result.errors.join('; ')}`); });
  if (errors.length > 0) throw new AdhdError('INVALID_EVIDENCE', errors.join(' | '), { errors });
  const knownClaims = new Set(record.evidence.claims.map((item) => item.claimId));
  const newClaimIds = new Set(claims.map((claim) => claim.claimId).filter((id) => !knownClaims.has(id)));
  const knownSources = new Set(record.evidence.sources.map((item) => item.url));
  const incomingSources = [...sources, ...claims.flatMap((claim) => claim.sources)].filter((source) => source && typeof source.url === 'string').map((source) => ({ ...source, url: redact(source.url) }));
  const newSourceUrls = new Set(incomingSources.map((source) => source.url).filter((url) => !knownSources.has(url)));
  if (knownClaims.size + newClaimIds.size > MAX_CLAIMS || knownSources.size + newSourceUrls.size > MAX_SOURCES) throw new AdhdError('LEDGER_TOO_LARGE', `claim ledger exceeds limits (${MAX_CLAIMS} claims, ${MAX_SOURCES} sources)`);
  for (const claim of claims) {
    const index = record.evidence.claims.findIndex((item) => item.claimId === claim.claimId);
    if (index === -1) record.evidence.claims.push(claim);
    else record.evidence.claims[index] = claim;
  }
  for (const item of unresolved) {
    const index = record.evidence.unresolved.findIndex((existing) => existing.question === item.question);
    if (index === -1) record.evidence.unresolved.push(item);
    else record.evidence.unresolved[index] = item;
  }
  for (const source of incomingSources) {
    if (record.evidence.sources.some((existing) => existing.url === source.url)) continue;
    record.evidence.sources.push({ url: source.url, title: source.title, publisher: source.publisher, publicationDate: source.publicationDate ?? null, accessedAt: source.accessedAt, sourceType: source.sourceType, evidenceChainId: source.evidenceChainId });
  }
  if (record.audit.receipt && record.audit.invalidatedAt === null) record.audit.invalidatedAt = new Date().toISOString();
  return record;
}

export function auditFreshness(record) {
  const receipt = record.audit.receipt;
  if (!receipt) return { fresh: false, reason: 'none' };
  if (receipt.taskId !== record.taskId) return { fresh: false, reason: 'task' };
  if (receipt.nonce !== record.audit.nonce) return { fresh: false, reason: 'nonce' };
  if (receipt.contractVersion !== record.contractVersion || receipt.requestDigest !== record.requestDigest) return { fresh: false, reason: 'contract' };
  if (receipt.evidenceDigest !== computeEvidenceDigest(record)) return { fresh: false, reason: 'evidence' };
  return { fresh: true, reason: 'fresh' };
}

export function validateReceipt(receipt) {
  const errors = [];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return { ok: false, errors: ['receipt must be an object'] };
  for (const key of ['taskId', 'requestDigest', 'nonce']) if (typeof receipt[key] !== 'string' || receipt[key] === '') errors.push(`${key} required`);
  if (!Number.isInteger(receipt.contractVersion)) errors.push('contractVersion must be an integer');
  if (!Array.isArray(receipt.items) || receipt.items.length === 0) errors.push('items must be a non-empty array');
  else receipt.items.forEach((item, i) => {
    if (!item || typeof item !== 'object') { errors.push(`items[${i}] must be an object`); return; }
    if (typeof item.id !== 'string' || item.id === '') errors.push(`items[${i}].id required`);
    if (typeof item.requirement !== 'string' || item.requirement === '') errors.push(`items[${i}].requirement required`);
    if (!RECEIPT_STATUSES.includes(item.status)) errors.push(`items[${i}].status must be PASS, PARTIAL, or BLOCKED`);
    if (item.status !== 'PASS' && (typeof item.gap !== 'string' || item.gap === '')) errors.push(`items[${i}].gap is required when status is ${item.status}`);
    if (item.evidence !== undefined && (!Array.isArray(item.evidence) || item.evidence.some((ref) => !ref || typeof ref.type !== 'string'))) errors.push(`items[${i}].evidence must be an array of {type,...}`);
  });
  if (typeof receipt.taskLockValid !== 'boolean') errors.push('taskLockValid must be boolean');
  if (typeof receipt.auditorModel !== 'string') errors.push('auditorModel must be a string');
  if (typeof receipt.summary !== 'string') errors.push('summary must be a string');
  return { ok: errors.length === 0, errors };
}

export function recordAuditReceipt(record, receipt, now) {
  const checked = validateReceipt(receipt);
  if (!checked.ok) return { ok: false, reason: 'INVALID_RECEIPT', errors: checked.errors };
  if (!record.taskId || !isOpenPhase(record.phase)) return { ok: false, reason: 'NO_ACTIVE_TASK' };
  if (receipt.taskId !== record.taskId) return { ok: false, reason: 'TASK_MISMATCH' };
  if (receipt.nonce !== record.audit.nonce) return { ok: false, reason: 'NONCE_MISMATCH' };
  if (receipt.contractVersion !== record.contractVersion) return { ok: false, reason: 'CONTRACT_VERSION_MISMATCH' };
  if (receipt.requestDigest !== record.requestDigest) return { ok: false, reason: 'REQUEST_DIGEST_MISMATCH' };
  const stored = {
    taskId: receipt.taskId,
    contractVersion: receipt.contractVersion,
    requestDigest: receipt.requestDigest,
    nonce: receipt.nonce,
    auditorModel: receipt.auditorModel.slice(0, 100),
    summary: receipt.summary.slice(0, 2000),
    taskLockValid: receipt.taskLockValid,
    taskLockIssues: Array.isArray(receipt.taskLockIssues) ? receipt.taskLockIssues.map((issue) => String(issue).slice(0, 300)).slice(0, 20) : [],
    items: receipt.items.slice(0, 100).map((item) => ({ id: item.id.slice(0, 40), requirement: item.requirement.slice(0, 500), status: item.status, gap: typeof item.gap === 'string' ? item.gap.slice(0, 500) : null, evidence: (item.evidence || []).slice(0, 20) })),
    recordedAt: iso(now),
    evidenceDigest: computeEvidenceDigest(record),
  };
  record.audit.receipt = stored;
  record.audit.invalidatedAt = null;
  return { ok: true, record, receipt: stored };
}

export function receiptCoverage(record) {
  const receipt = record.audit.receipt;
  if (!receipt) return { passed: 0, total: 0 };
  return { passed: receipt.items.filter((item) => item.status === 'PASS').length, total: receipt.items.length };
}

function resolveArtifact(cwd, target) {
  return path.isAbsolute(target) ? target : path.join(cwd, target);
}

function dedupe(gaps) {
  const seen = new Set();
  return gaps.filter((gap) => {
    const key = `${gap.code}|${gap.itemId || ''}|${gap.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function evaluateStop(record, { cwd, fileExists }) {
  const gaps = [];
  const freshness = auditFreshness(record);
  if (!freshness.fresh) {
    gaps.push(freshness.reason === 'none'
      ? { code: 'AUDIT_MISSING', detail: 'no contract-auditor receipt has been recorded for this task' }
      : { code: 'AUDIT_STALE', detail: `the recorded audit receipt is stale: the ${freshness.reason} changed after it was recorded` });
  } else {
    const receipt = record.audit.receipt;
    if (receipt.taskLockValid === false) gaps.push({ code: 'TASKLOCK_INVALID', detail: `the Task Lock does not match the request: ${receipt.taskLockIssues.join('; ') || receipt.summary}` });
    for (const item of receipt.items) {
      if (item.status === 'PARTIAL') gaps.push({ code: 'ITEM_PARTIAL', itemId: item.id, requirement: item.requirement, detail: item.gap });
      else if (item.status === 'BLOCKED') gaps.push({ code: 'ITEM_BLOCKED', itemId: item.id, requirement: item.requirement, detail: item.gap });
      for (const ref of item.evidence || []) {
        if (ref.type === 'artifact' && typeof ref.path === 'string' && !fileExists(resolveArtifact(cwd, ref.path))) gaps.push({ code: 'ARTIFACT_MISSING', itemId: item.id, detail: `evidence file not found: ${ref.path}` });
        if (ref.type === 'command' && typeof ref.toolUseId === 'string') {
          const command = record.evidence.commands.find((entry) => entry.toolUseId === ref.toolUseId);
          if (!command) gaps.push({ code: 'COMMAND_FAILED', itemId: item.id, detail: `no recorded command with id ${ref.toolUseId}` });
          else if (!command.ok) gaps.push({ code: 'COMMAND_FAILED', itemId: item.id, detail: `command exited with status ${command.exitStatus}: ${command.command}` });
        }
      }
    }
  }
  for (const artifact of record.evidence.artifacts) if (!fileExists(resolveArtifact(cwd, artifact.path))) gaps.push({ code: 'ARTIFACT_MISSING', detail: `declared artifact not found: ${artifact.path}` });
  if (record.mode === 'hyperfocus') {
    if (record.evidence.claims.length === 0) gaps.push({ code: 'HYPERFOCUS_EMPTY', detail: 'Hyperfocus mode requires a claim ledger; none was recorded through state.mjs evidence-add' });
    else for (const gap of assessLedger(record.evidence.claims, record.evidence.unresolved).gaps) gaps.push({ code: 'HYPERFOCUS_UNSUPPORTED', itemId: gap.claimId, detail: gap.reasons.join('; ') });
  }
  gaps.push(...visualGaps(record, { fileExists }));
  const unique = dedupe(gaps);
  return { pass: unique.length === 0, gaps: unique };
}

export function createDegradedTask(record, { reason, now }) {
  startTask(record, { text: `[unrecoverable] ${String(reason).slice(0, 300)}`, receivedAt: now });
  transition(record, 'DEGRADED_REPORT_REQUIRED', { now });
  return record;
}
