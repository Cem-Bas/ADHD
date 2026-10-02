import test from 'node:test';
import assert from 'node:assert/strict';
import { newSessionRecord, validateSessionRecord } from '../../scripts/common/schema.mjs';
import { startTask, appendUserTurn, setMode, cancelTask, closeReplaced, recordToolEvent, declareArtifacts, addResearchEvidence, auditFreshness, recordAuditReceipt, evaluateStop, receiptCoverage, trackAgent, createDegradedTask, computeEvidenceDigest, markLastTurn, recordAnswer } from '../../scripts/common/session.mjs';
import { summarizeToolEvent } from '../../scripts/common/evidence.mjs';
import { passingReceipt } from '../helpers.mjs';

const now = Date.parse('2026-09-27T10:00:00Z');
const fresh = (text = 'Build "x" with $(echo) and\nnewlines 日本語') => startTask(newSessionRecord({ sessionId: 's', cwd: '/p', now }), { text, receivedAt: now, preferencesSnapshot: { repairCycles: 6, retentionDays: 30 } });
const bashEvent = (id, exitCode = 0, command = 'npm test') => summarizeToolEvent({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: id, tool_input: { command }, tool_response: { stdout: '', exitCode } }, { now });
const exists = new Set(['/p/README.md']);
const fileExists = (p) => exists.has(p.replace(/\\/g, '/'));

test('startTask preserves the prompt verbatim and produces a valid ACTIVE record', () => {
  const record = fresh();
  assert.equal(record.originalRequest.text, 'Build "x" with $(echo) and\nnewlines 日本語');
  assert.equal(record.phase, 'ACTIVE');
  assert.equal(record.contractVersion, 1);
  assert.match(record.taskId, /^t[a-z0-9]{15}$/);
  assert.match(record.audit.nonce, /^[0-9a-f]{32}$/);
  assert.deepEqual(validateSessionRecord(record), { ok: true, errors: [] });
});

test('user turns are appended in order, bump the contract, and rotate the nonce', () => {
  const record = fresh();
  const nonce = record.audit.nonce;
  const digest = record.requestDigest;
  appendUserTurn(record, { text: 'also add tests', receivedAt: now + 1 });
  appendUserTurn(record, { text: 'actually, no tests', receivedAt: now + 2 });
  assert.deepEqual(record.userTurns.map((t) => [t.sequence, t.text]), [[1, 'also add tests'], [2, 'actually, no tests']]);
  assert.equal(record.contractVersion, 3);
  assert.notEqual(record.requestDigest, digest);
  assert.notEqual(record.audit.nonce, nonce);
  assert.equal(record.originalRequest.text.startsWith('Build "x"'), true);
});

test('receipts must bind to task, version, digest, and nonce', () => {
  const record = fresh();
  assert.equal(recordAuditReceipt(record, passingReceipt(record, { nonce: 'ffff' }), now).reason, 'NONCE_MISMATCH');
  assert.equal(recordAuditReceipt(record, passingReceipt(record, { contractVersion: 9 }), now).reason, 'CONTRACT_VERSION_MISMATCH');
  assert.equal(recordAuditReceipt(record, passingReceipt(record, { taskId: 'tother' }), now).reason, 'TASK_MISMATCH');
  assert.equal(recordAuditReceipt(record, passingReceipt(record, { items: [] }), now).reason, 'INVALID_RECEIPT');
  assert.equal(recordAuditReceipt(record, passingReceipt(record, { items: [{ id: 'R1', requirement: 'x', status: 'PARTIAL' }] }), now).reason, 'INVALID_RECEIPT');
  const ok = recordAuditReceipt(record, passingReceipt(record), now);
  assert.equal(ok.ok, true);
  assert.deepEqual(auditFreshness(record), { fresh: true, reason: 'fresh' });
  const old = passingReceipt(record);
  appendUserTurn(record, { text: 'more', receivedAt: now + 5 });
  assert.equal(auditFreshness(record).reason, 'nonce');
  assert.equal(recordAuditReceipt(record, old, now).reason, 'NONCE_MISMATCH');
  const other = fresh();
  assert.equal(recordAuditReceipt(other, passingReceipt(record), now).reason, 'TASK_MISMATCH');
});

test('read-only commands after an audit keep the receipt fresh; a mutating command still stales it', () => {
  const record = fresh();
  recordAuditReceipt(record, passingReceipt(record), now);
  recordToolEvent(record, bashEvent('r1', 0, 'git status && cat README.md | head -5'), now);
  recordToolEvent(record, bashEvent('r2', 1, 'grep -rn missing scripts'), now);
  assert.deepEqual(auditFreshness(record), { fresh: true, reason: 'fresh' });
  assert.equal(record.audit.invalidatedAt, null);
  recordToolEvent(record, bashEvent('m1', 0, 'sed -i "" s/a/b/ README.md'), now);
  assert.equal(auditFreshness(record).reason, 'evidence');
});

test('mutating tool events stale a receipt; Agent events and receipts themselves do not', () => {
  const record = fresh();
  recordAuditReceipt(record, passingReceipt(record), now);
  recordToolEvent(record, summarizeToolEvent({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'a1', tool_input: { subagent_type: 'adhd:contract-auditor' }, tool_response: 'ok' }, { now }), now);
  assert.equal(auditFreshness(record).fresh, true);
  recordToolEvent(record, bashEvent('b1'), now);
  assert.equal(auditFreshness(record).reason, 'evidence');
  assert.equal(record.audit.invalidatedAt !== null, true);
  recordAuditReceipt(record, passingReceipt(record), now + 1);
  assert.equal(auditFreshness(record).fresh, true);
});

test('evaluateStop reports every deterministic gap and passes only when clean', () => {
  const record = fresh();
  assert.deepEqual(evaluateStop(record, { cwd: '/p', fileExists }).gaps.map((g) => g.code), ['AUDIT_MISSING']);
  recordToolEvent(record, bashEvent('good', 0), now);
  recordToolEvent(record, bashEvent('bad', 1, 'npm run lint'), now);
  declareArtifacts(record, [{ path: 'README.md', purpose: 'docs' }, { path: 'missing.md' }], now);
  recordAuditReceipt(record, passingReceipt(record, {
    taskLockValid: false, taskLockIssues: ['invented deliverable'],
    items: [
      { id: 'R1', requirement: 'readme', status: 'PASS', evidence: [{ type: 'artifact', path: 'README.md' }, { type: 'command', toolUseId: 'good' }] },
      { id: 'R2', requirement: 'lint', status: 'PASS', evidence: [{ type: 'command', toolUseId: 'bad' }] },
      { id: 'R3', requirement: 'deploy', status: 'BLOCKED', gap: 'needs credentials' },
      { id: 'R4', requirement: 'tests', status: 'PARTIAL', gap: 'no tests for x' },
      { id: 'R5', requirement: 'ghost', status: 'PASS', evidence: [{ type: 'command', toolUseId: 'nope' }] },
    ],
  }), now);
  const result = evaluateStop(record, { cwd: '/p', fileExists });
  assert.equal(result.pass, false);
  assert.deepEqual(result.gaps.map((g) => g.code).sort(), ['ARTIFACT_MISSING', 'COMMAND_FAILED', 'COMMAND_FAILED', 'ITEM_BLOCKED', 'ITEM_PARTIAL', 'TASKLOCK_INVALID']);
  assert.deepEqual(receiptCoverage(record), { passed: 3, total: 5 });
  const clean = fresh();
  declareArtifacts(clean, [{ path: 'README.md' }], now);
  recordAuditReceipt(clean, passingReceipt(clean), now);
  assert.deepEqual(evaluateStop(clean, { cwd: '/p', fileExists }), { pass: true, gaps: [] });
});

test('hyperfocus mode requires a ledger that satisfies the support rules', () => {
  const record = fresh('deep research on x');
  setMode(record, 'hyperfocus', now);
  assert.equal(record.mode, 'hyperfocus');
  recordAuditReceipt(record, passingReceipt(record), now);
  assert.deepEqual(evaluateStop(record, { cwd: '/p', fileExists }).gaps.map((g) => g.code), ['HYPERFOCUS_EMPTY']);
  const source = { url: 'https://a.gov/x', title: 'A', publisher: 'Agency', publicationDate: '2026-01-01', accessedAt: '2026-09-27T00:00:00Z', sourceType: 'primary', evidenceChainId: 'a', relation: 'supports' };
  addResearchEvidence(record, { claims: [{ claimId: 'c1', text: 't', class: 'core', stability: 'stable', controversy: 'undisputed', confidence: 'moderate', rationale: 'r', sources: [source] }, { claimId: 'c2', text: 'u', class: 'core', stability: 'stable', controversy: 'disputed', confidence: 'moderate', rationale: 'r', sources: [source] }] });
  assert.equal(auditFreshness(record).reason, 'evidence');
  recordAuditReceipt(record, passingReceipt(record), now);
  const gaps = evaluateStop(record, { cwd: '/p', fileExists }).gaps;
  assert.deepEqual(gaps.map((g) => [g.code, g.itemId]), [['HYPERFOCUS_UNSUPPORTED', 'c2']]);
  assert.equal(record.evidence.sources.length, 1);
  assert.throws(() => addResearchEvidence(record, { claims: [{ claimId: 'bad' }] }), /INVALID_EVIDENCE|text required/);
});

test('cancel, replace, agent tracking, and degraded task creation', () => {
  const record = fresh();
  trackAgent(record, { hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'adhd:source-researcher' }, now);
  trackAgent(record, { hook_event_name: 'SubagentStop', agent_id: 'ag1', agent_type: 'adhd:source-researcher' }, now + 10);
  assert.equal(record.evidence.agents[0].stoppedAt, new Date(now + 10).toISOString());
  cancelTask(record, now);
  assert.equal(record.phase, 'CANCELLED');
  const replaced = fresh();
  closeReplaced(replaced, now);
  assert.deepEqual([replaced.phase, replaced.closure.reason], ['CANCELLED', 'replaced']);
  const degraded = createDegradedTask(newSessionRecord({ sessionId: 's', cwd: '/p', now }), { reason: 'state corrupted', now });
  assert.equal(degraded.phase, 'DEGRADED_REPORT_REQUIRED');
  assert.match(degraded.originalRequest.text, /state corrupted/);
  assert.equal(validateSessionRecord(degraded).ok, true);
});

test('research sources are copied with secret-like url parameters redacted, and the redacted url deduplicates', () => {
  const record = fresh('deep research on x');
  setMode(record, 'hyperfocus', now);
  const source = { url: 'https://data.example/report?token=abcdefghijklmnop', title: 'R', publisher: 'P', publicationDate: '2026-01-01', accessedAt: '2026-09-27T00:00:00Z', sourceType: 'secondary', evidenceChainId: 'r', relation: 'supports' };
  addResearchEvidence(record, { claims: [{ claimId: 'c1', text: 't', class: 'background', stability: 'stable', controversy: 'undisputed', confidence: 'low', rationale: 'r', sources: [source] }], sources: [source] });
  assert.deepEqual(record.evidence.sources.map((item) => item.url), ['https://data.example/report?[REDACTED]']);
  addResearchEvidence(record, { sources: [source] });
  assert.equal(record.evidence.sources.length, 1);
  assert.equal(validateSessionRecord(record).ok, true);
});

test('SubagentStop closes the latest open entry for an agent id that started more than once', () => {
  const record = fresh();
  const stop = (at) => trackAgent(record, { hook_event_name: 'SubagentStop', agent_id: 'ag1', agent_type: 'adhd:contract-auditor' }, at);
  trackAgent(record, { hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'adhd:contract-auditor' }, now);
  trackAgent(record, { hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'adhd:contract-auditor' }, now + 5);
  stop(now + 10);
  assert.deepEqual(record.evidence.agents.map((agent) => agent.stoppedAt), [null, new Date(now + 10).toISOString()]);
  stop(now + 20);
  assert.deepEqual(record.evidence.agents.map((agent) => agent.stoppedAt), [new Date(now + 20).toISOString(), new Date(now + 10).toISOString()]);
  trackAgent(record, { hook_event_name: 'SubagentStop', agent_id: 'ghost' }, now + 30);
  assert.equal(record.evidence.agents.length, 2);
});

test('tool event list is capped and drop count recorded; evidence digest ignores dropped history', () => {
  const record = fresh();
  for (let i = 0; i < 505; i += 1) recordToolEvent(record, bashEvent(`u${i}`), now);
  assert.equal(record.evidence.toolEvents.length, 500);
  assert.equal(record.evidence.dropped.toolEvents, 5);
  assert.equal(record.evidence.commands.length, 500);
  assert.equal(typeof computeEvidenceDigest(record), 'string');
});

test('receipts are rejected once the task is closed, and the record stays valid', () => {
  const record = fresh();
  cancelTask(record, now);
  assert.equal(recordAuditReceipt(record, passingReceipt(record), now).reason, 'NO_ACTIVE_TASK');
  assert.equal(validateSessionRecord(record).ok, true);
});

test('task start and user turns mark the last turn as a user turn; a control mark survives until then', () => {
  const record = fresh();
  assert.equal(record.extensions.lastTurn, 'user');
  markLastTurn(record, 'control');
  assert.equal(record.extensions.lastTurn, 'control');
  appendUserTurn(record, { text: 'more', receivedAt: now + 1 });
  assert.deepEqual([record.extensions.lastTurn, record.extensions.version], ['user', 1]);
  assert.deepEqual(validateSessionRecord(record), { ok: true, errors: [] });
  const bare = newSessionRecord({ sessionId: 's3', cwd: '/p', now });
  delete bare.extensions;
  markLastTurn(bare, 'control');
  assert.deepEqual(bare.extensions, { version: 1, lastTurn: 'control' });
});

test('startTask consumes a pending mode request and keeps the extensions valid', () => {
  const record = newSessionRecord({ sessionId: 's', cwd: '/p', now });
  record.extensions.pendingMode = 'hyperfocus';
  startTask(record, { text: 'x', receivedAt: now, mode: 'hyperfocus' });
  assert.equal('pendingMode' in record.extensions, false);
  assert.equal(record.extensions.version, 1);
  assert.deepEqual(validateSessionRecord(record), { ok: true, errors: [] });
  const bare = newSessionRecord({ sessionId: 's2', cwd: '/p', now });
  delete bare.extensions;
  startTask(bare, { text: 'y', receivedAt: now });
  assert.equal(validateSessionRecord(bare).ok, true);
});

test('startTask clamps the repair budget and both startTask and setMode reject unknown modes', () => {
  const high = startTask(newSessionRecord({ sessionId: 's', cwd: '/p', now }), { text: 'x', receivedAt: now, preferencesSnapshot: { repairCycles: 9 } });
  const low = startTask(newSessionRecord({ sessionId: 's', cwd: '/p', now }), { text: 'x', receivedAt: now, preferencesSnapshot: { repairCycles: -3 } });
  assert.deepEqual([high.repair.maximum, low.repair.maximum], [6, 0]);
  assert.equal(validateSessionRecord(high).ok, true);
  assert.throws(() => startTask(newSessionRecord({ sessionId: 's', cwd: '/p', now }), { text: 'x', receivedAt: now, mode: 'bogus' }), /INVALID_MODE|mode must be/);
  assert.throws(() => setMode(fresh(), 'bogus', now), /INVALID_MODE|mode must be/);
});

test('cap violations throw before anything is recorded', () => {
  const record = fresh();
  const tooMany = Array.from({ length: 201 }, (_, i) => ({ path: `file-${i}.md` }));
  assert.throws(() => declareArtifacts(record, tooMany, now), /TOO_MANY_ARTIFACTS|at most 200/);
  assert.equal(record.evidence.artifacts.length, 0);
  const source = { url: 'https://a.gov/x', title: 'A', publisher: 'Agency', publicationDate: '2026-01-01', accessedAt: '2026-09-27T00:00:00Z', sourceType: 'primary', evidenceChainId: 'a', relation: 'supports' };
  const claims = Array.from({ length: 301 }, (_, i) => ({ claimId: `c${i}`, text: 't', class: 'background', stability: 'stable', controversy: 'undisputed', confidence: 'low', rationale: 'r', sources: [source] }));
  assert.throws(() => addResearchEvidence(record, { claims }), /LEDGER_TOO_LARGE|exceeds limits/);
  assert.deepEqual([record.evidence.claims.length, record.evidence.sources.length], [0, 0]);
});

test('recordAnswer stores the answer with its contract version, caps size and count, and changes the evidence digest', () => {
  const record = fresh();
  const before = computeEvidenceDigest(record);
  recordAnswer(record, 'The answer is no, because X.', now);
  assert.deepEqual(record.evidence.answers[0], { contractVersion: 1, text: 'The answer is no, because X.', truncated: false, at: '2026-09-27T10:00:00.000Z' });
  assert.notEqual(computeEvidenceDigest(record), before);
  recordAnswer(record, 'x'.repeat(20_050), now);
  assert.deepEqual([record.evidence.answers[1].text.length, record.evidence.answers[1].truncated], [20_000, true]);
  for (let i = 0; i < 25; i += 1) recordAnswer(record, `a${i}`, now);
  assert.equal(record.evidence.answers.length, 20);
  assert.equal(record.evidence.answers.at(-1).text, 'a24');
  assert.throws(() => recordAnswer(record, '   ', now), /INVALID_ANSWER|non-empty/);
  assert.throws(() => recordAnswer(record, 42, now), /INVALID_ANSWER|non-empty/);
});
