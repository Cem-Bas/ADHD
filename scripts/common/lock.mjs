import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AdhdError } from './errors.mjs';

export const LOCK_STALE_MS = 5 * 60 * 1000;
const OWNERLESS_GRACE_MS = 10_000;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function ownerInfo() {
  const startedAt = Math.round(Date.now() - process.uptime() * 1000);
  return { pid: process.pid, hostname: os.hostname(), fingerprint: `${process.pid}:${startedAt}`, acquiredAt: new Date().toISOString() };
}

export function lockIsStale(owner, { now = Date.now(), hostname = os.hostname(), isAlive = pidAlive } = {}) {
  if (!owner || typeof owner !== 'object') return true;
  const sameHost = owner.hostname === hostname;
  const age = now - Date.parse(owner.acquiredAt || 0);
  const alive = sameHost ? isAlive(owner.pid) : null;
  if (sameHost && alive === false) return true;
  if (age > LOCK_STALE_MS && !sameHost) return true;
  return false;
}

export function isStaleLockDir(lockDir, opts = {}) {
  let owner;
  try {
    owner = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'));
  } catch {
    try {
      return Date.now() - fs.statSync(lockDir).mtimeMs > OWNERLESS_GRACE_MS;
    } catch {
      return false;
    }
  }
  return lockIsStale(owner, opts);
}

export function recoverStaleLock(lockDir, diagnosticsDir) {
  const targetDir = diagnosticsDir || path.dirname(lockDir);
  const dest = path.join(targetDir, `stale-${path.basename(lockDir)}-${Date.now()}-${process.pid}`);
  try {
    fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
    fs.renameSync(lockDir, dest);
  } catch {
    // another process recovered it first
  }
}

export function acquireLock(lockDir, { timeoutMs = 2000, pollMs = 5, diagnosticsDir = null } = {}) {
  const deadline = Date.now() + timeoutMs;
  let recoveredStale = false;
  fs.mkdirSync(path.dirname(lockDir), { recursive: true, mode: 0o700 });
  for (;;) {
    try {
      fs.mkdirSync(lockDir, { mode: 0o700 });
      fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify(ownerInfo()), { mode: 0o600 });
      return { release: () => releaseLock(lockDir), recoveredStale };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    if (isStaleLockDir(lockDir)) {
      recoverStaleLock(lockDir, diagnosticsDir);
      recoveredStale = true;
      continue;
    }
    if (Date.now() >= deadline) {
      throw new AdhdError('LOCK_TIMEOUT', `could not acquire ${path.basename(lockDir)} within ${timeoutMs} ms`);
    }
    sleepSync(pollMs);
  }
}

export function releaseLock(lockDir) {
  fs.rmSync(lockDir, { recursive: true, force: true });
}

export function withLock(lockDir, fn, opts) {
  const lock = acquireLock(lockDir, opts);
  try {
    return fn();
  } finally {
    lock.release();
  }
}
