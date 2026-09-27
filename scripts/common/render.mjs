import path from 'node:path';
import { sessionFile } from './paths.mjs';
import { auditFreshness, receiptCoverage } from './session.mjs';
import { PREFERENCE_DEFINITIONS } from './prefs.mjs';

export const BOUNDED_REPORT_HEADING = 'ADHD BOUNDED STOP REPORT';
export const BOUNDED_REPORT_SECTIONS = ['Unresolved items', 'Evidence gathered', 'Exact blocker', 'Smallest next action'];
export const DEGRADED_REPORT_HEADING = 'ADHD DEGRADED STOP REPORT';
export const DEGRADED_REPORT_SECTIONS = ['Verification failure', 'Work completed without verification', 'Smallest next action'];
const LEDGER_CHAR_BUDGET = 12000;
const MAX_RENDERED_TURNS = 12;
const MIN_TURN_BUDGET = 200;

function quote(value) {
  return `"${String(value).replace(/(["\\$`])/g, '\\$1')}"`;
}

function fence(text) {
  return `<<<\n${text}\n>>>`;
}

export function stateCommand({ pluginRoot, dataRoot, sessionId, subcommand, extra = '' }) {
  const script = path.join(pluginRoot, 'scripts', 'state.mjs');
  return `node ${quote(script)} ${subcommand} --data ${quote(dataRoot)} --session ${quote(sessionId)}${extra ? ` ${extra}` : ''}`;
}

export function cliCommand({ pluginRoot, dataRoot, subcommand, cwd, extra = '' }) {
  const script = path.join(pluginRoot, 'scripts', 'state.mjs');
  return `node ${quote(script)} ${subcommand} --data ${quote(dataRoot)} --cwd ${quote(cwd)}${extra ? ` ${extra}` : ''}`;
}

export function shortDigest(digest) {
  return digest ? digest.replace(/^sha256:/, '').slice(0, 12) : 'none';
}

function clip(text, budget) {
  if (text.length <= budget) return text;
  return `${text.slice(0, budget)}\n[… clipped ${text.length - budget} more characters; the full verbatim text is in the session state file]`;
}

export function renderLedger(record, { maxChars = LEDGER_CHAR_BUDGET, maxTurns = MAX_RENDERED_TURNS } = {}) {
  const turns = record.userTurns;
  const shown = turns.slice(-maxTurns);
  const omitted = turns.length - shown.length;
  const originalText = record.originalRequest ? record.originalRequest.text : '';
  const originalBudget = Math.max(400, Math.floor(maxChars * 0.4));
  const remaining = Math.max(0, maxChars - Math.min(originalText.length, originalBudget));
  const turnBudget = Math.max(MIN_TURN_BUDGET, Math.floor(remaining / Math.max(1, shown.length)));
  const lines = ['Original request (verbatim):', fence(clip(originalText, originalBudget))];
  if (turns.length > 0) {
    lines.push('Later user turns (ordered, verbatim; a later explicit correction overrides an earlier conflicting instruction):');
    if (omitted > 0) lines.push(`[turns 1–${omitted} are omitted from this view to stay within the context budget; they remain verbatim in the session state file and still bind this task]`);
    for (const turn of shown) lines.push(`${turn.sequence}. [${turn.receivedAt}]`, fence(clip(turn.text, turnBudget)));
  }
  return lines.join('\n');
}

export function headerLine(record) {
  return `[ADHD] session ${record.sessionId} · task ${record.taskId} · contract v${record.contractVersion} · digest ${shortDigest(record.requestDigest)} · mode ${record.mode} · phase ${record.phase} · repairs ${record.repair.completed}/${record.repair.maximum}`;
}

export function preferenceLine(prefs) {
  return `Effective preferences: ${Object.entries(prefs.effective).map(([key, value]) => `${key}=${value} (${prefs.sources[key]})`).join(', ')}`;
}

export function auditorInvocation({ record, pluginRoot, dataRoot }) {
  const command = stateCommand({ pluginRoot, dataRoot, sessionId: record.sessionId, subcommand: 'audit-record' });
  const receiptShape = JSON.stringify({
    taskId: record.taskId,
    contractVersion: record.contractVersion,
    requestDigest: record.requestDigest,
    nonce: record.audit.nonce,
    auditorModel: '<your model id, or unknown>',
    taskLockValid: true,
    taskLockIssues: [],
    items: [{ id: 'R1', requirement: '<requirement derived from the ledger>', status: 'PASS | PARTIAL | BLOCKED', gap: '<required unless PASS>', evidence: [{ type: 'artifact', path: '<file>' }, { type: 'command', toolUseId: '<id from evidence.commands>' }, { type: 'transcript', note: '<what you saw>' }] }],
    summary: '<one paragraph>',
  });
  const prompt = [
    `You are the ADHD contract auditor for task ${record.taskId} (contract v${record.contractVersion}, request digest ${record.requestDigest}). Audit nonce: ${record.audit.nonce}.`,
    `Session state file (read-only): ${sessionFile(dataRoot, record.sessionId)}`,
    `Transcript (JSONL, read-only): ${record.transcriptPath || 'unavailable — audit from the state file and the working directory only'}`,
    `Working directory: ${record.cwd}`,
    '',
    'Procedure:',
    '1. Read the state file. Derive the requirement list from originalRequest.text and every entry of userTurns[] (a later explicit correction overrides an earlier conflicting instruction). The Task Lock in the transcript is a projection to check, never the source of truth.',
    '2. For each requirement, look for verifiable evidence: the transcript, declared artifacts (evidence.artifacts — check that the files exist), recorded commands (evidence.commands — exit status 0 means success), and files in the working directory. Assign PASS only with evidence, PARTIAL when work or evidence is missing, BLOCKED when completion depends on an unresolved external condition or a fact only the user can supply.',
    '3. Judge the visible Task Lock: taskLockValid is false if it answers a nearby question, omits an explicit requirement, invents a deliverable, or states the wrong mode.',
    '4. Record the receipt by running exactly this command with the receipt JSON on stdin (a quoted heredoc is fine):',
    command,
    `Receipt JSON shape: ${receiptShape}`,
    "5. Report the command's JSON output and your itemized verdict. Do not repair anything, do not edit files, and do not run any other command.",
  ].join('\n');
  return { subagentType: 'adhd:contract-auditor', prompt };
}

const TASK_LOCK_TEMPLATE = [
  'TASK LOCK',
  "Goal: <the user's goal in their own terms — answer this request, not a nearby one>",
  'Deliverable: <every explicit deliverable>',
  'Must include: <explicit requirements and named items>',
  'Constraints: <explicit constraints, or "none stated">',
  'Mode: Standard | Hyperfocus',
  'Done when: <a testable completion rule>',
  '',
  'NOW: <the single current action>',
].join('\n');

const PROGRESS_TEMPLATE = [
  'Done: <objectively completed items>',
  'Now: <the single current action>',
  'Next: <the next concrete action>',
  'Blocked: <the exact blocker and what resolves it>',
  'Coverage: <completed contract items>/<total contract items>',
].join('\n');

const BOUNDARY_TEMPLATE = [
  'Blocked action: <the smallest exact portion that cannot be completed>',
  'Reason type: platform-or-provider restriction | law-or-regulation | missing authorization, privacy protection, or credential | missing information or unavailable tool | technical limitation | uncertainty that requires verification',
  'Basis: <the specific public rule or verified fact, when available>',
  'Completed: <requested portions already completed and unaffected>',
  'Closest route: <the smallest permissible change that preserves the goal>',
].join('\n');

const EVIDENCE_PAYLOAD_SHAPE = '{"claims":[{"claimId":"c1","text":"...","class":"core|supporting|background","stability":"stable|unstable","controversy":"disputed|undisputed","confidence":"high|moderate|low","rationale":"...","sources":[{"url":"...","title":"...","publisher":"...","publicationDate":"YYYY-MM-DD or null","accessedAt":"<ISO timestamp>","sourceType":"primary|authoritative|secondary|other","evidenceChainId":"<same id for every source that restates one origin>","relation":"supports|contradicts|context"}]}],"unresolved":[{"claimId":"c1","question":"...","missingEvidence":"...","effectOnConclusion":"..."}]}';

function hyperfocusSection(evidenceCommand) {
  return [
    '4. RESEARCH — HYPERFOCUS MODE IS ON. Follow the /adhd:hyperfocus workflow:',
    '   a. Decompose the request into answerable research questions; mark which claims are current, disputed, consequential, or resting on weak evidence.',
    '   b. When at least two questions are independent and parallel work saves time, run up to 4 adhd:source-researcher subagents in parallel (Agent tool, subagent_type "adhd:source-researcher"), one bounded question each.',
    '   c. Prefer current primary and authoritative sources; corroborate core disputed or unstable claims with two independent evidence chains (the same publisher, press release, dataset, or analysis counts as one chain); seek contrary evidence and record material disagreements.',
    `   d. Record every claim and source in the ledger (JSON on stdin): ${evidenceCommand}`,
    `      Payload: ${EVIDENCE_PAYLOAD_SHAPE}`,
    '   e. Run a coverage-gap pass before synthesis. The Stop hook checks the ledger against the support rules and blocks when a core claim is unsupported and not listed under unresolved.',
    '   f. Present sourced facts, reasonable inferences, recommendations, and unresolved questions as separate sections, with source dates and confidence.',
  ].join('\n');
}

const STANDARD_RESEARCH = '4. RESEARCH (Standard mode). Verify unstable or time-sensitive facts; prefer primary or authoritative sources when practical; cite externally sourced material claims directly; separate sourced fact, inference, and recommendation; disclose material uncertainty.';

export function renderTaskLockProtocol({ record, prefs, pluginRoot, dataRoot, full = true, machineTurn = false }) {
  const auditor = auditorInvocation({ record, pluginRoot, dataRoot });
  const artifactCommand = stateCommand({ pluginRoot, dataRoot, sessionId: record.sessionId, subcommand: 'artifact-declare' });
  const evidenceCommand = stateCommand({ pluginRoot, dataRoot, sessionId: record.sessionId, subcommand: 'evidence-add' });
  const parts = [headerLine(record), renderLedger(record), preferenceLine(prefs)];
  if (machineTurn) parts.push('This turn was injected by the system (a wakeup or background notification), not typed by the user. It is not part of the task ledger. Continue the task above.');
  if (full) {
    parts.push(
      '',
      'ADHD protocol — keeps this work anchored to the request above:',
      '1. TASK LOCK. Begin your first substantive response with this block, then start useful work in the same turn:',
      TASK_LOCK_TEMPLATE,
      'Invent no adjacent deliverable. Wait for the user only when a missing fact would materially change the deliverable, when authorization is genuinely absent, or immediately before a consequential external action that requires approval.',
      '2. AMENDMENTS. Later user turns steer or amend this task; they never replace it unless the user runs /adhd:new or starts a prompt with "New task:" or "Replace task:". Show the smallest delta as `Changed: <previous requirement> -> <corrected requirement>`. A later explicit correction wins over an earlier conflicting instruction. Questions, answers to your questions, and status requests stay inside this task.',
      '3. PROGRESS. At meaningful milestones report:',
      PROGRESS_TEMPLATE,
      'Never invent percentages or completion times.',
      record.mode === 'hyperfocus' ? hyperfocusSection(evidenceCommand) : STANDARD_RESEARCH,
      '5. BOUNDARIES. Before refusing or redirecting any part of the request, identify the smallest exact action under review and answer in this form, then continue the unaffected work:',
      BOUNDARY_TEMPLATE,
      'Never invent a policy, claim illegality without support, moralize, or silently answer a different question. Genuine restrictions remain binding.',
      '6. EVIDENCE. Declare each deliverable file when it is finished so the completion check can verify that it exists (JSON on stdin):',
      `${artifactCommand}   <<< {"artifacts":[{"path":"<relative or absolute path>","purpose":"<what it is>"}]}`,
      '7. COMPLETION AUDIT (required before you finish). Invoke the adhd:contract-auditor subagent with the Agent tool — subagent_type "adhd:contract-auditor" — using this prompt verbatim:',
      fence(auditor.prompt),
      `Wait for the auditor to report that the receipt was accepted, then finish. If you stop without a fresh PASS receipt, the Stop hook blocks and starts a repair cycle (maximum ${record.repair.maximum}). Never claim completion while any item is PARTIAL or BLOCKED.`,
      '8. CANCELLATION. Only /adhd:cancel, or an entire prompt of "cancel", "stop", "stop this task", or "cancel this task", cancels this task. "Stop doing X and do Y" is an amendment. Cancellation performs no cleanup or follow-on changes.',
    );
  } else {
    parts.push(
      '',
      'ADHD protocol reminder: the newest user turn above amends this task (show `Changed: <previous requirement> -> <corrected requirement>` when it changes a requirement; a bare question or answer needs no delta). Keep one NOW action. Before you finish, re-run the completion audit with this prompt (the nonce is new):',
      fence(auditor.prompt),
    );
    if (record.mode === 'hyperfocus') parts.push(`Hyperfocus is on: record claims and sources with ${evidenceCommand} (JSON on stdin) before finishing.`);
  }
  return parts.join('\n');
}

export function formatGaps(gaps) {
  return gaps.map((gap, i) => `${i + 1}. [${gap.code}]${gap.itemId ? ` ${gap.itemId}` : ''}${gap.requirement ? ` "${gap.requirement}"` : ''} — ${gap.detail}`).join('\n');
}

export function renderRestoreContext({ record, prefs, pluginRoot, dataRoot, source }) {
  const freshness = auditFreshness(record);
  const coverage = receiptCoverage(record);
  const receiptLine = freshness.fresh ? `fresh (${coverage.passed}/${coverage.total} items PASS)` : freshness.reason === 'none' ? 'none recorded yet' : `stale (${freshness.reason} changed)`;
  const gaps = record.repair.gaps.length > 0 ? record.repair.gaps.map((gap, i) => `${i + 1}. ${gap.code}${gap.itemId ? ` ${gap.itemId}` : ''} — ${gap.detail}`).join('\n') : 'none recorded';
  const parts = [
    `[ADHD] Task state restored after ${source}. Continue this task; do not ask the user to restate it.`,
    headerLine(record),
    renderLedger(record),
    `Audit receipt: ${receiptLine}`,
    `Open gaps:\n${gaps}`,
    `Declared artifacts: ${record.evidence.artifacts.map((artifact) => artifact.path).join(', ') || 'none'}`,
    preferenceLine(prefs),
    'Protocol reminder: keep the TASK LOCK current (restate it briefly if it is no longer visible), show `Changed: <previous requirement> -> <corrected requirement>` for amendments, keep one NOW action, report Done/Now/Next/Blocked/Coverage at milestones, and run the completion audit before finishing:',
    fence(auditorInvocation({ record, pluginRoot, dataRoot }).prompt),
  ];
  if (record.phase === 'REPORT_REQUIRED') parts.push(renderBoundedReportInstruction({ record, gaps: record.repair.gaps }));
  if (record.phase === 'DEGRADED_REPORT_REQUIRED') parts.push(renderDegradedReportInstruction({ record, reason: 'verification was already degraded before the interruption' }));
  return parts.join('\n');
}

export function renderRepairInstruction({ record, gaps, pluginRoot, dataRoot }) {
  return [
    `[ADHD] REPAIR ${record.repair.completed} of ${record.repair.maximum} — contract v${record.contractVersion} (digest ${shortDigest(record.requestDigest)}) is NOT complete. Fix only the gaps below, declare any new deliverable files, then re-run the contract auditor with the new nonce and stop.`,
    'Gaps:',
    formatGaps(gaps),
    'Auditor invocation (Agent tool, subagent_type "adhd:contract-auditor"):',
    fence(auditorInvocation({ record, pluginRoot, dataRoot }).prompt),
    'Do not claim completion until every item is PASS. If a gap depends on a fact only the user can supply, have the auditor mark that item BLOCKED and ask the user your single question; the plugin pauses the task when every remaining gap is BLOCKED, and a reply from the user restarts the repair budget.',
  ].join('\n');
}

export function renderBoundedReportInstruction({ record, gaps }) {
  return [
    `[ADHD] REPAIR BUDGET EXHAUSTED (${record.repair.maximum} repairs). Do not claim completion. End with a final report that uses exactly this heading and these four section labels, then stop:`,
    BOUNDED_REPORT_HEADING,
    ...BOUNDED_REPORT_SECTIONS.map((section) => `${section}: <...>`),
    'Remaining gaps to list under "Unresolved items":',
    formatGaps(gaps),
  ].join('\n');
}

export function renderDegradedReportInstruction({ record, reason }) {
  return [
    `[ADHD] VERIFICATION DEGRADED — ${reason}. The plugin cannot verify completion of task ${record.taskId}. Do not claim completion. End with a report that uses exactly this heading and these section labels, then stop:`,
    DEGRADED_REPORT_HEADING,
    ...DEGRADED_REPORT_SECTIONS.map((section) => `${section}: <...>`),
  ].join('\n');
}

export function renderCancelledContext({ record }) {
  return `[ADHD] Task ${record.taskId} is CANCELLED at the user's request. Stop immediately: reply with one short line acknowledging the cancellation; perform no cleanup, deletion, extra revision, or follow-on action; do not summarize unfinished work unless the user asks.`;
}

function reportPresent(text, heading, sections) {
  const body = String(text || '');
  if (!new RegExp(heading.replace(/ /g, '\\s+'), 'i').test(body)) return false;
  return sections.every((section) => new RegExp(`${section.replace(/ /g, '\\s+')}\\s*:`, 'i').test(body));
}

export function boundedReportPresent(text) {
  return reportPresent(text, BOUNDED_REPORT_HEADING, BOUNDED_REPORT_SECTIONS);
}

export function degradedReportPresent(text) {
  return reportPresent(text, DEGRADED_REPORT_HEADING, DEGRADED_REPORT_SECTIONS);
}

export function statusSummary(record) {
  const freshness = auditFreshness(record);
  return {
    sessionId: record.sessionId,
    taskId: record.taskId,
    phase: record.phase,
    mode: record.mode,
    contractVersion: record.contractVersion,
    requestDigest: record.requestDigest,
    originalRequestPreview: record.originalRequest ? record.originalRequest.text.slice(0, 200) : null,
    turns: record.userTurns.length,
    repair: { completed: record.repair.completed, maximum: record.repair.maximum, blocksIssued: record.repair.blocksIssued },
    audit: { fresh: freshness.fresh, reason: freshness.reason, recordedAt: record.audit.receipt ? record.audit.receipt.recordedAt : null, coverage: receiptCoverage(record) },
    gaps: record.repair.gaps,
    evidence: {
      artifacts: record.evidence.artifacts.length,
      commands: record.evidence.commands.length,
      toolEvents: record.evidence.toolEvents.length,
      claims: record.evidence.claims.length,
      sources: record.evidence.sources.length,
      unresolved: record.evidence.unresolved.length,
      activeResearchers: record.evidence.agents.filter((agent) => agent.stoppedAt === null && agent.agentType.endsWith('source-researcher')).length,
    },
    closure: record.closure,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
  };
}

function preferenceDefinitionsText() {
  return Object.entries(PREFERENCE_DEFINITIONS).map(([key, def]) => `- ${key}: ${def.type === 'enum' ? def.values.join(' | ') : def.type === 'boolean' ? 'true | false' : `integer ${def.min}-${def.max}`} (default ${def.default}) — ${def.description}`).join('\n');
}

export function renderControlContext({ command, args = '', record, prefs, pluginRoot, dataRoot, hasTask }) {
  const cwd = record.cwd;
  const cli = (subcommand, extra = '') => cliCommand({ pluginRoot, dataRoot, subcommand, cwd, extra });
  switch (command) {
    case 'status':
      return [
        '[ADHD] /adhd:status requested. Machine state (authoritative for phase, mode, contract version, repairs, and audit):',
        JSON.stringify(statusSummary(record)),
        hasTask
          ? 'Render for the user, in this order and nothing else: Done / Now / Next / Blocked (from your knowledge of the work; say "nothing yet" when true), Coverage <passed>/<total> contract items (from the audit receipt; "not audited yet" when none), Mode, Repairs <completed>/<maximum>, active researchers. Do not invent percentages or time estimates. Do not start new work.'
          : 'There is no active ADHD task. Tell the user so in one line; the next ordinary prompt starts a task.',
      ].join('\n');
    case 'contract':
      return [
        '[ADHD] /adhd:contract requested.',
        hasTask ? headerLine(record) : 'There is no active ADHD task.',
        hasTask ? renderLedger(record) : '',
        hasTask ? 'Show the user: the original request verbatim, each later turn verbatim with its order and time, the mode, and the current TASK LOCK (restate it). Do not start new work.' : 'Tell the user in one line that no task is active.',
      ].join('\n');
    case 'why':
      return [
        '[ADHD] /adhd:why requested. Re-evaluate the most recent restriction or limitation you stated in this conversation. Identify the smallest exact action under review and answer in exactly this form:',
        BOUNDARY_TEMPLATE,
        'Rules: never invent a policy; cite the specific public rule or verified fact when one exists; distinguish platform restriction, law, missing authorization or credential, missing information or tool, technical limitation, and uncertainty; keep all unaffected requested work. If no restriction was stated, say so in one line.',
        hasTask ? renderLedger(record) : '',
      ].join('\n');
    case 'prefs':
      return [
        `[ADHD] /adhd:prefs requested with arguments: ${JSON.stringify(args)}`,
        preferenceLine(prefs),
        'Editable preferences:',
        preferenceDefinitionsText(),
        'Commands (run with the Bash tool; each prints JSON):',
        `- show effective values and sources: ${cli('prefs show')}`,
        `- set a global value: ${cli('prefs set', '--key <key> --value <value>')}`,
        `- set a project override: ${cli('prefs set', '--scope project --key <key> --value <value>')}`,
        `- remove one value: ${cli('prefs unset', '--scope global|project --key <key>')}`,
        `- reset: ${cli('prefs reset', '--scope global|project|all')}`,
        'Interpret the arguments (show | set <key> <value> [--project] | unset <key> [--project] | reset [--project|--global]); run the matching command; then show the user a compact table of key, effective value, and source. Do not store any value the command rejected.',
      ].join('\n');
    case 'data':
      return [
        `[ADHD] /adhd:data requested with arguments: ${JSON.stringify(args)}`,
        'Commands (run with the Bash tool; each prints JSON):',
        `- show: ${cli('data show')}`,
        `- export: ${cli('data export')}`,
        `- delete this session's task records and diagnostics: ${stateCommand({ pluginRoot, dataRoot, sessionId: record.sessionId, subcommand: 'data delete-session' })}`,
        `- delete this project's preferences, sessions, and diagnostics (two steps): ${cli('data delete-project')} shows the exact targets and the required phrase "delete project <projectKey>"; only after the user types that exact phrase, run ${cli('data delete-project', '--confirm "<phrase>"')}`,
        `- delete all plugin data (two steps): ${cli('data delete-all')} shows the exact targets and the required phrase "delete all adhd data"; only after the user types that exact phrase, run ${cli('data delete-all', '--confirm "delete all adhd data"')}`,
        'Rules: show the user the exact targets before any project-wide or all-data deletion; never pass --confirm unless the user typed the exact phrase in this conversation after seeing the targets; report what was deleted or exported with file paths.',
      ].join('\n');
    case 'cancel':
      return hasTask ? renderCancelledContext({ record }) : '[ADHD] No active ADHD task to cancel. Tell the user so in one line.';
    case 'new':
      return '[ADHD] /adhd:new closed the previous task (it is recorded as not complete). The user gave no replacement request yet: ask for it in one line. The next ordinary prompt starts the new task.';
    case 'hyperfocus':
      return '[ADHD] Hyperfocus mode will apply to the next request. Ask the user for the research request in one line.';
    default:
      return `[ADHD] Unknown control command ${command}.`;
  }
}
