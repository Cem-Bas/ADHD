import fs from 'node:fs';
import path from 'node:path';
import { dataPaths } from './paths.mjs';
import { listFiles, readJsonFile, removeQuietly } from './fsx.mjs';
import { isTerminalPhase, isOpenPhase } from './schema.mjs';

export const DIAGNOSTICS_RETENTION_DAYS = 14;
export const ABANDONED_OPEN_DAYS = 90;
const TEMP_FILE_GRACE_MS = 60 * 60 * 1000;

export function cleanupExpired(root, { now = Date.now() } = {}) {
  const paths = dataPaths(root);
  const result = { removedSessions: 0, removedArchives: 0, removedDiagnostics: 0 };
  for (const name of listFiles(paths.sessions)) {
    const full = path.join(paths.sessions, name);
    if (name.endsWith('.json')) {
      const loaded = readJsonFile(full);
      if (loaded.status !== 'ok' || !loaded.value || typeof loaded.value !== 'object') continue;
      const record = loaded.value;
      const archived = name.split('.').length > 2;
      const expired = Date.parse(record.expiresAt) <= now;
      const abandoned = !archived && isOpenPhase(record.phase) && now - Date.parse(record.updatedAt) > ABANDONED_OPEN_DAYS * 86_400_000;
      if ((expired && (archived || isTerminalPhase(record.phase) || record.phase === 'IDLE')) || abandoned) {
        if (removeQuietly(full)) result[archived ? 'removedArchives' : 'removedSessions'] += 1;
      }
    } else if (name.includes('.tmp-')) {
      try {
        if (now - fs.statSync(full).mtimeMs > TEMP_FILE_GRACE_MS) removeQuietly(full);
      } catch {
        // already gone
      }
    }
  }
  const cutoff = now - DIAGNOSTICS_RETENTION_DAYS * 86_400_000;
  for (const name of listFiles(paths.diagnostics)) {
    const full = path.join(paths.diagnostics, name);
    try {
      if (fs.statSync(full).mtimeMs < cutoff && removeQuietly(full)) result.removedDiagnostics += 1;
    } catch {
      // already gone
    }
  }
  return result;
}
