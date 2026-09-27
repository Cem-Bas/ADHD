#!/usr/bin/env node
import { runHook } from './common/hook.mjs';
import { mutateSession } from './common/store.mjs';
import { sessionFile, normalizeCwd } from './common/paths.mjs';
import { fileExists } from './common/fsx.mjs';
import { isOpenPhase } from './common/schema.mjs';
import { transition, nextPhaseAfterFailedEvaluation, MAX_CONSECUTIVE_BLOCKS } from './common/statemachine.mjs';
import { evaluateStop, invalidateAudit, receiptCoverage, createDegradedTask } from './common/session.mjs';
import { readLastAssistantText } from './common/transcript.mjs';
import { appendDiagnostic } from './common/diagnostics.mjs';
import { renderRepairInstruction, renderBoundedReportInstruction, renderDegradedReportInstruction, boundedReportPresent, degradedReportPresent } from './common/render.mjs';

function lastMessage(input, record) {
  if (typeof input.last_assistant_message === 'string' && input.last_assistant_message !== '') return input.last_assistant_message;
  return readLastAssistantText(record.transcriptPath || input.transcript_path);
}

function decide(record, { input, now, pluginRoot, dataRoot }) {
  if (!isOpenPhase(record.phase)) return { skipSave: true, result: null };
  if (record.extensions?.lastTurn === 'control') {
    record.extensions.lastTurn = 'user';
    return { result: null };
  }
  const background = Array.isArray(input.background_tasks) ? input.background_tasks.length : 0;
  const crons = Array.isArray(input.session_crons) ? input.session_crons.length : 0;
  if (background > 0 || crons > 0) return { skipSave: true, result: null };
  if (record.phase === 'REPORT_REQUIRED') {
    if (boundedReportPresent(lastMessage(input, record))) {
      transition(record, 'BOUNDED_STOP', { now });
      return { result: { systemMessage: `ADHD: task ${record.taskId} ends as BOUNDED_STOP after ${record.repair.completed} repairs — NOT complete; ${record.repair.gaps.length} gap(s) remain (see the report above).` } };
    }
    transition(record, 'DEGRADED_STOP', { now });
    return { result: { systemMessage: `ADHD: the bounded-stop report was missing or malformed; task ${record.taskId} ends as DEGRADED_STOP — completion was NOT verified.` } };
  }
  if (record.phase === 'DEGRADED_REPORT_REQUIRED') {
    const reported = degradedReportPresent(lastMessage(input, record));
    transition(record, 'DEGRADED_STOP', { now });
    return { result: { systemMessage: reported ? `ADHD: task ${record.taskId} ends as DEGRADED_STOP — verification could not be completed (see the report above).` : `ADHD: task ${record.taskId} ends as DEGRADED_STOP — verification could not be completed and no degraded report was produced.` } };
  }
  if (record.repair.blocksIssued >= MAX_CONSECUTIVE_BLOCKS) {
    transition(record, 'DEGRADED_STOP', { now });
    return { result: { systemMessage: `ADHD: the Stop hook reached its block limit (${MAX_CONSECUTIVE_BLOCKS}); task ${record.taskId} ends as DEGRADED_STOP — completion was NOT verified.` } };
  }
  const cwd = normalizeCwd(record.cwd || input.cwd);
  const evaluation = evaluateStop(record, { cwd, fileExists });
  if (evaluation.pass) {
    record.repair.gaps = [];
    transition(record, 'COMPLETE', { now });
    const coverage = receiptCoverage(record);
    return { result: { systemMessage: `ADHD: contract verified — COMPLETE (${coverage.passed}/${coverage.total} items PASS, ${record.repair.completed} repair(s)).` } };
  }
  if (evaluation.gaps.every((gap) => gap.code === 'ITEM_BLOCKED')) {
    record.repair.gaps = evaluation.gaps;
    return { result: { systemMessage: `ADHD: task ${record.taskId} paused — ${evaluation.gaps.length} item(s) BLOCKED on user input or an external condition; NOT complete. The task resumes with the user's next message.` } };
  }
  const next = nextPhaseAfterFailedEvaluation(record.phase, record.repair.maximum);
  record.repair.gaps = evaluation.gaps;
  record.repair.blocksIssued += 1;
  invalidateAudit(record, now);
  transition(record, next, { now });
  const codes = [...new Set(evaluation.gaps.map((gap) => gap.code))].join(', ');
  if (next === 'REPORT_REQUIRED') {
    return { result: { decision: 'block', reason: renderBoundedReportInstruction({ record, gaps: evaluation.gaps }), systemMessage: `ADHD: repair budget exhausted (${record.repair.maximum}); requesting a bounded-stop report — ${evaluation.gaps.length} gap(s): ${codes}` } };
  }
  return { result: { decision: 'block', reason: renderRepairInstruction({ record, gaps: evaluation.gaps, pluginRoot, dataRoot }), systemMessage: `ADHD: repair ${record.repair.completed}/${record.repair.maximum} — ${evaluation.gaps.length} gap(s): ${codes}` } };
}

function handleStop({ input, sessionId, dataRoot, pluginRoot, now }) {
  if (!fileExists(sessionFile(dataRoot, sessionId))) return null;
  let outcome;
  try {
    outcome = mutateSession(dataRoot, sessionId, (record) => decide(record, { input, now, pluginRoot, dataRoot }), { now });
  } catch (error) {
    appendDiagnostic(dataRoot, sessionId, { code: error.code || 'STOP_HOOK_FAILURE', message: error.message }, { now });
    return { systemMessage: `ADHD: verification could not run (${error.code || 'error'}); this stop is DEGRADED — completion was NOT verified.` };
  }
  if (outcome.status === 'corrupt') {
    const reason = 'the saved task state was unreadable and has been quarantined';
    appendDiagnostic(dataRoot, sessionId, { code: 'STATE_QUARANTINED', message: `${reason}; requiring a degraded-stop report` }, { now });
    const created = mutateSession(dataRoot, sessionId, (record) => {
      createDegradedTask(record, { reason, now });
      record.repair.blocksIssued = 1;
      return { result: renderDegradedReportInstruction({ record, reason }) };
    }, { create: { cwd: normalizeCwd(input.cwd) }, now });
    return { decision: 'block', reason: created.result, systemMessage: 'ADHD: task state was corrupted; requesting a degraded-stop report (completion cannot be verified).' };
  }
  return outcome.result;
}

runHook({ name: 'Stop', importMetaUrl: import.meta.url, handler: handleStop });
