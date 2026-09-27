import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
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
  return { pid: process.pid, hostname: os.hostname(), fingerprint: `${process.pid}:${startedAt}:${randomBytes(4).toString('hex')}`, acquiredAt: new Date().toISOString() };
}

export function readOwner(lockDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function sameOwner(a, b) {
  return Boolean(a && b) && a.pid === b.pid && a.hostname === b.hostname && a.fingerprint === b.fingerprint && a.acquiredAt === b.acquiredAt;
}

export function lockIsStale(owner, { now = Date.now(), hostname = os.hostname(), isAlive = pidAlive } = {}) {
  if (!owner || typeof owner !== 'object') return true;
  const sameHost = owner.hostname === hostname;
  const acquired = Date.parse(owner.acquiredAt);
  const age = Number.isNaN(acquired) ? Infinity : now - acquired;
  const alive = sameHost ? isAlive(owner.pid) : null;
  if (sameHost && alive === false) return true;
  if (!sameHost && age > LOCK_STALE_MS) return true;
  return false;
}

export function inspectLockDir(lockDir, opts = {}) {
  const owner = readOwner(lockDir);
  if (owner === null) {
    try {
      return { stale: Date.now() - fs.statSync(lockDir).mtimeMs > OWNERLESS_GRACE_MS, owner: null };
    } catch {
      return { stale: false, owner: null };
    }
  }
  return { stale: lockIsStale(owner, opts), owner };
}

export function isStaleLockDir(lockDir, opts = {}) {
  return inspectLockDir(lockDir, opts).stale;
}

export function recoverStaleLock(lockDir, diagnosticsDir, expectedOwner = null) {
  const matches = (owner) => (expectedOwner === null ? owner === null : sameOwner(owner, expectedOwner));
  if (!matches(readOwner(lockDir))) return { recovered: false, error: null };
  const targetDir = diagnosticsDir || path.dirname(lockDir);
  const dest = path.join(targetDir, `stale-${path.basename(lockDir)}-${Date.now()}-${process.pid}-${randomBytes(3).toString('hex')}`);
  try {
    fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
    fs.renameSync(lockDir, dest);
  } catch (error) {
    return { recovered: false, error: error.code === 'ENOENT' ? null : error };
  }
  if (!matches(readOwner(dest))) {
    try {
      fs.renameSync(dest, lockDir);
    } catch {
      // lockDir was re-created in between; the displaced holder detects the loss through verify()
    }
    return { recovered: false, error: null };
  }
  return { recovered: true, error: null };
}

function createHandle(lockDir, owner, recoveredStale) {
  const owned = () => sameOwner(readOwner(lockDir), owner);
  return {
    owner,
    recoveredStale,
    verify() {
      if (!owned()) throw new AdhdError('LOCK_LOST', `lock ${path.basename(lockDir)} is no longer held by this process`);
    },
    release() {
      if (owned()) fs.rmSync(lockDir, { recursive: true, force: true });
    },
  };
}

export function acquireLock(lockDir, { timeoutMs = 2000, pollMs = 5, diagnosticsDir = null } = {}) {
  const deadline = Date.now() + timeoutMs;
  let recoveredStale = false;
  let lastRecoveryError = null;
  fs.mkdirSync(path.dirname(lockDir), { recursive: true, mode: 0o700 });
  for (;;) {
    try {
      fs.mkdirSync(lockDir, { mode: 0o700 });
      const owner = ownerInfo();
      fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify(owner), { mode: 0o600 });
      return createHandle(lockDir, owner, recoveredStale);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const inspection = inspectLockDir(lockDir);
    if (inspection.stale) {
      const result = recoverStaleLock(lockDir, diagnosticsDir, inspection.owner);
      if (result.error) lastRecoveryError = result.error;
      if (result.recovered) {
        recoveredStale = true;
        continue;
      }
    }
    if (Date.now() >= deadline) {
      const detail = lastRecoveryError ? ` (stale recovery failed: ${lastRecoveryError.code || lastRecoveryError.message})` : '';
      throw new AdhdError('LOCK_TIMEOUT', `could not acquire ${path.basename(lockDir)} within ${timeoutMs} ms${detail}`, { lastRecoveryError: lastRecoveryError ? String(lastRecoveryError.code || lastRecoveryError.message) : null });
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
    return fn(lock);
  } finally {
    lock.release();
  }
}
