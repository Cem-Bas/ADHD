// tests/unit/lock.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpDataRoot } from '../helpers.mjs';
import { acquireLock, withLock, lockIsStale, LOCK_STALE_MS, inspectLockDir, recoverStaleLock, readOwner, releaseLock } from '../../scripts/common/lock.mjs';

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'hold-lock.mjs');

test('second acquisition waits and times out while the lock is held', () => {
  const dir = path.join(tmpDataRoot(), 'sessions', 's.lock');
  const lock = acquireLock(dir);
  const started = Date.now();
  assert.throws(() => acquireLock(dir, { timeoutMs: 150, pollMs: 5 }), /LOCK_TIMEOUT|could not acquire/);
  assert.ok(Date.now() - started >= 140);
  lock.release();
  const again = acquireLock(dir, { timeoutMs: 100 });
  again.release();
  assert.equal(fs.existsSync(dir), false);
});

test('withLock releases even when the callback throws', () => {
  const dir = path.join(tmpDataRoot(), 'sessions', 's.lock');
  assert.throws(() => withLock(dir, () => { throw new Error('boom'); }), /boom/);
  assert.equal(fs.existsSync(dir), false);
});

test('a lock left by a dead process on this host is recovered into diagnostics', () => {
  const root = tmpDataRoot();
  const dir = path.join(root, 'sessions', 's.lock');
  const child = spawnSync(process.execPath, [fixture, dir], { encoding: 'utf8' });
  assert.equal(child.stdout.trim(), 'held');
  assert.equal(fs.existsSync(dir), true);
  const lock = acquireLock(dir, { timeoutMs: 500, diagnosticsDir: path.join(root, 'diagnostics') });
  assert.equal(lock.recoveredStale, true);
  lock.release();
  const moved = fs.readdirSync(path.join(root, 'diagnostics')).filter((n) => n.startsWith('stale-s.lock'));
  assert.equal(moved.length, 1);
});

test('lockIsStale follows the spec rules', () => {
  const now = Date.now();
  const host = os.hostname();
  const fresh = { pid: process.pid, hostname: host, acquiredAt: new Date(now - 1000).toISOString() };
  assert.equal(lockIsStale(fresh, { now, hostname: host, isAlive: () => true }), false);
  assert.equal(lockIsStale(fresh, { now, hostname: host, isAlive: () => false }), true);
  const old = { pid: 1, hostname: 'elsewhere', acquiredAt: new Date(now - LOCK_STALE_MS - 1).toISOString() };
  assert.equal(lockIsStale(old, { now, hostname: host, isAlive: () => true }), true);
  const otherHostRecent = { pid: 1, hostname: 'elsewhere', acquiredAt: new Date(now - 1000).toISOString() };
  assert.equal(lockIsStale(otherHostRecent, { now, hostname: host, isAlive: () => true }), false);
  const aliveButOld = { pid: process.pid, hostname: host, acquiredAt: new Date(now - LOCK_STALE_MS - 1).toISOString() };
  assert.equal(lockIsStale(aliveButOld, { now, hostname: host, isAlive: () => true }), false);
  assert.equal(lockIsStale(null, { now }), true);
  assert.equal(lockIsStale({ pid: 1, hostname: 'elsewhere', acquiredAt: 'garbage' }, { now, hostname: host, isAlive: () => true }), true);
});

test('a recovery based on stale information cannot steal a lock that a live process re-acquired', () => {
  const root = tmpDataRoot();
  const dir = path.join(root, 'sessions', 's.lock');
  const diagnostics = path.join(root, 'diagnostics');
  spawnSync(process.execPath, [fixture, dir], { encoding: 'utf8' });
  const judged = inspectLockDir(dir);
  assert.equal(judged.stale, true);
  assert.notEqual(judged.owner, null);
  const live = acquireLock(dir, { timeoutMs: 500, diagnosticsDir: diagnostics });
  assert.equal(live.recoveredStale, true);
  assert.deepEqual(recoverStaleLock(dir, diagnostics, judged.owner), { recovered: false, error: null });
  assert.equal(readOwner(dir).pid, process.pid);
  live.verify();
  live.release();
  assert.equal(fs.existsSync(dir), false);
  assert.equal(fs.readdirSync(diagnostics).filter((name) => name.startsWith('stale-s.lock')).length, 1);
});

test('release never removes a lock now owned by someone else, and verify reports the loss', () => {
  const dir = path.join(tmpDataRoot(), 'sessions', 's.lock');
  const lock = acquireLock(dir);
  fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: 999999, hostname: os.hostname(), fingerprint: 'other', acquiredAt: new Date().toISOString() }));
  assert.throws(() => lock.verify(), /LOCK_LOST|no longer held/);
  lock.release();
  assert.equal(fs.existsSync(dir), true);
  releaseLock(dir);
  assert.equal(fs.existsSync(dir), false);
});

test('recovering a lock that is already gone is not an error, and recoveredStale is only reported for a real recovery', () => {
  const root = tmpDataRoot();
  const dir = path.join(root, 'sessions', 's.lock');
  assert.deepEqual(recoverStaleLock(dir, path.join(root, 'diagnostics'), null), { recovered: false, error: null });
  const lock = acquireLock(dir);
  assert.equal(lock.recoveredStale, false);
  assert.deepEqual(recoverStaleLock(dir, path.join(root, 'diagnostics'), { pid: 1, hostname: 'x', fingerprint: 'y', acquiredAt: 'z' }), { recovered: false, error: null });
  assert.equal(readOwner(dir).pid, process.pid);
  lock.release();
});

test('withLock hands the handle to the callback', () => {
  const dir = path.join(tmpDataRoot(), 'sessions', 's.lock');
  const result = withLock(dir, (lock) => {
    lock.verify();
    return lock.owner.pid;
  });
  assert.equal(result, process.pid);
  assert.equal(fs.existsSync(dir), false);
});
