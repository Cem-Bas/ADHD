import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { tmpDataRoot, tmpProjectDir, runHook, promptInput, toolInput, readSession, SCRIPTS } from '../helpers.mjs';
import { validateSessionRecord } from '../../scripts/common/schema.mjs';

function spawnHook(kind, root, input, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPTS[kind], '--data', root], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ADHD_LOCK_TIMEOUT_MS: '10000', ...extraEnv } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

test('two sessions in the same directory never touch each other', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  runHook('prompt', root, promptInput({ sessionId: 'sess-a', prompt: 'task A', cwd }));
  runHook('prompt', root, promptInput({ sessionId: 'sess-b', prompt: 'task B', cwd }));
  runHook('prompt', root, promptInput({ sessionId: 'sess-a', prompt: 'A amendment', cwd }));
  runHook('prompt', root, promptInput({ sessionId: 'sess-b', prompt: 'cancel', cwd }));
  const a = readSession(root, 'sess-a');
  const b = readSession(root, 'sess-b');
  assert.deepEqual([a.phase, a.userTurns.length, a.originalRequest.text], ['ACTIVE', 1, 'task A']);
  assert.deepEqual([b.phase, b.userTurns.length, b.originalRequest.text], ['CANCELLED', 0, 'task B']);
});

test('eight concurrent prompt hooks for one session serialise through the lock without losing a turn', async () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  runHook('prompt', root, promptInput({ prompt: 'start', cwd }));
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => spawnHook('prompt', root, promptInput({ prompt: `turn ${i}`, cwd }))));
  assert.ok(results.every((result) => result.status === 0 && result.stderr === ''), JSON.stringify(results.map((r) => r.stderr)));
  const record = readSession(root, 'sess-test-1');
  assert.deepEqual(record.userTurns.map((turn) => turn.sequence), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...record.userTurns.map((turn) => turn.text)].sort(), Array.from({ length: 8 }, (_, i) => `turn ${i}`).sort());
  assert.equal(record.contractVersion, 9);
  assert.equal(validateSessionRecord(record).ok, true);
});

test('concurrent evidence and prompt hooks keep the record valid', async () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  runHook('prompt', root, promptInput({ prompt: 'start', cwd }));
  const jobs = [
    ...Array.from({ length: 4 }, (_, i) => spawnHook('evidence', root, toolInput({ cwd, toolUseId: `u${i}`, toolName: 'Bash', toolInputValue: { command: `echo ${i}` }, toolResponse: { stdout: String(i), exitCode: 0 } }))),
    spawnHook('prompt', root, promptInput({ prompt: 'one', cwd })),
    spawnHook('prompt', root, promptInput({ prompt: 'two', cwd })),
  ];
  const results = await Promise.all(jobs);
  assert.ok(results.every((result) => result.status === 0));
  const record = readSession(root, 'sess-test-1');
  assert.equal(record.evidence.toolEvents.length, 4);
  assert.equal(record.userTurns.length, 2);
  assert.equal(validateSessionRecord(record).ok, true);
});

test('the lock timeout honours ADHD_LOCK_TIMEOUT_MS', async () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  runHook('prompt', root, promptInput({ prompt: 'start', cwd }));
  const { acquireLock } = await import('../../scripts/common/lock.mjs');
  const lock = acquireLock(path.join(root, 'sessions', 'sess-test-1.lock'));
  try {
    const started = Date.now();
    const result = await spawnHook('prompt', root, promptInput({ prompt: 'blocked', cwd }), { ADHD_LOCK_TIMEOUT_MS: '300' });
    assert.equal(result.status, 0);
    assert.match(result.stderr, /LOCK_TIMEOUT/);
    assert.ok(Date.now() - started < 2000, 'a 300 ms override must not wait the default 2 s');
  } finally {
    lock.release();
  }
});
