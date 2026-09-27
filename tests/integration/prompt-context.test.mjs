import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDataRoot, tmpProjectDir, runHook, runState, promptInput, stopInput, readSession, sessionFilePath, runScript, passingReceipt, SCRIPTS, TASK_NOTIFICATION } from '../helpers.mjs';

const ctx = (text) => text.hookSpecificOutput.additionalContext;

test('an ordinary prompt starts a task, preserves the text verbatim, and returns the full protocol', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  const prompt = 'Build "x" with $(rm -rf /) `ticks`\n  second line 日本語 🚀 ';
  const result = runHook('prompt', root, promptInput({ prompt, cwd }));
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.json.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.ok(ctx(result.json).includes('TASK LOCK\nGoal:'));
  assert.ok(ctx(result.json).includes(prompt));
  const record = readSession(root, 'sess-test-1');
  assert.equal(record.originalRequest.text, prompt);
  assert.equal(record.phase, 'ACTIVE');
  assert.equal(record.mode, 'standard');
  assert.equal(record.contractVersion, 1);
  assert.equal(record.cwd, cwd.replace(/\\/g, '/').replace(/^([A-Z]):/, (m, d) => `${d.toLowerCase()}:`));
  assert.equal(fs.readdirSync(path.join(root, 'sessions')).filter((n) => n.endsWith('.lock')).length, 0);
});

test('later prompts are appended in order and returned as the short protocol; corrections stay verbatim', () => {
  const root = tmpDataRoot();
  runHook('prompt', root, promptInput({ prompt: 'first' }));
  const second = runHook('prompt', root, promptInput({ prompt: 'actually use TypeScript' }));
  runHook('prompt', root, promptInput({ prompt: 'stop doing X and do Y' }));
  assert.equal(ctx(second.json).includes('TASK LOCK\nGoal:'), false);
  assert.ok(ctx(second.json).includes('actually use TypeScript'));
  const record = readSession(root, 'sess-test-1');
  assert.deepEqual(record.userTurns.map((t) => [t.sequence, t.text]), [[1, 'actually use TypeScript'], [2, 'stop doing X and do Y']]);
  assert.equal(record.contractVersion, 3);
  assert.equal(record.phase, 'ACTIVE');
});

test('exact cancellation cancels and returns the cancelled context; a bare "stop" with no task does nothing', () => {
  const root = tmpDataRoot();
  const idle = runHook('prompt', root, promptInput({ prompt: 'stop' }));
  assert.equal(idle.stdout, '');
  runHook('prompt', root, promptInput({ prompt: 'do the thing' }));
  const cancelled = runHook('prompt', root, promptInput({ prompt: 'Stop this task.' }));
  assert.ok(ctx(cancelled.json).includes('CANCELLED'));
  assert.equal(readSession(root, 'sess-test-1').phase, 'CANCELLED');
  const next = runHook('prompt', root, promptInput({ prompt: 'new thing' }));
  const record = readSession(root, 'sess-test-1');
  assert.equal(record.phase, 'ACTIVE');
  assert.equal(record.originalRequest.text, 'new thing');
  assert.ok(ctx(next.json).includes('TASK LOCK'));
  assert.equal(fs.readdirSync(path.join(root, 'sessions')).filter((n) => n.split('.').length > 2).length, 1);
});

test('replacement prefixes close the prior task as replaced and start a new one', () => {
  const root = tmpDataRoot();
  runHook('prompt', root, promptInput({ prompt: 'old task' }));
  const before = readSession(root, 'sess-test-1');
  runHook('prompt', root, promptInput({ prompt: 'New task: fresh start' }));
  const after = readSession(root, 'sess-test-1');
  assert.notEqual(after.taskId, before.taskId);
  assert.equal(after.originalRequest.text, 'fresh start');
  const archived = JSON.parse(fs.readFileSync(path.join(root, 'sessions', `sess-test-1.${before.taskId}.json`), 'utf8'));
  assert.deepEqual([archived.phase, archived.closure.reason], ['CANCELLED', 'replaced']);
  const empty = runHook('prompt', root, promptInput({ prompt: 'Replace task:' }));
  assert.ok(ctx(empty.json).includes('ask for it in one line'));
  assert.equal(readSession(root, 'sess-test-1').phase, 'CANCELLED');
});

test('control commands are not captured; new/hyperfocus/cancel apply their operation', () => {
  const root = tmpDataRoot();
  runHook('prompt', root, promptInput({ prompt: 'task one' }));
  const status = runHook('prompt', root, promptInput({ prompt: '/adhd:status' }));
  assert.ok(ctx(status.json).includes('/adhd:status requested'));
  assert.equal(readSession(root, 'sess-test-1').userTurns.length, 0);
  const hyper = runHook('prompt', root, promptInput({ prompt: '/adhd:hyperfocus and compare vendors' }));
  let record = readSession(root, 'sess-test-1');
  assert.equal(record.mode, 'hyperfocus');
  assert.deepEqual(record.userTurns.map((t) => t.text), ['and compare vendors']);
  assert.ok(ctx(hyper.json).includes('HYPERFOCUS MODE IS ON'));
  runHook('prompt', root, promptInput({ prompt: '/adhd:new task two' }));
  record = readSession(root, 'sess-test-1');
  assert.equal(record.originalRequest.text, 'task two');
  assert.equal(record.mode, 'standard');
  const cancel = runHook('prompt', root, promptInput({ prompt: '/adhd:cancel' }));
  assert.ok(ctx(cancel.json).includes('CANCELLED'));
  assert.equal(readSession(root, 'sess-test-1').phase, 'CANCELLED');
  const pending = runHook('prompt', root, promptInput({ prompt: '/adhd:hyperfocus' }));
  assert.ok(ctx(pending.json).includes('next request'));
  runHook('prompt', root, promptInput({ prompt: 'compare databases' }));
  assert.equal(readSession(root, 'sess-test-1').mode, 'hyperfocus');
  const contract = runHook('prompt', root, promptInput({ prompt: '/adhd:contract\n' }));
  assert.ok(ctx(contract.json).includes('compare databases'));
});

test('hyperfocus phrases and the researchDepth preference select the mode', () => {
  const root = tmpDataRoot();
  runHook('prompt', root, promptInput({ prompt: 'please do deep research on caching' }));
  assert.equal(readSession(root, 'sess-test-1').mode, 'hyperfocus');
  fs.writeFileSync(path.join(root, 'preferences.json'), JSON.stringify({ researchDepth: 'hyperfocus' }));
  runHook('prompt', root, promptInput({ sessionId: 'sess-test-2', prompt: 'plain request' }));
  const record = readSession(root, 'sess-test-2');
  assert.equal(record.mode, 'hyperfocus');
  assert.equal(record.preferencesSnapshot.researchDepth, 'hyperfocus');
});

test('machine-injected prompts are never captured but keep the protocol visible', () => {
  const root = tmpDataRoot();
  const idle = runHook('prompt', root, promptInput({ prompt: 'wake up', source: 'schedule_wakeup' }));
  assert.equal(idle.stdout, '');
  assert.equal(fs.existsSync(sessionFilePath(root, 'sess-test-1')), false);
  runHook('prompt', root, promptInput({ prompt: 'real task' }));
  const wake = runHook('prompt', root, promptInput({ prompt: 'background task finished', source: 'system' }));
  assert.ok(ctx(wake.json).includes('injected by the system'));
  assert.equal(readSession(root, 'sess-test-1').userTurns.length, 0);
});

test('a background task notification delivered with source "user" is not captured and keeps the receipt fresh', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  runHook('prompt', root, promptInput({ prompt: 'Create a file named smoke.txt containing exactly the line: hello adhd', cwd }));
  const before = readSession(root, 'sess-test-1');
  assert.equal(runState(root, 'audit-record', { args: ['--session', 'sess-test-1'], input: passingReceipt(before) }).json.accepted, true);
  const notice = runHook('prompt', root, promptInput({ prompt: TASK_NOTIFICATION, source: 'user', cwd }));
  assert.equal(notice.status, 0);
  assert.ok(ctx(notice.json).includes('injected by the system'));
  assert.equal(ctx(notice.json).includes('TASK LOCK\nGoal:'), false);
  const after = readSession(root, 'sess-test-1');
  assert.equal(after.userTurns.length, 0);
  assert.equal(after.contractVersion, before.contractVersion);
  assert.equal(after.audit.nonce, before.audit.nonce);
  assert.equal(after.phase, 'ACTIVE');
  const stop = runHook('stop', root, stopInput({ cwd, lastAssistantMessage: 'Done.' }));
  assert.equal(stop.json.decision, undefined);
  assert.match(stop.json.systemMessage, /COMPLETE/);
  assert.equal(readSession(root, 'sess-test-1').phase, 'COMPLETE');
});

test('a machine-source prompt that reads "stop" or "/adhd:cancel" neither cancels nor controls the task', () => {
  const root = tmpDataRoot();
  runHook('prompt', root, promptInput({ prompt: 'real task' }));
  const before = readSession(root, 'sess-test-1');
  const wake = runHook('prompt', root, promptInput({ prompt: 'stop', source: 'loop_wakeup' }));
  assert.ok(ctx(wake.json).includes('injected by the system'));
  const cron = runHook('prompt', root, promptInput({ prompt: '/adhd:cancel', source: 'schedule_wakeup' }));
  assert.ok(ctx(cron.json).includes('injected by the system'));
  assert.equal(ctx(cron.json).includes('CANCELLED'), false);
  const record = readSession(root, 'sess-test-1');
  assert.deepEqual([record.phase, record.userTurns.length, record.contractVersion, record.audit.nonce], ['ACTIVE', 0, before.contractVersion, before.audit.nonce]);
  const idle = tmpDataRoot();
  assert.equal(runHook('prompt', idle, promptInput({ prompt: TASK_NOTIFICATION, source: 'user' })).stdout, '');
  assert.equal(fs.existsSync(sessionFilePath(idle, 'sess-test-1')), false);
});

test('whitespace-only prompts, malformed input, and invalid session ids are ignored without output', () => {
  const root = tmpDataRoot();
  assert.equal(runHook('prompt', root, promptInput({ prompt: '   \n ' })).stdout, '');
  assert.equal(fs.existsSync(sessionFilePath(root, 'sess-test-1')), false);
  const malformed = runHook('prompt', root, '{not json');
  assert.equal(malformed.status, 0);
  assert.equal(malformed.stdout, '');
  const invalid = runHook('prompt', root, promptInput({ sessionId: '../escape', prompt: 'x' }));
  assert.equal(invalid.status, 0);
  assert.equal(invalid.stdout, '');
  assert.equal(fs.existsSync(path.join(root, 'diagnostics', 'unattributed.jsonl')), true);
  const missingPrompt = runHook('prompt', root, { session_id: 'abc', cwd: '/tmp', hook_event_name: 'UserPromptSubmit' });
  assert.equal(missingPrompt.stdout, '');
});

test('a relative cwd and a missing cwd still produce a usable record', () => {
  const root = tmpDataRoot();
  const relative = runHook('prompt', root, promptInput({ prompt: 'x', cwd: '.' }));
  assert.equal(relative.status, 0);
  assert.equal(path.isAbsolute(readSession(root, 'sess-test-1').cwd.replace(/^([a-z]):/, '$1:')), true);
  const input = promptInput({ sessionId: 'sess-test-2', prompt: 'y' });
  delete input.cwd;
  assert.equal(runHook('prompt', root, input).status, 0);
  assert.equal(typeof readSession(root, 'sess-test-2').cwd, 'string');
});

test('corrupt state is quarantined and the prompt still starts a fresh task', () => {
  const root = tmpDataRoot();
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  fs.writeFileSync(sessionFilePath(root, 'sess-test-1'), '{corrupt');
  const result = runHook('prompt', root, promptInput({ prompt: 'recover me' }));
  assert.ok(ctx(result.json).includes('TASK LOCK'));
  assert.equal(readSession(root, 'sess-test-1').originalRequest.text, 'recover me');
  assert.ok(fs.readdirSync(path.join(root, 'diagnostics')).some((n) => n.startsWith('quarantine-')));
});

test('a prompt beyond the 2 MiB record cap degrades verification instead of corrupting state', () => {
  const root = tmpDataRoot();
  runHook('prompt', root, promptInput({ prompt: 'small task' }));
  const huge = runHook('prompt', root, promptInput({ prompt: 'x'.repeat(2 * 1024 * 1024 + 10) }));
  assert.ok(ctx(huge.json).includes('ADHD DEGRADED STOP REPORT'));
  const record = readSession(root, 'sess-test-1');
  assert.equal(record.phase, 'DEGRADED_REPORT_REQUIRED');
  assert.equal(record.originalRequest.text, 'small task');
  assert.equal(record.userTurns.length, 0);
  const fresh = tmpDataRoot();
  const first = runHook('prompt', fresh, promptInput({ prompt: 'y'.repeat(2 * 1024 * 1024 + 10) }));
  assert.ok(ctx(first.json).includes('ADHD DEGRADED STOP REPORT'));
  assert.equal(readSession(fresh, 'sess-test-1').phase, 'DEGRADED_REPORT_REQUIRED');
});

test('the hook works with no HOME in the environment when --data is given', () => {
  const root = tmpDataRoot();
  const result = runScript(SCRIPTS.prompt, { input: promptInput({ prompt: 'no home' }), args: ['--data', root], env: { HOME: '', USERPROFILE: '' } });
  assert.equal(result.status, 0);
  assert.ok(ctx(result.json).includes('TASK LOCK'));
  assert.equal(readSession(root, 'sess-test-1').originalRequest.text, 'no home');
});
