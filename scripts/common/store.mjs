import path from 'node:path';
import { readJsonFile, writeFileAtomic, ensureDir, quarantine, listFiles } from './fsx.mjs';
import { sessionFile, archivedTaskFile, lockDirFor, dataPaths, validateSessionId, normalizeCwd } from './paths.mjs';
import { validateSessionRecord, migrateSessionRecord, newSessionRecord, MAX_SESSION_BYTES, isOpenPhase } from './schema.mjs';
import { withLock } from './lock.mjs';
import { AdhdError } from './errors.mjs';

export function loadSession(root, sessionId) {
  const file = sessionFile(root, sessionId);
  const result = readJsonFile(file);
  if (result.status === 'missing') return { status: 'missing', file };
  if (result.status === 'corrupt') return { status: 'corrupt', file, quarantined: quarantine(root, file, `unparseable JSON: ${result.error}`) };
  const migrated = migrateSessionRecord(result.value);
  if (!migrated.ok) return { status: 'corrupt', file, quarantined: quarantine(root, file, migrated.error) };
  const validated = validateSessionRecord(migrated.record);
  if (!validated.ok) return { status: 'corrupt', file, quarantined: quarantine(root, file, `schema: ${validated.errors.slice(0, 5).join('; ')}`) };
  return { status: 'ok', file, record: migrated.record };
}

export function serializeSession(record) {
  return JSON.stringify(record);
}

export function saveSession(root, record) {
  const validated = validateSessionRecord(record);
  if (!validated.ok) throw new AdhdError('SCHEMA_INVALID', validated.errors.join('; '), { errors: validated.errors });
  const data = serializeSession(record);
  if (Buffer.byteLength(data, 'utf8') > MAX_SESSION_BYTES) throw new AdhdError('STATE_TOO_LARGE', `session record exceeds ${MAX_SESSION_BYTES} bytes`);
  writeFileAtomic(sessionFile(root, record.sessionId), data);
}

function defaultLockTimeoutMs() {
  const configured = Number(process.env.ADHD_LOCK_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 2000;
}

export function mutateSession(root, sessionId, fn, { create = null, now = Date.now(), lockTimeoutMs = defaultLockTimeoutMs() } = {}) {
  validateSessionId(sessionId);
  const paths = dataPaths(root);
  ensureDir(paths.sessions);
  ensureDir(paths.diagnostics);
  return withLock(lockDirFor(root, sessionId), (lock) => {
    const loaded = loadSession(root, sessionId);
    let record;
    if (loaded.status === 'ok') record = loaded.record;
    else if (create) record = newSessionRecord({ sessionId, now, ...create });
    else return { status: loaded.status, quarantined: loaded.quarantined ?? null, loaded: loaded.status };
    const outcome = fn(record, { status: loaded.status }) || {};
    const next = outcome.record || record;
    if (outcome.skipSave) return { status: 'ok', record: next, result: outcome.result, loaded: loaded.status };
    next.updatedAt = new Date(now).toISOString();
    lock.verify();
    saveSession(root, next);
    return { status: 'ok', record: next, result: outcome.result, loaded: loaded.status };
  }, { timeoutMs: lockTimeoutMs, diagnosticsDir: paths.diagnostics });
}

export function archiveTask(root, record) {
  if (!record.taskId) return null;
  const file = archivedTaskFile(root, record.sessionId, record.taskId);
  writeFileAtomic(file, serializeSession(record));
  return file;
}

export function listSessionRecords(root) {
  const dir = dataPaths(root).sessions;
  const out = [];
  for (const name of listFiles(dir)) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    let result;
    try {
      result = readJsonFile(file);
    } catch {
      continue;
    }
    if (result.status === 'ok' && result.value && typeof result.value === 'object') out.push({ file, record: result.value, archived: name.split('.').length > 2 });
  }
  return out;
}

export function findOpenSessionsForCwd(root, cwd) {
  const target = normalizeCwd(cwd);
  return listSessionRecords(root)
    .filter((entry) => !entry.archived && entry.record.cwd === target && isOpenPhase(entry.record.phase))
    .sort((a, b) => Date.parse(b.record.updatedAt) - Date.parse(a.record.updatedAt))
    .map((entry) => entry.record);
}
