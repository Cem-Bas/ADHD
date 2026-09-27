import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDataRoot, tmpProjectDir, runHook, runState, promptInput, readSession, passingReceipt } from '../helpers.mjs';

test('usage errors are JSON with exit code 1', () => {
  const root = tmpDataRoot();
  const none = runState(root, 'bogus');
  assert.deepEqual([none.status, none.json.error.code], [1, 'USAGE']);
  const noSession = runState(root, 'status');
  assert.deepEqual([noSession.status, noSession.json.error.code], [1, 'USAGE']);
  const missing = runState(root, 'status', { args: ['--session', 'nope'] });
  assert.deepEqual([missing.status, missing.json.error.code], [1, 'NOT_FOUND']);
});

test('status and contract expose the record; --cwd resolves the single open task', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  runHook('prompt', root, promptInput({ prompt: 'first "quoted"', cwd }));
  runHook('prompt', root, promptInput({ prompt: 'then this', cwd }));
  const status = runState(root, 'status', { args: ['--cwd', cwd] });
  assert.equal(status.status, 0);
  assert.deepEqual([status.json.phase, status.json.turns, status.json.audit.reason], ['ACTIVE', 1, 'none']);
  const contract = runState(root, 'contract', { args: ['--cwd', cwd] }).json;
  assert.equal(contract.originalRequest.text, 'first "quoted"');
  assert.deepEqual(contract.userTurns.map((t) => t.text), ['then this']);
  runHook('prompt', root, promptInput({ sessionId: 'sess-test-2', prompt: 'parallel', cwd }));
  assert.equal(runState(root, 'status', { args: ['--cwd', cwd] }).json.error.code, 'AMBIGUOUS_SESSION');
  assert.equal(runState(root, 'status', { args: ['--cwd', tmpProjectDir()] }).json.error.code, 'NOT_FOUND');
});

test('audit-record accepts a bound receipt, reports deterministic gaps, and rejects mismatches', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  runHook('prompt', root, promptInput({ prompt: 'work', cwd }));
  const record = readSession(root, 'sess-test-1');
  const gaps = runState(root, 'audit-record', { args: ['--session', 'sess-test-1'], input: passingReceipt(record, { items: [{ id: 'R1', requirement: 'x', status: 'PASS', evidence: [{ type: 'artifact', path: 'nope.md' }] }] }) }).json;
  assert.deepEqual([gaps.accepted, gaps.verdict, gaps.gaps[0].code, gaps.coverage], [true, 'GAPS', 'ARTIFACT_MISSING', { passed: 1, total: 1 }]);
  const ok = runState(root, 'audit-record', { args: ['--session', 'sess-test-1'], input: passingReceipt(record) }).json;
  assert.deepEqual([ok.accepted, ok.verdict], [true, 'PASS']);
  const bad = runState(root, 'audit-record', { args: ['--session', 'sess-test-1'], input: passingReceipt(record, { nonce: 'deadbeef' }) });
  assert.deepEqual([bad.status, bad.json.accepted, bad.json.reason], [0, false, 'NONCE_MISMATCH']);
  const invalid = runState(root, 'audit-record', { args: ['--session', 'sess-test-1'], input: { taskId: record.taskId } }).json;
  assert.equal(invalid.reason, 'INVALID_RECEIPT');
  const notJson = runState(root, 'audit-record', { args: ['--session', 'sess-test-1'], input: '{nope' });
  assert.deepEqual([notJson.status, notJson.json.error.code], [1, 'INVALID_JSON']);
});

test('evidence-add and artifact-declare validate and merge', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  runHook('prompt', root, promptInput({ prompt: 'deep research', cwd }));
  const source = { url: 'https://a.gov/x', title: 'A', publisher: 'Agency', publicationDate: '2026-01-01', accessedAt: '2026-09-27T00:00:00Z', sourceType: 'primary', evidenceChainId: 'a', relation: 'supports' };
  const claim = { claimId: 'c1', text: 't', class: 'core', stability: 'stable', controversy: 'disputed', confidence: 'low', rationale: 'r', sources: [source] };
  const first = runState(root, 'evidence-add', { args: ['--session', 'sess-test-1'], input: { claims: [claim] } }).json;
  assert.deepEqual([first.ok, first.counts.claims, first.adequate], [true, 1, false]);
  const second = runState(root, 'evidence-add', { args: ['--session', 'sess-test-1'], input: { claims: [claim], unresolved: [{ claimId: 'c1', question: 'q', missingEvidence: 'm', effectOnConclusion: 'e' }] } }).json;
  assert.deepEqual([second.counts.claims, second.counts.unresolved, second.adequate], [1, 1, true]);
  const invalid = runState(root, 'evidence-add', { args: ['--session', 'sess-test-1'], input: { claims: [{ claimId: 'x' }] } });
  assert.deepEqual([invalid.status, invalid.json.error.code], [1, 'INVALID_EVIDENCE']);
  const artifacts = runState(root, 'artifact-declare', { args: ['--session', 'sess-test-1'], input: { artifacts: [{ path: 'README.md', purpose: 'docs' }, { path: 'README.md', purpose: 'docs v2' }] } }).json;
  assert.deepEqual(artifacts.artifacts.map((a) => [a.path, a.purpose]), [['README.md', 'docs v2']]);
});

test('cancel, mode, and new manage the task lifecycle', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  const created = runState(root, 'new', { args: ['--session', 'sess-cli', '--cwd', cwd, '--text', 'from cli'] }).json;
  assert.deepEqual([created.ok, created.phase, created.sessionId], [true, 'ACTIVE', 'sess-cli']);
  assert.equal(readSession(root, 'sess-cli').originalRequest.text, 'from cli');
  const mode = runState(root, 'mode', { args: ['--session', 'sess-cli', '--mode', 'hyperfocus'] }).json;
  assert.deepEqual([mode.ok, mode.mode, mode.contractVersion], [true, 'hyperfocus', 2]);
  assert.equal(runState(root, 'mode', { args: ['--session', 'sess-cli', '--mode', 'loud'] }).json.error.code, 'USAGE');
  const replaced = runState(root, 'new', { args: ['--session', 'sess-cli', '--cwd', cwd], input: 'second task\nfrom stdin' }).json;
  assert.equal(readSession(root, 'sess-cli').originalRequest.text, 'second task\nfrom stdin');
  assert.notEqual(replaced.taskId, created.taskId);
  assert.equal(fs.readdirSync(path.join(root, 'sessions')).filter((n) => n.startsWith('sess-cli.') && n.split('.').length > 2).length, 1);
  const cancelled = runState(root, 'cancel', { args: ['--session', 'sess-cli'] }).json;
  assert.deepEqual([cancelled.ok, cancelled.phase], [true, 'CANCELLED']);
});

test('prefs show/set/unset/reset with global and project scopes', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  const set = runState(root, 'prefs', { args: ['set', '--cwd', cwd, '--key', 'outputDetail', '--value', 'brief'] }).json;
  assert.deepEqual([set.effective.outputDetail, set.sources.outputDetail], ['brief', 'global']);
  const project = runState(root, 'prefs', { args: ['set', '--cwd', cwd, '--scope', 'project', '--key', 'repairCycles', '--value', '3'] }).json;
  assert.deepEqual([project.effective.repairCycles, project.sources.repairCycles], [3, 'project']);
  assert.equal(runState(root, 'prefs', { args: ['set', '--cwd', cwd, '--key', 'repairCycles', '--value', '9'] }).json.error.code, 'PREF_INVALID');
  const shown = runState(root, 'prefs', { args: ['show', '--cwd', cwd] }).json;
  assert.equal(shown.definitions.outputDetail.values.includes('brief'), true);
  const unset = runState(root, 'prefs', { args: ['unset', '--cwd', cwd, '--scope', 'project', '--key', 'repairCycles'] }).json;
  assert.equal(unset.effective.repairCycles, 6);
  const reset = runState(root, 'prefs', { args: ['reset', '--cwd', cwd, '--scope', 'all'] }).json;
  assert.equal(reset.effective.outputDetail, 'standard');
});

test('data show/export/delete-session/delete-project/delete-all with confirmation phrases', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  runHook('prompt', root, promptInput({ prompt: 'work', cwd }));
  runHook('prompt', root, promptInput({ sessionId: 'sess-other', prompt: 'elsewhere', cwd: tmpProjectDir() }));
  runState(root, 'prefs', { args: ['set', '--cwd', cwd, '--scope', 'project', '--key', 'outputDetail', '--value', 'brief'] });
  const shown = runState(root, 'data', { args: ['show', '--cwd', cwd] }).json;
  assert.equal(shown.sessions.length, 2);
  assert.ok(shown.totalBytes > 0);
  const exported = runState(root, 'data', { args: ['export', '--cwd', cwd] }).json;
  assert.ok(fs.existsSync(exported.file));
  assert.equal(JSON.parse(fs.readFileSync(exported.file, 'utf8')).sessions.length, 2);
  const preview = runState(root, 'data', { args: ['delete-project', '--cwd', cwd] }).json;
  assert.equal(preview.requiresConfirmation, true);
  assert.match(preview.phrase, /^delete project p[0-9a-f]{16}$/);
  assert.equal(preview.targets.length, 2);
  const wrong = runState(root, 'data', { args: ['delete-project', '--cwd', cwd, '--confirm', 'delete project nope'] });
  assert.deepEqual([wrong.status, wrong.json.error.code], [1, 'CONFIRM_REQUIRED']);
  const deleted = runState(root, 'data', { args: ['delete-project', '--cwd', cwd, '--confirm', preview.phrase] }).json;
  assert.equal(deleted.deleted.length, 2);
  assert.equal(fs.existsSync(path.join(root, 'sessions', 'sess-test-1.json')), false);
  assert.equal(fs.existsSync(path.join(root, 'sessions', 'sess-other.json')), true);
  const session = runState(root, 'data', { args: ['delete-session', '--session', 'sess-other'] }).json;
  assert.equal(session.deleted.some((f) => f.endsWith('sess-other.json')), true);
  const allPreview = runState(root, 'data', { args: ['delete-all'] }).json;
  assert.deepEqual([allPreview.requiresConfirmation, allPreview.phrase], [true, 'delete all adhd data']);
  const all = runState(root, 'data', { args: ['delete-all', '--confirm', 'delete all adhd data'] }).json;
  assert.ok(all.deleted.length >= 1);
  assert.deepEqual(fs.readdirSync(root), []);
  assert.equal(runState(root, 'gc').json.removedSessions, 0);
});

test('listing commands tolerate unreadable entries, and corrupt state is reported as STATE_CORRUPT', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  runHook('prompt', root, promptInput({ prompt: 'work', cwd }));
  fs.mkdirSync(path.join(root, 'sessions', 'weird.json'));
  const shown = runState(root, 'data', { args: ['show', '--cwd', cwd] });
  assert.equal(shown.status, 0);
  assert.equal(shown.json.sessions.length, 1);
  assert.equal(runState(root, 'data', { args: ['export', '--cwd', cwd] }).status, 0);
  assert.equal(runState(root, 'gc').status, 0);
  assert.equal(runState(root, 'status', { args: ['--cwd', cwd] }).json.phase, 'ACTIVE');
  fs.writeFileSync(path.join(root, 'sessions', 'sess-test-1.json'), '{corrupt');
  const audit = runState(root, 'audit-record', { args: ['--session', 'sess-test-1'], input: { taskId: 'x' } });
  assert.deepEqual([audit.status, audit.json.error.code], [1, 'STATE_CORRUPT']);
});
