import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpDataRoot, tmpProjectDir, runHook, promptInput, stopInput, toolInput, sessionStartInput, readSession } from '../helpers.mjs';
import { acquireLock } from '../../scripts/common/lock.mjs';

const holdLock = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'hold-lock.mjs');

test('a lock held by a live process degrades the Stop hook visibly and never traps the session', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  runHook('prompt', root, promptInput({ prompt: 'work', cwd }));
  const lock = acquireLock(path.join(root, 'sessions', 'sess-test-1.lock'));
  try {
    const stop = runHook('stop', root, stopInput({ cwd }));
    assert.equal(stop.status, 0);
    assert.equal(stop.json.decision, undefined);
    assert.match(stop.json.systemMessage, /DEGRADED/);
    assert.match(stop.json.systemMessage, /LOCK_TIMEOUT/);
    const prompt = runHook('prompt', root, promptInput({ prompt: 'another', cwd }));
    assert.deepEqual([prompt.status, prompt.stdout], [0, '']);
    assert.match(prompt.stderr, /LOCK_TIMEOUT/);
  } finally {
    lock.release();
  }
  const diagnostics = fs.readFileSync(path.join(root, 'diagnostics', 'sess-test-1.jsonl'), 'utf8');
  assert.ok(diagnostics.split('\n').filter((line) => line.includes('LOCK_TIMEOUT')).length >= 2);
  assert.equal(readSession(root, 'sess-test-1').userTurns.length, 0);
});

test('a lock left by a dead process is recovered by the next hook', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  runHook('prompt', root, promptInput({ prompt: 'work', cwd }));
  spawnSync(process.execPath, [holdLock, path.join(root, 'sessions', 'sess-test-1.lock')], { encoding: 'utf8' });
  const result = runHook('prompt', root, promptInput({ prompt: 'after crash', cwd }));
  assert.equal(result.status, 0);
  assert.equal(readSession(root, 'sess-test-1').userTurns.length, 1);
  assert.ok(fs.readdirSync(path.join(root, 'diagnostics')).some((name) => name.startsWith('stale-sess-test-1.lock')));
});

test('every hook survives garbage on stdin without output', () => {
  const root = tmpDataRoot();
  for (const kind of ['prompt', 'restore', 'evidence', 'stop']) {
    for (const input of ['', '[]', '"string"', '42', 'null', '{"session_id":"ok"}']) {
      const result = runHook(kind, root, input);
      assert.deepEqual([kind, input, result.status, result.stdout], [kind, input, 0, '']);
    }
  }
});

test('fault paths end in DEGRADED_STOP or CANCELLED, never COMPLETE', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  const finals = [];
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sessions', 'corrupt-stop.json'), '{');
  runHook('stop', root, stopInput({ sessionId: 'corrupt-stop', cwd }));
  runHook('stop', root, stopInput({ sessionId: 'corrupt-stop', cwd, stopHookActive: true, lastAssistantMessage: 'no report' }));
  finals.push(readSession(root, 'corrupt-stop').phase);
  runHook('prompt', root, promptInput({ sessionId: 'too-big', prompt: 'x'.repeat(2 * 1024 * 1024 + 1), cwd }));
  runHook('stop', root, stopInput({ sessionId: 'too-big', cwd }));
  finals.push(readSession(root, 'too-big').phase);
  runHook('prompt', root, promptInput({ sessionId: 'no-report', prompt: 'work', cwd }));
  for (let i = 0; i < 7; i += 1) runHook('stop', root, stopInput({ sessionId: 'no-report', cwd, stopHookActive: i > 0 }));
  runHook('stop', root, stopInput({ sessionId: 'no-report', cwd, stopHookActive: true, lastAssistantMessage: 'I am done, everything is complete.' }));
  finals.push(readSession(root, 'no-report').phase);
  runHook('prompt', root, promptInput({ sessionId: 'cancelled', prompt: 'work', cwd }));
  runHook('prompt', root, promptInput({ sessionId: 'cancelled', prompt: 'stop', cwd }));
  finals.push(readSession(root, 'cancelled').phase);
  assert.deepEqual(finals, ['DEGRADED_STOP', 'DEGRADED_STOP', 'DEGRADED_STOP', 'CANCELLED']);
  const clearing = runHook('restore', root, sessionStartInput({ sessionId: 'cancelled', source: 'clear' }));
  assert.equal(clearing.stdout, '');
});

test('an evidence event that would overflow the record is dropped with a diagnostic, not a crash', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  runHook('prompt', root, promptInput({ prompt: 'work', cwd }));
  const record = readSession(root, 'sess-test-1');
  record.originalRequest.text = 'y'.repeat(2 * 1024 * 1024 - 500);
  fs.writeFileSync(path.join(root, 'sessions', 'sess-test-1.json'), JSON.stringify(record));
  const result = runHook('evidence', root, toolInput({ cwd, toolName: 'Bash', toolInputValue: { command: 'echo' }, toolResponse: { stdout: 'z'.repeat(5000) }, toolUseId: 'u-big' }));
  assert.deepEqual([result.status, result.stdout], [0, '']);
  assert.match(fs.readFileSync(path.join(root, 'diagnostics', 'sess-test-1.jsonl'), 'utf8'), /EVIDENCE_DROPPED/);
  assert.equal(readSession(root, 'sess-test-1').evidence.toolEvents.length, 0);
});
