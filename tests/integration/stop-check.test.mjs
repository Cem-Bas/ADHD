import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDataRoot, tmpProjectDir, runHook, runState, promptInput, stopInput, toolInput, readSession, writeSession, sessionFilePath, passingReceipt } from '../helpers.mjs';

const BOUNDED = 'ADHD BOUNDED STOP REPORT\nUnresolved items: a\nEvidence gathered: b\nExact blocker: c\nSmallest next action: d';
const DEGRADED = 'ADHD DEGRADED STOP REPORT\nVerification failure: x\nWork completed without verification: y\nSmallest next action: z';

function begin(root, cwd, prompt = 'build it') {
  runHook('prompt', root, promptInput({ prompt, cwd }));
  return readSession(root, 'sess-test-1');
}

function audit(root, record, overrides) {
  return runState(root, 'audit-record', { args: ['--session', 'sess-test-1'], input: passingReceipt(record, overrides) }).json;
}

test('no state or a closed task allows the stop silently', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  const none = runHook('stop', root, stopInput({ cwd }));
  assert.deepEqual([none.status, none.stdout], [0, '']);
  begin(root, cwd);
  runHook('prompt', root, promptInput({ prompt: 'cancel', cwd }));
  assert.equal(runHook('stop', root, stopInput({ cwd })).stdout, '');
});

test('a fresh all-PASS receipt with existing artifacts completes the task', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  fs.writeFileSync(path.join(cwd, 'README.md'), '# hi');
  const record = begin(root, cwd);
  runState(root, 'artifact-declare', { args: ['--session', 'sess-test-1'], input: { artifacts: [{ path: 'README.md', purpose: 'docs' }] } });
  assert.equal(audit(root, readSession(root, 'sess-test-1')).accepted, true);
  const result = runHook('stop', root, stopInput({ cwd, lastAssistantMessage: 'Done.' }));
  assert.equal(result.json.decision, undefined);
  assert.match(result.json.systemMessage, /COMPLETE \(1\/1 items PASS, 0 repair\(s\)\)/);
  const after = readSession(root, 'sess-test-1');
  assert.deepEqual([after.phase, after.closure.reason, after.taskId], ['COMPLETE', 'complete', record.taskId]);
});

test('a missing receipt blocks into REPAIR_1 with the auditor instruction and a new nonce', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  const before = begin(root, cwd);
  const result = runHook('stop', root, stopInput({ cwd, lastAssistantMessage: 'All done!' }));
  assert.equal(result.json.decision, 'block');
  assert.ok(result.json.reason.startsWith('[ADHD] REPAIR 1 of 6'));
  assert.ok(result.json.reason.includes('[AUDIT_MISSING]'));
  assert.match(result.json.systemMessage, /repair 1\/6/);
  const after = readSession(root, 'sess-test-1');
  assert.deepEqual([after.phase, after.repair.completed, after.repair.blocksIssued], ['REPAIR_1', 1, 1]);
  assert.notEqual(after.audit.nonce, before.audit.nonce);
  assert.ok(result.json.reason.includes(after.audit.nonce));
});

test('gaps from the receipt and deterministic checks block with a targeted list; fixing them completes', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  begin(root, cwd);
  let record = readSession(root, 'sess-test-1');
  audit(root, record, { items: [
    { id: 'R1', requirement: 'write README', status: 'PASS', evidence: [{ type: 'artifact', path: 'README.md' }] },
    { id: 'R2', requirement: 'add tests', status: 'PARTIAL', gap: 'no tests for parser' },
  ] });
  let result = runHook('stop', root, stopInput({ cwd }));
  assert.equal(result.json.decision, 'block');
  assert.ok(result.json.reason.includes('[ITEM_PARTIAL] R2 "add tests" — no tests for parser'));
  assert.ok(result.json.reason.includes('[ARTIFACT_MISSING] R1 — evidence file not found: README.md'));
  fs.writeFileSync(path.join(cwd, 'README.md'), '# ok');
  record = readSession(root, 'sess-test-1');
  assert.equal(audit(root, record).accepted, true);
  result = runHook('stop', root, stopInput({ cwd }));
  assert.equal(result.json.decision, undefined);
  assert.match(result.json.systemMessage, /COMPLETE \(1\/1 items PASS, 1 repair\(s\)\)/);
});

test('a receipt goes stale after a user turn or a mutating tool event and old receipts cannot be replayed', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  begin(root, cwd);
  let record = readSession(root, 'sess-test-1');
  const oldReceipt = passingReceipt(record);
  assert.equal(audit(root, record).accepted, true);
  runHook('prompt', root, promptInput({ prompt: 'also add a changelog', cwd }));
  let result = runHook('stop', root, stopInput({ cwd }));
  assert.ok(result.json.reason.includes('[AUDIT_STALE]'));
  const replay = runState(root, 'audit-record', { args: ['--session', 'sess-test-1'], input: oldReceipt }).json;
  assert.deepEqual([replay.accepted, replay.reason], [false, 'NONCE_MISMATCH']);
  record = readSession(root, 'sess-test-1');
  assert.equal(audit(root, record).accepted, true);
  runHook('evidence', root, toolInput({ cwd, toolName: 'Edit', toolInputValue: { file_path: 'a.js' }, toolResponse: 'ok', toolUseId: 'u-edit' }));
  result = runHook('stop', root, stopInput({ cwd }));
  assert.ok(result.json.reason.includes('evidence changed after it was recorded'));
  const other = tmpDataRoot();
  begin(other, cwd);
  const cross = runState(other, 'audit-record', { args: ['--session', 'sess-test-1'], input: passingReceipt(record) }).json;
  assert.equal(cross.accepted, false);
});

test('six failed repairs lead to one bounded-report request, then BOUNDED_STOP; never more than seven blocks', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  begin(root, cwd);
  const decisions = [];
  for (let i = 0; i < 7; i += 1) decisions.push(runHook('stop', root, stopInput({ cwd, stopHookActive: i > 0 })).json);
  assert.equal(decisions.filter((d) => d.decision === 'block').length, 7);
  assert.ok(decisions[5].reason.startsWith('[ADHD] REPAIR 6 of 6'));
  assert.ok(decisions[6].reason.includes('REPAIR BUDGET EXHAUSTED'));
  assert.ok(decisions[6].reason.includes('ADHD BOUNDED STOP REPORT'));
  let record = readSession(root, 'sess-test-1');
  assert.deepEqual([record.phase, record.repair.completed, record.repair.blocksIssued], ['REPORT_REQUIRED', 6, 7]);
  const final = runHook('stop', root, stopInput({ cwd, stopHookActive: true, lastAssistantMessage: BOUNDED })).json;
  assert.equal(final.decision, undefined);
  assert.match(final.systemMessage, /BOUNDED_STOP after 6 repairs — NOT complete/);
  record = readSession(root, 'sess-test-1');
  assert.deepEqual([record.phase, record.closure.reason], ['BOUNDED_STOP', 'bounded']);
  assert.equal(runHook('stop', root, stopInput({ cwd })).stdout, '');
});

test('a malformed or absent bounded report ends as DEGRADED_STOP instead of looping', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  begin(root, cwd);
  const record = readSession(root, 'sess-test-1');
  record.phase = 'REPORT_REQUIRED';
  record.repair.completed = 6;
  record.repair.blocksIssued = 7;
  writeSession(root, record);
  const input = stopInput({ cwd, stopHookActive: true, lastAssistantMessage: null, transcriptPath: path.join(root, 'no-such-transcript.jsonl') });
  const result = runHook('stop', root, input).json;
  assert.equal(result.decision, undefined);
  assert.match(result.systemMessage, /DEGRADED_STOP — completion was NOT verified/);
  assert.equal(readSession(root, 'sess-test-1').phase, 'DEGRADED_STOP');
});

test('the repairCycles preference bounds the repair count', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  fs.writeFileSync(path.join(root, 'preferences.json'), JSON.stringify({ repairCycles: 2 }));
  begin(root, cwd);
  const d1 = runHook('stop', root, stopInput({ cwd })).json;
  const d2 = runHook('stop', root, stopInput({ cwd, stopHookActive: true })).json;
  const d3 = runHook('stop', root, stopInput({ cwd, stopHookActive: true })).json;
  assert.ok(d1.reason.startsWith('[ADHD] REPAIR 1 of 2'));
  assert.ok(d2.reason.startsWith('[ADHD] REPAIR 2 of 2'));
  assert.ok(d3.reason.includes('REPAIR BUDGET EXHAUSTED (2 repairs)'));
  assert.equal(readSession(root, 'sess-test-1').phase, 'REPORT_REQUIRED');
});

test('background tasks and scheduled wakeups pause without consuming repairs', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  begin(root, cwd);
  const bg = runHook('stop', root, stopInput({ cwd, backgroundTasks: [{ id: 'b1', type: 'shell', command: 'npm test' }] }));
  assert.equal(bg.stdout, '');
  const cron = runHook('stop', root, stopInput({ cwd, sessionCrons: [{ id: 'c1', schedule: '0 9 * * 1', recurring: false, prompt: 'check' }] }));
  assert.equal(cron.stdout, '');
  const record = readSession(root, 'sess-test-1');
  assert.deepEqual([record.phase, record.repair.completed, record.repair.blocksIssued], ['ACTIVE', 0, 0]);
});

test('items BLOCKED on the user pause the task without advancing repair state', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  begin(root, cwd);
  audit(root, readSession(root, 'sess-test-1'), { items: [{ id: 'R1', requirement: 'deploy to prod', status: 'BLOCKED', gap: 'needs the production credentials from the user' }] });
  const result = runHook('stop', root, stopInput({ cwd, lastAssistantMessage: 'Which credentials should I use?' })).json;
  assert.equal(result.decision, undefined);
  assert.match(result.systemMessage, /paused — 1 item\(s\) BLOCKED/);
  const record = readSession(root, 'sess-test-1');
  assert.deepEqual([record.phase, record.repair.completed], ['ACTIVE', 0]);
  assert.equal(record.repair.gaps[0].code, 'ITEM_BLOCKED');
});

test('hyperfocus tasks need a ledger that meets the support rules', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  begin(root, cwd, 'deep research on x');
  audit(root, readSession(root, 'sess-test-1'));
  let result = runHook('stop', root, stopInput({ cwd })).json;
  assert.ok(result.reason.includes('[HYPERFOCUS_EMPTY]'));
  const source = { url: 'https://a.gov/x', title: 'A', publisher: 'Agency', publicationDate: '2026-01-01', accessedAt: '2026-09-27T00:00:00Z', sourceType: 'primary', evidenceChainId: 'a', relation: 'supports' };
  runState(root, 'evidence-add', { args: ['--session', 'sess-test-1'], input: { claims: [{ claimId: 'c1', text: 't', class: 'core', stability: 'stable', controversy: 'undisputed', confidence: 'moderate', rationale: 'r', sources: [source] }] } });
  audit(root, readSession(root, 'sess-test-1'));
  result = runHook('stop', root, stopInput({ cwd })).json;
  assert.match(result.systemMessage, /COMPLETE/);
});

test('corrupt state at Stop requires a degraded report once, then ends as DEGRADED_STOP', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  fs.writeFileSync(sessionFilePath(root, 'sess-test-1'), '{corrupt');
  const first = runHook('stop', root, stopInput({ cwd })).json;
  assert.equal(first.decision, 'block');
  assert.ok(first.reason.includes('ADHD DEGRADED STOP REPORT'));
  assert.equal(readSession(root, 'sess-test-1').phase, 'DEGRADED_REPORT_REQUIRED');
  const second = runHook('stop', root, stopInput({ cwd, stopHookActive: true, lastAssistantMessage: DEGRADED })).json;
  assert.equal(second.decision, undefined);
  assert.match(second.systemMessage, /DEGRADED_STOP/);
  assert.equal(readSession(root, 'sess-test-1').phase, 'DEGRADED_STOP');
  assert.equal(runHook('stop', root, stopInput({ cwd })).stdout, '');
});

test('malformed hook input and invalid session ids never block', () => {
  const root = tmpDataRoot();
  assert.deepEqual([runHook('stop', root, 'nope').status, runHook('stop', root, 'nope').stdout], [0, '']);
  const invalid = runHook('stop', root, stopInput({ sessionId: 'bad/id' }));
  assert.deepEqual([invalid.status, invalid.stdout], [0, '']);
});
