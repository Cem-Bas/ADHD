import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { newSessionRecord } from '../../scripts/common/schema.mjs';
import { startTask, appendUserTurn, setMode, recordAuditReceipt } from '../../scripts/common/session.mjs';
import { defaultPreferences } from '../../scripts/common/prefs.mjs';
import { renderTaskLockProtocol, renderRestoreContext, renderRepairInstruction, renderBoundedReportInstruction, boundedReportPresent, degradedReportPresent, waitingOnUser, stateCommand, renderLedger, statusSummary, renderControlContext, BOUNDED_REPORT_HEADING } from '../../scripts/common/render.mjs';
import { passingReceipt } from '../helpers.mjs';

const now = Date.parse('2026-09-27T10:00:00Z');
const prefs = { effective: defaultPreferences(), sources: Object.fromEntries(Object.keys(defaultPreferences()).map((k) => [k, 'default'])) };
const ctx = { prefs, pluginRoot: '/plugins/adhd root', dataRoot: '/data/adhd' };
const make = (text = 'Build "x"\nwith $(sub) and 日本語') => startTask(newSessionRecord({ sessionId: 'sess-1', cwd: '/p', now }), { text, receivedAt: now });
// The rendered command quotes the script path for a POSIX shell, so a win32 path.join result has its backslashes doubled.
const scriptPath = (pluginRoot) => path.join(pluginRoot, 'scripts', 'state.mjs').replace(/\\/g, '\\\\');

test('full protocol carries the verbatim ledger, the Task Lock block, the auditor prompt with nonce, and exact commands', () => {
  const record = make();
  const text = renderTaskLockProtocol({ record, ...ctx, full: true });
  assert.ok(text.includes('Build "x"\nwith $(sub) and 日本語'));
  assert.ok(text.includes('TASK LOCK\nGoal:'));
  assert.ok(text.includes('NOW: <the single current action>'));
  assert.ok(text.includes(`Audit nonce: ${record.audit.nonce}`));
  assert.ok(text.includes('subagent_type "adhd:contract-auditor"'));
  assert.ok(text.includes(`node "${scriptPath(ctx.pluginRoot)}" audit-record --data "/data/adhd" --session "sess-1"`));
  assert.ok(text.includes('artifact-declare --data'));
  assert.ok(text.includes("Pass the JSON as a single-quoted here-string: <command> <<< '<receipt json>' — escape any single quote inside the JSON as '\\''. Do not use a heredoc."));
  assert.equal(text.includes('heredoc is fine'), false);
  assert.ok(text.includes('"taskLockValid":"<true | false>"'));
  assert.equal(text.includes('"taskLockValid":true'), false);
  assert.ok(text.includes('"Stop doing X and do Y" is an amendment'));
  assert.ok(text.includes('Changed: <previous requirement> -> <corrected requirement>'));
  assert.ok(text.includes('Blocked action:'));
  assert.equal(text.includes('HYPERFOCUS'), false);
});

test('the protocol orders answer before audit and the auditor grades the substantive answer, not the newest status line', () => {
  const record = make();
  const full = renderTaskLockProtocol({ record, ...ctx, full: true });
  assert.ok(full.includes('First give the user your complete answer, then invoke the adhd:contract-auditor subagent'));
  assert.ok(full.includes('run no further commands or edits after invoking it'));
  assert.ok(full.includes('reply in one short line and finish'));
  assert.ok(full.includes('a later status-only line (such as "the check is running"'));
  const amended = renderTaskLockProtocol({ record, ...ctx, full: false });
  assert.ok(amended.includes('give your complete answer, then re-run the completion audit as the last action of the turn'));
  const repair = renderRepairInstruction({ record, gaps: [{ code: 'ITEM_PARTIAL', itemId: 'R1', detail: 'x' }], ...ctx });
  assert.ok(repair.includes('restate your complete answer, record it with answer-record, then re-run the contract auditor with the new nonce as the last action'));
  assert.ok(repair.includes('does not retract it'));
});

test('every protocol variant explains WAITING ON YOU, and the detector needs the marker at the start of a line', () => {
  const record = make();
  for (const text of [renderTaskLockProtocol({ record, ...ctx, full: true }), renderTaskLockProtocol({ record, ...ctx, full: false }), renderRepairInstruction({ record, gaps: [{ code: 'AUDIT_MISSING', detail: 'x' }], ...ctx })]) {
    assert.ok(text.includes('`WAITING ON YOU: <your single question>`'));
  }
  assert.equal(waitingOnUser('Searched.\nWAITING ON YOU: what is JEv?'), true);
  assert.equal(waitingOnUser('> **WAITING ON YOU**: which file?'), true);
  assert.equal(waitingOnUser('- WAITING ON YOU: approve the push?'), true);
  assert.equal(waitingOnUser('I am WAITING ON YOU: no'), false);
  assert.equal(waitingOnUser('WAITING ON YOU:'), false);
  assert.equal(waitingOnUser(''), false);
});

test('short protocol omits the Task Lock template but keeps the auditor prompt; machine turns are labelled', () => {
  const record = make();
  appendUserTurn(record, { text: 'also docs', receivedAt: now + 1 });
  const text = renderTaskLockProtocol({ record, ...ctx, full: false });
  assert.equal(text.includes('TASK LOCK\nGoal:'), false);
  assert.ok(text.includes('also docs'));
  assert.ok(text.includes(`Audit nonce: ${record.audit.nonce}`));
  const machine = renderTaskLockProtocol({ record, ...ctx, full: false, machineTurn: true });
  assert.ok(machine.includes('injected by the system'));
});

test('hyperfocus protocol includes the ledger workflow and evidence-add command', () => {
  const record = make('deep research on x');
  setMode(record, 'hyperfocus', now);
  const text = renderTaskLockProtocol({ record, ...ctx, full: true });
  assert.ok(text.includes('HYPERFOCUS MODE IS ON'));
  assert.ok(text.includes('evidence-add --data "/data/adhd" --session "sess-1"'));
  assert.ok(text.includes('"evidenceChainId"'));
  assert.ok(text.includes('up to 4 adhd:source-researcher'));
});

test('ledger clipping keeps every turn present and marks clipped text', () => {
  const record = make('o'.repeat(20000));
  for (let i = 0; i < 5; i += 1) appendUserTurn(record, { text: `turn${i} ${'t'.repeat(5000)}`, receivedAt: now + i });
  const ledger = renderLedger(record);
  assert.ok(ledger.length < 14000);
  assert.ok(ledger.includes('clipped'));
  for (let i = 0; i < 5; i += 1) assert.ok(ledger.includes(`turn${i}`));
});

test('repair and bounded-report instructions list gaps and the report detectors accept markdown', () => {
  const record = make();
  record.repair.completed = 2;
  const gaps = [{ code: 'ITEM_PARTIAL', itemId: 'R2', requirement: 'tests', detail: 'no tests for x' }, { code: 'ARTIFACT_MISSING', detail: 'declared artifact not found: docs/a.md' }];
  const repair = renderRepairInstruction({ record, gaps, ...ctx });
  assert.ok(repair.startsWith('[ADHD] REPAIR 2 of 6'));
  assert.ok(repair.includes('1. [ITEM_PARTIAL] R2 "tests" — no tests for x'));
  assert.ok(repair.includes(record.audit.nonce));
  assert.ok(repair.includes('ask the user that single question instead of re-running the auditor; a reply from the user restarts the repair budget.'));
  assert.equal(repair.includes('pauses the task instead of repairing'), false);
  const bounded = renderBoundedReportInstruction({ record, gaps });
  assert.ok(bounded.includes(BOUNDED_REPORT_HEADING));
  assert.ok(bounded.includes('Smallest next action:'));
  assert.equal(boundedReportPresent('## ADHD BOUNDED STOP REPORT\n**Unresolved items:** a\n**Evidence gathered:** b\n**Exact blocker:** c\n**Smallest next action:** d'), true);
  assert.equal(boundedReportPresent('ADHD BOUNDED STOP REPORT\nUnresolved items: a\nEvidence gathered: b'), false);
  assert.equal(boundedReportPresent(''), false);
  assert.equal(degradedReportPresent('ADHD DEGRADED STOP REPORT\nVerification failure: x\nWork completed without verification: y\nSmallest next action: z'), true);
});

test('restore context names the source, the receipt state, and open gaps', () => {
  const record = make();
  recordAuditReceipt(record, passingReceipt(record), now);
  record.repair.gaps = [{ code: 'ITEM_PARTIAL', itemId: 'R1', detail: 'missing' }];
  const text = renderRestoreContext({ record, ...ctx, source: 'compact' });
  assert.ok(text.includes('restored after compact'));
  assert.ok(text.includes('Audit receipt: fresh (1/1 items PASS)'));
  assert.ok(text.includes('ITEM_PARTIAL R1 — missing'));
  assert.ok(text.includes('do not ask the user to restate it'));
});

test('stateCommand quotes paths and statusSummary exposes the machine state', () => {
  assert.equal(stateCommand({ pluginRoot: '/a b', dataRoot: '/d"q', sessionId: 's', subcommand: 'status' }), `node "${scriptPath('/a b')}" status --data "/d\\"q" --session "s"`);
  const record = make();
  const summary = statusSummary(record);
  assert.deepEqual(Object.keys(summary.repair), ['completed', 'maximum', 'blocksIssued']);
  assert.equal(summary.audit.reason, 'none');
  assert.equal(summary.evidence.activeResearchers, 0);
});

test('control contexts give Claude the exact commands and confirmation rules', () => {
  const record = make();
  const status = renderControlContext({ command: 'status', args: '', record, ...ctx, hasTask: true });
  assert.ok(status.includes('/adhd:status'));
  assert.ok(status.includes('Coverage'));
  const data = renderControlContext({ command: 'data', args: 'delete-all', record, ...ctx, hasTask: true });
  assert.ok(data.includes('delete all adhd data'));
  assert.ok(data.includes('data delete-project --data "/data/adhd" --cwd'));
  const prefsText = renderControlContext({ command: 'prefs', args: 'set outputDetail brief', record, ...ctx, hasTask: true });
  assert.ok(prefsText.includes('prefs set --data "/data/adhd" --cwd'));
  assert.ok(prefsText.includes('outputDetail'));
  const why = renderControlContext({ command: 'why', args: '', record, ...ctx, hasTask: true });
  assert.ok(why.includes('Blocked action:'));
  const noTask = renderControlContext({ command: 'cancel', args: '', record, ...ctx, hasTask: false });
  assert.ok(noTask.includes('No active'));
});

test('ledger rendering stays bounded for long conversations and keeps the latest turns', () => {
  const record = make('short');
  for (let i = 0; i < 100; i += 1) appendUserTurn(record, { text: `turn${i} ${'t'.repeat(3000)}`, receivedAt: now + i });
  const ledger = renderLedger(record);
  assert.ok(ledger.length < 14000, String(ledger.length));
  assert.ok(ledger.includes('turn99'));
  assert.ok(ledger.includes('turn88'));
  assert.equal(ledger.includes('turn87 '), false);
  assert.ok(ledger.includes('turns 1–88 are omitted'));
});

test('the protocol, the amendment reminder, and the auditor prompt use recorded answers', () => {
  const record = make();
  const full = renderTaskLockProtocol({ record, ...ctx, full: true });
  assert.ok(full.includes(`node "${scriptPath(ctx.pluginRoot)}" answer-record --data "/data/adhd" --session "sess-1"`));
  assert.ok(full.includes('question option previews'));
  assert.ok(full.includes('evidence.answers'));
  appendUserTurn(record, { text: 'and this', receivedAt: now + 1 });
  const reminder = renderTaskLockProtocol({ record, ...ctx, full: false });
  assert.ok(reminder.includes('answer-record'));
});

test('the visual check section appears when visualCheck is auto and the auditor is told to view screenshots', () => {
  const record = make();
  const full = renderTaskLockProtocol({ record, ...ctx, full: true });
  assert.ok(full.includes('6b. VISUAL CHECK'));
  for (const sub of ['visual-decide', 'visual-dir', 'visual-record']) assert.ok(full.includes(`node "${scriptPath(ctx.pluginRoot)}" ${sub} --data "/data/adhd" --session "sess-1"`), sub);
  assert.ok(full.includes('PLAYWRIGHT_MISSING'));
  assert.ok(full.includes('1280x800') && full.includes('390x844'));
  assert.ok(full.includes('Never install'));
  assert.ok(full.includes('"method":"browser"'));
  assert.ok(full.includes('open every screenshot'));
  const off = { ...ctx, prefs: { ...prefs, effective: { ...prefs.effective, visualCheck: 'off' } } };
  assert.equal(renderTaskLockProtocol({ record, ...off, full: true }).includes('6b. VISUAL CHECK'), false);
  appendUserTurn(record, { text: 'tweak the button', receivedAt: now + 1 });
  record.evidence.visual.uiTouched.push({ path: '/p/src/A.tsx', toolUseId: 't', at: '2026-09-27T10:00:01.000Z' });
  assert.ok(renderTaskLockProtocol({ record, ...ctx, full: false }).includes('6b. VISUAL CHECK'));
});
