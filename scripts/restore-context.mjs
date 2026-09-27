#!/usr/bin/env node
import { runHook } from './common/hook.mjs';
import { loadSession, mutateSession, archiveTask } from './common/store.mjs';
import { loadPreferences } from './common/prefs.mjs';
import { cleanupExpired } from './common/retention.mjs';
import { isOpenPhase } from './common/schema.mjs';
import { closeReplaced } from './common/session.mjs';
import { normalizeCwd } from './common/paths.mjs';
import { appendDiagnostic } from './common/diagnostics.mjs';
import { renderRestoreContext } from './common/render.mjs';

function output(text) {
  return text ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } } : null;
}

function handleSessionStart({ input, sessionId, dataRoot, pluginRoot, now }) {
  const source = input.source;
  if (source === 'startup') {
    try {
      cleanupExpired(dataRoot, { now });
    } catch (error) {
      appendDiagnostic(dataRoot, sessionId, { code: 'RETENTION_FAILED', message: error.message }, { now });
    }
  }
  const loaded = loadSession(dataRoot, sessionId);
  if (loaded.status === 'corrupt') {
    appendDiagnostic(dataRoot, sessionId, { code: 'STATE_QUARANTINED', message: `unreadable session state quarantined during ${source}` }, { now });
    return output('[ADHD] The saved task state for this session was unreadable and has been quarantined. If a task was in progress, ask the user to confirm the current request in one line before continuing.');
  }
  if (loaded.status === 'missing') return null;
  const record = loaded.record;
  if (source === 'clear') {
    if (isOpenPhase(record.phase)) {
      mutateSession(dataRoot, sessionId, (current) => {
        closeReplaced(current, now, 'cleared');
        archiveTask(dataRoot, current);
        return {};
      }, { now });
    }
    return null;
  }
  if (source === 'fork' || !isOpenPhase(record.phase)) return null;
  const prefs = loadPreferences(dataRoot, normalizeCwd(record.cwd));
  return output(renderRestoreContext({ record, prefs, pluginRoot, dataRoot, source }));
}

runHook({ name: 'SessionStart', importMetaUrl: import.meta.url, handler: handleSessionStart });
