import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDataRoot, runHook, runState, promptInput, toolInput, subagentInput, readSession, sessionFilePath, passingReceipt } from '../helpers.mjs';

test('tool events are recorded with paths, urls, commands, and failures; nothing is printed', () => {
  const root = tmpDataRoot();
  runHook('prompt', root, promptInput({ prompt: 'work' }));
  const edit = runHook('evidence', root, toolInput({ toolName: 'Edit', toolInputValue: { file_path: 'src/a.js', old_string: 'a', new_string: 'b' }, toolResponse: 'ok', toolUseId: 'u-edit' }));
  assert.equal(edit.status, 0);
  assert.equal(edit.stdout, '');
  runHook('evidence', root, toolInput({ toolName: 'Bash', toolInputValue: { command: 'npm test' }, toolResponse: { stdout: 'ok', exitCode: 0 }, toolUseId: 'u-bash' }));
  runHook('evidence', root, toolInput({ toolName: 'WebFetch', toolInputValue: { url: 'https://example.org/doc' }, toolResponse: 'text', toolUseId: 'u-web' }));
  runHook('evidence', root, toolInput({ toolName: 'Write', toolInputValue: { file_path: 'x.md', content: 'c' }, failure: true, error: 'EACCES: permission denied', toolUseId: 'u-fail' }));
  const record = readSession(root, 'sess-test-1');
  assert.deepEqual(record.evidence.toolEvents.map((e) => [e.toolName, e.ok]), [['Edit', true], ['Bash', true], ['WebFetch', true], ['Write', false]]);
  assert.deepEqual(record.evidence.toolEvents[0].paths, ['src/a.js']);
  assert.deepEqual(record.evidence.toolEvents[2].urls, ['https://example.org/doc']);
  assert.equal(record.evidence.toolEvents[3].error, 'EACCES: permission denied');
  assert.deepEqual(record.evidence.commands.map((c) => [c.toolUseId, c.exitStatus, c.ok]), [['u-bash', 0, true]]);
});

test('uncaptured tools, subagent tool activity, and sessions without state are ignored', () => {
  const root = tmpDataRoot();
  assert.equal(runHook('evidence', root, toolInput({ toolName: 'Bash' })).stdout, '');
  assert.equal(fs.existsSync(sessionFilePath(root, 'sess-test-1')), false);
  runHook('prompt', root, promptInput({ prompt: 'work' }));
  runHook('evidence', root, toolInput({ toolName: 'Read', toolInputValue: { file_path: 'a' }, toolResponse: 'x', toolUseId: 'u-read' }));
  runHook('evidence', root, toolInput({ toolName: 'Bash', toolInputValue: { command: 'node state.mjs audit-record' }, toolResponse: 'ok', toolUseId: 'u-sub', agentId: 'agent-77' }));
  assert.equal(readSession(root, 'sess-test-1').evidence.toolEvents.length, 0);
});

// un-skipped in Task 13 when scripts/state.mjs exists
test.skip('mutating tool events stale a fresh receipt but Agent events and subagent tracking do not', () => {
  const root = tmpDataRoot();
  runHook('prompt', root, promptInput({ prompt: 'work' }));
  let record = readSession(root, 'sess-test-1');
  const accepted = runState(root, 'audit-record', { args: ['--session', 'sess-test-1'], input: passingReceipt(record) });
  assert.equal(accepted.json.accepted, true);
  runHook('evidence', root, toolInput({ toolName: 'Agent', toolInputValue: { subagent_type: 'adhd:contract-auditor', prompt: 'audit' }, toolResponse: 'done', toolUseId: 'u-agent' }));
  runHook('evidence', root, subagentInput({ event: 'SubagentStart', agentId: 'ag-1' }));
  runHook('evidence', root, subagentInput({ event: 'SubagentStop', agentId: 'ag-1' }));
  assert.equal(runState(root, 'status', { args: ['--session', 'sess-test-1'] }).json.audit.fresh, true);
  record = readSession(root, 'sess-test-1');
  assert.equal(record.evidence.agents.length, 1);
  assert.notEqual(record.evidence.agents[0].stoppedAt, null);
  runHook('evidence', root, toolInput({ toolName: 'Edit', toolInputValue: { file_path: 'a.js' }, toolResponse: 'ok', toolUseId: 'u-edit' }));
  const status = runState(root, 'status', { args: ['--session', 'sess-test-1'] }).json;
  assert.deepEqual([status.audit.fresh, status.audit.reason], [false, 'evidence']);
});

test('events for a finished task are ignored and the tool-event cap drops the oldest', () => {
  const root = tmpDataRoot();
  runHook('prompt', root, promptInput({ prompt: 'work' }));
  runHook('prompt', root, promptInput({ prompt: 'cancel' }));
  runHook('evidence', root, toolInput({ toolName: 'Bash', toolUseId: 'late' }));
  assert.equal(readSession(root, 'sess-test-1').evidence.toolEvents.length, 0);
  const busy = tmpDataRoot();
  runHook('prompt', busy, promptInput({ prompt: 'work' }));
  const record = readSession(busy, 'sess-test-1');
  record.evidence.toolEvents = Array.from({ length: 500 }, (_, i) => ({ toolUseId: `old${i}`, toolName: 'Bash', at: record.createdAt, ok: true, exitStatus: 0, error: null, command: 'x', paths: [], urls: [], agentType: null, description: null, output: { sha256: 'a'.repeat(64), bytes: 1, clipped: false, preview: 'x' } }));
  fs.writeFileSync(sessionFilePath(busy, 'sess-test-1'), JSON.stringify(record));
  runHook('evidence', busy, toolInput({ toolName: 'Bash', toolUseId: 'newest' }));
  const after = readSession(busy, 'sess-test-1');
  assert.equal(after.evidence.toolEvents.length, 500);
  assert.equal(after.evidence.toolEvents.at(-1).toolUseId, 'newest');
  assert.equal(after.evidence.dropped.toolEvents, 1);
});
