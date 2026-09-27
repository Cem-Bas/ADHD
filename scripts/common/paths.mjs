import os from 'node:os';
import path from 'node:path';
import { AdhdError } from './errors.mjs';
import { sha256Hex } from './ids.mjs';

export const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export const PLACEHOLDER_RE = /^\$\{[A-Z_]+\}$/;
const TASK_ID_RE = /^[a-z0-9]{1,32}$/;

export function validateSessionId(id) {
  if (typeof id !== 'string' || !SESSION_ID_RE.test(id)) {
    throw new AdhdError('INVALID_SESSION_ID', `session id must match ${SESSION_ID_RE.source}`);
  }
  return id;
}

export function resolveDataRoot({ flag, env = process.env, home = os.homedir() } = {}) {
  for (const candidate of [flag, env.CLAUDE_PLUGIN_DATA]) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed === '' || PLACEHOLDER_RE.test(trimmed)) continue;
    return path.resolve(trimmed);
  }
  return path.join(home, '.claude', 'plugins', 'data', 'adhd-local');
}

export function normalizeCwd(cwd) {
  let normalized = path.resolve(typeof cwd === 'string' && cwd.trim() !== '' ? cwd : '.').replace(/\\/g, '/');
  normalized = normalized.replace(/^([A-Za-z]):/, (match, drive) => `${drive.toLowerCase()}:`);
  if (normalized.length > 1) normalized = normalized.replace(/\/+$/, '');
  return normalized;
}

export function projectKey(cwd) {
  return `p${sha256Hex(normalizeCwd(cwd)).slice(0, 16)}`;
}

export function dataPaths(root) {
  return {
    root,
    preferences: path.join(root, 'preferences.json'),
    projects: path.join(root, 'projects'),
    sessions: path.join(root, 'sessions'),
    exports: path.join(root, 'exports'),
    diagnostics: path.join(root, 'diagnostics'),
  };
}

export function assertInside(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AdhdError('PATH_ESCAPE', 'path escapes the plugin data directory');
  }
  return resolved;
}

export function sessionFile(root, sessionId) {
  return assertInside(root, path.join(root, 'sessions', `${validateSessionId(sessionId)}.json`));
}

export function archivedTaskFile(root, sessionId, taskId) {
  if (!TASK_ID_RE.test(String(taskId))) throw new AdhdError('INVALID_TASK_ID', 'task id must be 1-32 lowercase alphanumerics');
  return assertInside(root, path.join(root, 'sessions', `${validateSessionId(sessionId)}.${taskId}.json`));
}

export function lockDirFor(root, sessionId) {
  return assertInside(root, path.join(root, 'sessions', `${validateSessionId(sessionId)}.lock`));
}

export function diagnosticsFile(root, sessionId) {
  return assertInside(root, path.join(root, 'diagnostics', `${validateSessionId(sessionId)}.jsonl`));
}

export function projectPreferencesFile(root, cwd) {
  return assertInside(root, path.join(root, 'projects', projectKey(cwd), 'preferences.json'));
}
