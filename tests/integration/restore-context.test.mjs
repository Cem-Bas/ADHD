import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDataRoot, runHook, promptInput, sessionStartInput, readSession, sessionFilePath, writeSession } from '../helpers.mjs';

const ctx = (json) => json.hookSpecificOutput.additionalContext;

test('resume and compact restore the verbatim ledger, mode, phase, gaps, and preferences', () => {
  const root = tmpDataRoot();
  runHook('prompt', root, promptInput({ prompt: 'original "request"\nline two' }));
  runHook('prompt', root, promptInput({ prompt: 'amendment one' }));
  const record = readSession(root, 'sess-test-1');
  record.repair.gaps = [{ code: 'ITEM_PARTIAL', itemId: 'R2', detail: 'tests missing' }];
  record.phase = 'REPAIR_2';
  record.repair.completed = 2;
  writeSession(root, record);
  for (const source of ['resume', 'compact']) {
    const result = runHook('restore', root, sessionStartInput({ source }));
    assert.equal(result.json.hookSpecificOutput.hookEventName, 'SessionStart');
    const text = ctx(result.json);
    assert.ok(text.includes(`restored after ${source}`));
    assert.ok(text.includes('original "request"\nline two'));
    assert.ok(text.includes('1. ['));
    assert.ok(text.includes('amendment one'));
    assert.ok(text.includes('phase REPAIR_2'));
    assert.ok(text.includes('ITEM_PARTIAL R2 — tests missing'));
    assert.ok(text.includes('Effective preferences:'));
    assert.ok(text.includes('Audit nonce:'));
  }
});

test('startup without state prints nothing and cleans up expired records', () => {
  const root = tmpDataRoot();
  runHook('prompt', root, promptInput({ sessionId: 'sess-old', prompt: 'old' }));
  const old = readSession(root, 'sess-old');
  old.phase = 'COMPLETE';
  old.closure = { reason: 'complete', at: '2020-01-01T00:00:00.000Z' };
  old.expiresAt = '2020-02-01T00:00:00.000Z';
  writeSession(root, old);
  const result = runHook('restore', root, sessionStartInput({ sessionId: 'sess-new', source: 'startup' }));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(fs.existsSync(sessionFilePath(root, 'sess-old')), false);
});

test('clear closes an open task as cleared; fork and finished tasks restore nothing', () => {
  const root = tmpDataRoot();
  runHook('prompt', root, promptInput({ prompt: 'in progress' }));
  assert.equal(runHook('restore', root, sessionStartInput({ source: 'fork' })).stdout, '');
  const cleared = runHook('restore', root, sessionStartInput({ source: 'clear' }));
  assert.equal(cleared.stdout, '');
  const record = readSession(root, 'sess-test-1');
  assert.deepEqual([record.phase, record.closure.reason], ['CANCELLED', 'cleared']);
  assert.equal(runHook('restore', root, sessionStartInput({ source: 'resume' })).stdout, '');
});

test('corrupt state is quarantined and Claude is told to confirm the request', () => {
  const root = tmpDataRoot();
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  fs.writeFileSync(sessionFilePath(root, 'sess-test-1'), 'garbage');
  const result = runHook('restore', root, sessionStartInput({ source: 'resume' }));
  assert.ok(ctx(result.json).includes('quarantined'));
  assert.equal(fs.existsSync(sessionFilePath(root, 'sess-test-1')), false);
});
