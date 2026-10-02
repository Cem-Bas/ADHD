#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, readStdin, parseJson, writeStdoutJson } from './common/io.mjs';
import { resolveDataRoot, validateSessionId, normalizeCwd, dataPaths, diagnosticsFile, projectKey } from './common/paths.mjs';
import { loadSession, mutateSession, archiveTask, listSessionRecords, findOpenSessionsForCwd } from './common/store.mjs';
import { startTask, setMode, cancelTask, closeReplaced, declareArtifacts, addResearchEvidence, recordAuditReceipt, evaluateStop, recordAnswer } from './common/session.mjs';
import { isOpenPhase, MODES } from './common/schema.mjs';
import { loadPreferences, setPreference, unsetPreference, resetPreferences, PREFERENCE_DEFINITIONS } from './common/prefs.mjs';
import { cleanupExpired } from './common/retention.mjs';
import { assessLedger } from './common/ledger.mjs';
import { statusSummary } from './common/render.mjs';
import { fileExists, listFiles, removeQuietly, writeFileAtomic, ensureDir, readJsonFile } from './common/fsx.mjs';
import { AdhdError } from './common/errors.mjs';

function fail(code, message, details) {
  throw new AdhdError(code, message, details);
}

function resolveSessionId(root, flags) {
  if (typeof flags.session === 'string') return validateSessionId(flags.session);
  if (typeof flags.cwd === 'string') {
    const open = findOpenSessionsForCwd(root, flags.cwd);
    if (open.length === 1) return open[0].sessionId;
    if (open.length === 0) fail('NOT_FOUND', `no open ADHD task for ${normalizeCwd(flags.cwd)}; pass --session <id>`);
    fail('AMBIGUOUS_SESSION', `${open.length} open ADHD tasks for this directory; pass --session <id> (${open.map((record) => record.sessionId).join(', ')})`);
  }
  return fail('USAGE', '--session <id> or --cwd <path> is required');
}

function requireRecord(root, sessionId) {
  const loaded = loadSession(root, sessionId);
  if (loaded.status === 'missing') fail('NOT_FOUND', `no session state for ${sessionId}`);
  if (loaded.status === 'corrupt') fail('STATE_CORRUPT', `session state for ${sessionId} was unreadable and has been quarantined`);
  return loaded.record;
}

async function readStdinJson() {
  const parsed = parseJson(await readStdin());
  if (!parsed.ok) fail('INVALID_JSON', `stdin is not valid JSON: ${parsed.error}`);
  return parsed.value;
}

function mutateOpen(root, sessionId, now, fn) {
  const outcome = mutateSession(root, sessionId, (record) => {
    if (!isOpenPhase(record.phase)) fail('NO_ACTIVE_TASK', `task phase is ${record.phase}`);
    return fn(record);
  }, { now });
  if (outcome.status === 'missing') fail('NOT_FOUND', `no session state for ${sessionId}`);
  if (outcome.status === 'corrupt') fail('STATE_CORRUPT', `session state for ${sessionId} was unreadable and has been quarantined`);
  return outcome.result;
}

function prefsView(root, cwd) {
  const view = loadPreferences(root, cwd);
  return { effective: view.effective, sources: view.sources, files: view.files, definitions: PREFERENCE_DEFINITIONS };
}

function dirEntries(dir) {
  return listFiles(dir).map((name) => {
    const file = path.join(dir, name);
    let bytes = 0;
    try {
      bytes = fs.statSync(file).size;
    } catch {
      // vanished between listing and stat
    }
    return { file, bytes };
  });
}

function dataShow(root) {
  const paths = dataPaths(root);
  const sessions = listSessionRecords(root).flatMap(({ file, record, archived }) => {
    let bytes;
    try {
      bytes = fs.statSync(file).size;
    } catch {
      return [];
    }
    return [{ file, sessionId: record.sessionId, taskId: record.taskId, phase: record.phase, mode: record.mode, cwd: record.cwd, updatedAt: record.updatedAt, expiresAt: record.expiresAt, bytes, archived }];
  });
  const diagnostics = dirEntries(paths.diagnostics);
  const exportsList = dirEntries(paths.exports);
  const projects = listFiles(paths.projects).map((key) => ({ projectKey: key, file: path.join(paths.projects, key, 'preferences.json'), exists: fileExists(path.join(paths.projects, key, 'preferences.json')) }));
  const globalBytes = fileExists(paths.preferences) ? fs.statSync(paths.preferences).size : 0;
  const totalBytes = [...sessions, ...diagnostics, ...exportsList].reduce((sum, entry) => sum + entry.bytes, globalBytes);
  return { dataRoot: root, preferences: { global: { file: paths.preferences, exists: fileExists(paths.preferences) }, projects }, sessions, diagnostics, exports: exportsList, totalBytes, retention: { finishedSessions: 'retentionDays preference (default 30 days)', diagnosticsDays: 14 } };
}

function dataExport(root, now) {
  const paths = dataPaths(root);
  ensureDir(paths.exports);
  const file = path.join(paths.exports, `adhd-export-${new Date(now).toISOString().replace(/[:.]/g, '-')}.json`);
  const payload = {
    exportedAt: new Date(now).toISOString(),
    dataRoot: root,
    preferences: {
      global: readJsonFile(paths.preferences).value ?? null,
      projects: listFiles(paths.projects).map((key) => ({ projectKey: key, preferences: readJsonFile(path.join(paths.projects, key, 'preferences.json')).value ?? null })),
    },
    sessions: listSessionRecords(root).map((entry) => entry.record),
    diagnostics: listFiles(paths.diagnostics).filter((name) => name.endsWith('.jsonl')).flatMap((name) => {
      try {
        return [{ file: name, lines: fs.readFileSync(path.join(paths.diagnostics, name), 'utf8').split('\n').filter(Boolean) }];
      } catch {
        return [];
      }
    }),
  };
  writeFileAtomic(file, JSON.stringify(payload, null, 2));
  return { ok: true, file, sessions: payload.sessions.length };
}

function dataDeleteSession(root, sessionId) {
  validateSessionId(sessionId);
  const paths = dataPaths(root);
  const deleted = [];
  for (const name of listFiles(paths.sessions)) {
    if (name === `${sessionId}.json` || name.startsWith(`${sessionId}.`)) {
      const file = path.join(paths.sessions, name);
      if (removeQuietly(file)) deleted.push(file);
    }
  }
  const diag = diagnosticsFile(root, sessionId);
  if (fileExists(diag) && removeQuietly(diag)) deleted.push(diag);
  return { ok: true, deleted };
}

function projectTargets(root, cwd) {
  const normalized = normalizeCwd(cwd);
  const key = projectKey(cwd);
  const paths = dataPaths(root);
  const targets = [];
  const prefDir = path.join(paths.projects, key);
  if (fileExists(prefDir)) targets.push(prefDir);
  for (const { file, record } of listSessionRecords(root)) {
    if (record.cwd !== normalized) continue;
    targets.push(file);
    const diag = path.join(paths.diagnostics, `${record.sessionId}.jsonl`);
    if (fileExists(diag) && !targets.includes(diag)) targets.push(diag);
  }
  return { key, normalized, targets };
}

function confirmOrPreview(flags, phrase, extra) {
  if (flags.confirm === phrase) return null;
  if (flags.confirm !== undefined) fail('CONFIRM_REQUIRED', `confirmation phrase did not match; expected exactly: ${phrase}`);
  return { requiresConfirmation: true, phrase, ...extra };
}

function dataDeleteProject(root, flags) {
  if (typeof flags.cwd !== 'string') fail('USAGE', '--cwd <path> is required');
  const { key, normalized, targets } = projectTargets(root, flags.cwd);
  const preview = confirmOrPreview(flags, `delete project ${key}`, { projectKey: key, cwd: normalized, targets });
  if (preview) return preview;
  return { ok: true, deleted: targets.filter((target) => removeQuietly(target)) };
}

function dataDeleteAll(root, flags) {
  const paths = dataPaths(root);
  const targets = [paths.preferences, paths.projects, paths.sessions, paths.exports, paths.diagnostics].filter(fileExists);
  const preview = confirmOrPreview(flags, 'delete all adhd data', { targets });
  if (preview) return preview;
  return { ok: true, deleted: targets.filter((target) => removeQuietly(target)) };
}

const commands = {
  status({ root, flags }) {
    return statusSummary(requireRecord(root, resolveSessionId(root, flags)));
  },
  contract({ root, flags }) {
    const record = requireRecord(root, resolveSessionId(root, flags));
    return { sessionId: record.sessionId, taskId: record.taskId, phase: record.phase, mode: record.mode, contractVersion: record.contractVersion, requestDigest: record.requestDigest, originalRequest: record.originalRequest, userTurns: record.userTurns };
  },
  async 'audit-record'({ root, flags, now }) {
    const sessionId = resolveSessionId(root, flags);
    const receipt = await readStdinJson();
    const outcome = mutateSession(root, sessionId, (record) => {
      if (!isOpenPhase(record.phase)) return { skipSave: true, result: { accepted: false, reason: 'NO_ACTIVE_TASK', phase: record.phase } };
      const result = recordAuditReceipt(record, receipt, now);
      if (!result.ok) return { skipSave: true, result: { accepted: false, reason: result.reason, errors: result.errors || [] } };
      if (!record.audit.requestedAt) record.audit.requestedAt = new Date(now).toISOString();
      const evaluation = evaluateStop(record, { cwd: record.cwd, fileExists });
      return { result: { accepted: true, verdict: evaluation.pass ? 'PASS' : 'GAPS', gaps: evaluation.gaps, coverage: { passed: result.receipt.items.filter((item) => item.status === 'PASS').length, total: result.receipt.items.length }, recordedAt: result.receipt.recordedAt } };
    }, { now });
    if (outcome.status === 'corrupt') fail('STATE_CORRUPT', `session state for ${sessionId} was unreadable and has been quarantined`);
    if (outcome.status !== 'ok') fail('NOT_FOUND', `no session state for ${sessionId}`);
    return outcome.result;
  },
  async 'evidence-add'({ root, flags, now }) {
    const sessionId = resolveSessionId(root, flags);
    const payload = await readStdinJson();
    if (!payload || typeof payload !== 'object') fail('INVALID_EVIDENCE', 'payload must be an object with claims, sources, and unresolved arrays');
    return mutateOpen(root, sessionId, now, (record) => {
      addResearchEvidence(record, payload);
      const assessment = assessLedger(record.evidence.claims, record.evidence.unresolved);
      return { result: { ok: true, counts: { claims: record.evidence.claims.length, sources: record.evidence.sources.length, unresolved: record.evidence.unresolved.length }, adequate: assessment.adequate, gaps: assessment.gaps } };
    });
  },
  async 'artifact-declare'({ root, flags, now }) {
    const sessionId = resolveSessionId(root, flags);
    const payload = await readStdinJson();
    return mutateOpen(root, sessionId, now, (record) => {
      declareArtifacts(record, payload && payload.artifacts, now);
      return { result: { ok: true, artifacts: record.evidence.artifacts } };
    });
  },
  async 'answer-record'({ root, flags, now }) {
    const sessionId = resolveSessionId(root, flags);
    const payload = await readStdinJson();
    return mutateOpen(root, sessionId, now, (record) => {
      recordAnswer(record, payload && payload.answer, now);
      return { result: { ok: true, contractVersion: record.contractVersion, answers: record.evidence.answers.length } };
    });
  },
  cancel({ root, flags, now }) {
    const sessionId = resolveSessionId(root, flags);
    const outcome = mutateSession(root, sessionId, (record) => {
      if (isOpenPhase(record.phase)) cancelTask(record, now);
      return { result: { ok: true, phase: record.phase } };
    }, { now });
    if (outcome.status === 'corrupt') fail('STATE_CORRUPT', `session state for ${sessionId} was unreadable and has been quarantined`);
    if (outcome.status !== 'ok') fail('NOT_FOUND', `no session state for ${sessionId}`);
    return outcome.result;
  },
  mode({ root, flags, now }) {
    if (!MODES.includes(flags.mode)) fail('USAGE', `--mode must be one of ${MODES.join(', ')}`);
    const sessionId = resolveSessionId(root, flags);
    return mutateOpen(root, sessionId, now, (record) => {
      setMode(record, flags.mode, now);
      return { result: { ok: true, mode: record.mode, contractVersion: record.contractVersion } };
    });
  },
  async new({ root, flags, now }) {
    if (typeof flags.cwd !== 'string') fail('USAGE', '--cwd <path> is required');
    const sessionId = typeof flags.session === 'string' ? validateSessionId(flags.session) : resolveSessionId(root, flags);
    const text = typeof flags.text === 'string' ? flags.text : await readStdin();
    if (text.trim() === '') fail('USAGE', 'provide the request with --text or on stdin');
    const cwd = normalizeCwd(flags.cwd);
    const prefs = loadPreferences(root, cwd);
    const mode = flags.mode === 'hyperfocus' ? 'hyperfocus' : 'standard';
    const outcome = mutateSession(root, sessionId, (record) => {
      if (isOpenPhase(record.phase)) closeReplaced(record, now);
      if (record.taskId) archiveTask(root, record);
      startTask(record, { text, receivedAt: now, mode, preferencesSnapshot: prefs.effective, retentionDays: prefs.effective.retentionDays });
      return { result: { ok: true, sessionId, taskId: record.taskId, phase: record.phase } };
    }, { create: { cwd, preferencesSnapshot: prefs.effective, retentionDays: prefs.effective.retentionDays }, now });
    return outcome.result;
  },
  prefs({ root, flags, positional }) {
    const action = positional[1] || 'show';
    const cwd = typeof flags.cwd === 'string' ? flags.cwd : process.cwd();
    if (action === 'show') return prefsView(root, cwd);
    if (action === 'set') {
      if (typeof flags.key !== 'string' || flags.value === undefined) fail('USAGE', 'prefs set needs --key <key> --value <value>');
      setPreference(root, { scope: typeof flags.scope === 'string' ? flags.scope : 'global', cwd, key: flags.key, value: flags.value === true ? 'true' : flags.value });
      return prefsView(root, cwd);
    }
    if (action === 'unset') {
      if (typeof flags.key !== 'string') fail('USAGE', 'prefs unset needs --key <key>');
      unsetPreference(root, { scope: typeof flags.scope === 'string' ? flags.scope : 'global', cwd, key: flags.key });
      return prefsView(root, cwd);
    }
    if (action === 'reset') {
      resetPreferences(root, { scope: typeof flags.scope === 'string' ? flags.scope : 'all', cwd });
      return prefsView(root, cwd);
    }
    return fail('USAGE', 'prefs action must be show, set, unset, or reset');
  },
  data({ root, flags, positional, now }) {
    const action = positional[1] || 'show';
    if (action === 'show') return dataShow(root);
    if (action === 'export') return dataExport(root, now);
    if (action === 'delete-session') return dataDeleteSession(root, resolveSessionId(root, flags));
    if (action === 'delete-project') return dataDeleteProject(root, flags);
    if (action === 'delete-all') return dataDeleteAll(root, flags);
    return fail('USAGE', 'data action must be show, export, delete-session, delete-project, or delete-all');
  },
  gc({ root, now }) {
    return cleanupExpired(root, { now });
  },
};

async function main() {
  try {
    const { positional, flags } = parseArgs(process.argv.slice(2));
    const command = positional[0];
    const root = resolveDataRoot({ flag: flags.data });
    const now = Date.now();
    if (!command || !Object.prototype.hasOwnProperty.call(commands, command)) {
      writeStdoutJson({ error: { code: 'USAGE', message: `usage: state.mjs <${Object.keys(commands).join('|')}> [--data <dir>] [--session <id> | --cwd <path>] [options]` } });
      process.exitCode = 1;
      return;
    }
    writeStdoutJson(await commands[command]({ root, flags, positional, now }));
  } catch (error) {
    const details = error?.details && Array.isArray(error.details.errors) ? error.details.errors : undefined;
    writeStdoutJson({ error: { code: error?.code || 'ERROR', message: String(error?.message).slice(0, 500), details } });
    process.exitCode = 1;
  }
}

main();
