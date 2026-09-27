#!/usr/bin/env node
import { runHook } from './common/hook.mjs';
import { classifyPrompt, detectHyperfocus, isMachinePromptSource, isSystemEnvelope } from './common/controls.mjs';
import { loadPreferences } from './common/prefs.mjs';
import { mutateSession, archiveTask } from './common/store.mjs';
import { startTask, appendUserTurn, setMode, cancelTask, closeReplaced, createDegradedTask } from './common/session.mjs';
import { isOpenPhase } from './common/schema.mjs';
import { transition } from './common/statemachine.mjs';
import { normalizeCwd } from './common/paths.mjs';
import { isAdhdError } from './common/errors.mjs';
import { appendDiagnostic } from './common/diagnostics.mjs';
import { renderTaskLockProtocol, renderControlContext, renderCancelledContext, renderDegradedReportInstruction } from './common/render.mjs';

function output(text) {
  return text ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } } : null;
}

function handlePrompt({ input, sessionId, dataRoot, pluginRoot, now }) {
  if (typeof input.prompt !== 'string') return null;
  const classified = classifyPrompt(input.prompt);
  if (classified.kind === 'ordinary' && classified.text.trim() === '') return null;
  const cwd = normalizeCwd(input.cwd);
  const prefs = loadPreferences(dataRoot, cwd);
  const machine = isMachinePromptSource(input.source) || isSystemEnvelope(input.prompt);
  const transcriptPath = typeof input.transcript_path === 'string' ? input.transcript_path : null;
  const create = { cwd, transcriptPath, preferencesSnapshot: prefs.effective, retentionDays: prefs.effective.retentionDays };
  const render = { prefs, pluginRoot, dataRoot };
  const taskOptions = (text, mode) => ({ text, receivedAt: now, mode, transcriptPath, preferencesSnapshot: prefs.effective, retentionDays: prefs.effective.retentionDays });
  const chooseMode = (record, text) => (detectHyperfocus(text) || record.mode === 'hyperfocus' || prefs.effective.researchDepth === 'hyperfocus' ? 'hyperfocus' : 'standard');
  const begin = (record, text, mode) => {
    if (record.taskId) archiveTask(dataRoot, record);
    startTask(record, taskOptions(text, mode));
    return { result: renderTaskLockProtocol({ record, ...render, full: true }) };
  };

  const applyControl = (record, open) => {
    const { command, args } = classified;
    switch (command) {
      case 'cancel':
        if (!open) return { skipSave: true, result: renderControlContext({ command, args, record, ...render, hasTask: false }) };
        cancelTask(record, now);
        return { result: renderCancelledContext({ record }) };
      case 'new':
        if (open) closeReplaced(record, now);
        if (args === '') {
          if (record.taskId) archiveTask(dataRoot, record);
          return { result: renderControlContext({ command, args, record, ...render, hasTask: false }) };
        }
        return begin(record, args, detectHyperfocus(args) || prefs.effective.researchDepth === 'hyperfocus' ? 'hyperfocus' : 'standard');
      case 'hyperfocus':
        if (open) {
          if (args !== '') appendUserTurn(record, { text: args, receivedAt: now });
          setMode(record, 'hyperfocus', now);
          return { result: renderTaskLockProtocol({ record, ...render, full: true }) };
        }
        if (args !== '') return begin(record, args, 'hyperfocus');
        record.mode = 'hyperfocus';
        return { result: renderControlContext({ command, args, record, ...render, hasTask: false }) };
      default:
        return { skipSave: true, result: renderControlContext({ command, args, record, ...render, hasTask: open }) };
    }
  };

  const apply = (record) => {
    const open = isOpenPhase(record.phase);
    if (transcriptPath) record.transcriptPath = transcriptPath;
    if (machine) return { skipSave: true, result: open ? renderTaskLockProtocol({ record, ...render, full: false, machineTurn: true }) : null };
    if (classified.kind === 'control') return applyControl(record, open);
    if (classified.kind === 'cancel') {
      if (!open) return { skipSave: true, result: null };
      cancelTask(record, now);
      return { result: renderCancelledContext({ record }) };
    }
    if (classified.kind === 'replace') {
      if (open) closeReplaced(record, now);
      if (classified.text === '') {
        if (record.taskId) archiveTask(dataRoot, record);
        return { result: '[ADHD] The previous task is closed (recorded as not complete). The user gave no replacement request yet: ask for it in one line. The next ordinary prompt starts the new task.' };
      }
      return begin(record, classified.text, chooseMode(record, classified.text));
    }
    if (!open) return begin(record, classified.text, chooseMode(record, classified.text));
    appendUserTurn(record, { text: classified.text, receivedAt: now });
    if (detectHyperfocus(classified.text)) setMode(record, 'hyperfocus', now);
    return { result: renderTaskLockProtocol({ record, ...render, full: false }) };
  };

  const degrade = () => mutateSession(dataRoot, sessionId, (record) => {
    const reason = 'the session record reached its 2 MiB storage limit, so this turn could not be added to the task ledger';
    if (!isOpenPhase(record.phase)) createDegradedTask(record, { reason, now });
    else if (record.phase !== 'DEGRADED_REPORT_REQUIRED' && record.phase !== 'REPORT_REQUIRED') transition(record, 'DEGRADED_REPORT_REQUIRED', { now });
    return { result: renderDegradedReportInstruction({ record, reason }) };
  }, { create, now });

  let outcome;
  try {
    outcome = mutateSession(dataRoot, sessionId, apply, { create, now });
    if (outcome.status === 'corrupt') {
      appendDiagnostic(dataRoot, sessionId, { code: 'STATE_QUARANTINED', message: 'session state was unreadable and has been quarantined; a fresh record starts with this prompt' }, { now });
      outcome = mutateSession(dataRoot, sessionId, apply, { create, now });
    }
  } catch (error) {
    if (!isAdhdError(error, 'STATE_TOO_LARGE')) throw error;
    appendDiagnostic(dataRoot, sessionId, { code: 'STATE_TOO_LARGE', message: error.message }, { now });
    return output(degrade().result);
  }
  return output(outcome.result);
}

runHook({ name: 'UserPromptSubmit', importMetaUrl: import.meta.url, handler: handlePrompt });
