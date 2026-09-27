import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function ensureDir(dir, mode = 0o700) {
  fs.mkdirSync(dir, { recursive: true, mode });
}

export function writeFileAtomic(filePath, data, { mode = 0o600 } = {}) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, data, { mode });
  try {
    fs.chmodSync(tmp, mode);
  } catch {
    // platform without POSIX modes
  }
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.renameSync(tmp, filePath);
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) break;
      sleepSync(10 * (attempt + 1));
    }
  }
  try {
    fs.unlinkSync(tmp);
  } catch {
    // nothing to clean
  }
  throw lastError;
}

export function readJsonFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'missing' };
    throw error;
  }
  try {
    return { status: 'ok', value: JSON.parse(raw) };
  } catch (error) {
    return { status: 'corrupt', error: error.message, raw };
  }
}

export function appendLine(filePath, line, { mode = 0o600 } = {}) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${String(line).replace(/\r?\n/g, ' ')}\n`, { mode });
}

export function listFiles(dir) {
  try {
    return fs.readdirSync(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export function removeQuietly(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export function fileExists(target) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

export function quarantine(root, filePath, reason) {
  const dir = path.join(root, 'diagnostics');
  ensureDir(dir);
  const dest = path.join(dir, `quarantine-${Date.now()}-${path.basename(filePath)}`);
  try {
    fs.renameSync(filePath, dest);
  } catch {
    return null;
  }
  appendLine(path.join(dir, 'quarantine.jsonl'), JSON.stringify({ at: new Date().toISOString(), file: path.basename(filePath), reason: String(reason).slice(0, 300) }));
  return dest;
}
