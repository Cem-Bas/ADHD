#!/usr/bin/env node
import { runHook } from './common/hook.mjs';
import { mutateSession } from './common/store.mjs';
import { sessionFile } from './common/paths.mjs';
import { fileExists } from './common/fsx.mjs';
import { isOpenPhase } from './common/schema.mjs';
import { CAPTURED_TOOLS, summarizeToolEvent } from './common/evidence.mjs';
import { recordToolEvent, trackAgent } from './common/session.mjs';
import { isAdhdError } from './common/errors.mjs';
import { appendDiagnostic } from './common/diagnostics.mjs';

function handleEvidence({ input, sessionId, dataRoot, now }) {
  const event = input.hook_event_name;
  const agentEvent = event === 'SubagentStart' || event === 'SubagentStop';
  if (!agentEvent) {
    if (input.agent_id) return null;
    if (!CAPTURED_TOOLS.has(input.tool_name)) return null;
  }
  if (!fileExists(sessionFile(dataRoot, sessionId))) return null;
  try {
    mutateSession(dataRoot, sessionId, (record) => {
      if (!isOpenPhase(record.phase)) return { skipSave: true };
      if (agentEvent) trackAgent(record, input, now);
      else recordToolEvent(record, summarizeToolEvent(input, { now }), now);
      return {};
    }, { now });
  } catch (error) {
    if (!isAdhdError(error, 'STATE_TOO_LARGE')) throw error;
    appendDiagnostic(dataRoot, sessionId, { code: 'EVIDENCE_DROPPED', message: `event ${input.tool_use_id || input.agent_id || ''} dropped: ${error.message}` }, { now });
  }
  return null;
}

runHook({ name: 'PostToolUse', importMetaUrl: import.meta.url, handler: handleEvidence });
