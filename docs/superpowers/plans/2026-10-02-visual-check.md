# Visual Check + Recorded Answers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the "visualize" feature (Claude decides whether a web UI change needs a visual check, runs a Playwright script that saves screenshots, and the Stop hook and auditor enforce it) and fix the audit loop bug where a reply recorded as a summary is invisible to the auditor (`answer-record`).

**Architecture:** Two new evidence fields in the session record (`evidence.visual`, `evidence.answers`) with a schema v1→v2 migration. A new focused module `scripts/common/visual.mjs` owns UI-path detection, the decision, check recording, and the four-plus-one Stop gaps. `state.mjs` gains `answer-record`, `visual-decide`, `visual-dir`, `visual-record`. The protocol text and the auditor instructions tell Claude and the auditor how to use them. The plugin stays dependency-free: Playwright comes from the user's project.

**Tech Stack:** Node ≥ 20.11 ESM, `node:test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-10-02-visual-check-design.md` (with the refinements recorded in its "Implementation refinements" section, added in Task 0).

## Global Constraints

- No new runtime dependencies; `package.json` keeps no `dependencies`.
- Node ≥ 20.11; tests use `node:test` and `node:assert/strict`, run with `npm test`.
- Hooks stay within latency targets: inactive/control p95 < 50 ms, prompt-state p95 < 100 ms (`npm run bench`).
- Session record stays ≤ 2 MiB (`MAX_SESSION_BYTES`).
- Version 0.1.3 in `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`.
- Never kill or restart a dev server; never install Playwright automatically.
- Work on branch `feat/visual-check`; commit after each task with the attribution lines from the session.

## Review Focus

1. **A failing Playwright script recorded as passing.** Claude Code's Bash `tool_response` carries no exit code (observed 2026-10-02: `{stdout, stderr, interrupted, ...}`), so `command.ok` is `true` for most failures. A check passes only when the script's own `result.json` says `passed: true` **and** the command is recorded ok. Test: Task 3 "a result file with passed:false is never ok".
2. **Claude cannot see its own tool-use ids.** `visual-record` must find the script run itself: the latest recorded Bash command whose text contains `<check dir>/check.mjs`. A `method: "browser"` result needs no run but still needs real screenshots. Tests: Task 4 "visual-record finds the run by the check script path and rejects when no run exists"; Task 3 "a browser-method result needs no script run but still needs screenshots".
3. **Same-millisecond edit and check.** `VISUAL_STALE` compares ISO times; an edit with the same timestamp as the check is not stale. Test: Task 3 "an edit at the same instant as the check is not stale".
4. **A blocked check must pause, not burn repair cycles.** `VISUAL_BLOCKED` is treated like `ITEM_BLOCKED` by the Stop hook. Test: Task 5 "a blocked visual check plus a BLOCKED receipt item pauses the task".
5. **Existing v1 session files on disk.** Users upgrading mid-task have v1 records; they must load, gain empty `visual`/`answers`, and save as v2. Test: Task 1 "a v1 record migrates to v2 with empty visual and answers".

---

### Task 0: Record the spec refinements

**Files:**
- Modify: `docs/superpowers/specs/2026-10-02-visual-check-design.md` (append a section)

- [ ] **Step 1: Append this section to the end of the spec**

```markdown
## Implementation refinements (2026-10-02, from code inspection)

- **Pass/fail source.** Claude Code's Bash results carry no exit code, so a recorded command's `ok` is not a reliable pass signal. The script writes `<check dir>/result.json` as `{"passed": bool, "url": string, "screenshots": [abs paths], "failures": [string]}`; a blocked run writes `{"passed": false, "blocked": "PLAYWRIGHT_MISSING: …" | "BROWSER_LAUNCH_FAILED: …" | "APP_UNREACHABLE: …"}`. A check is ok only when `result.passed === true` and the command is recorded ok.
- **Finding the run.** Claude cannot see tool-use ids, so `visual-record` takes `{"resultFile": "<path>"}` and links the latest recorded Bash command whose text contains `<check dir>/check.mjs`. The script must be saved as `check.mjs` in the check directory and run with `node "<check dir>/check.mjs"`.
- **Blocked gap.** A latest check with `blocked` set yields `VISUAL_BLOCKED`, which pauses the task like `ITEM_BLOCKED`.
- **Browser fallback (user decision 2026-10-02).** When the project has no Playwright but Claude Code's own browser tools are available (Claude in Chrome, Playwright MCP), Claude drives the browser itself, saves the PNG screenshots into the check directory, and writes `result.json` with `"method": "browser"`. Such a check needs no script run (`toolUseId: null`); its pass/fail is the worker's own statement, so the auditor's screenshot review is the deciding evidence. The task pauses only when neither the script nor the browser tools can run.
- **Recorded answers (loop-bug fix).** A reply written just before a tool call can be stored in the transcript only as a short summary, so the auditor missed answers that were given. Claude records each complete answer with `state.mjs answer-record` (`{"answer": "<text>"}`), stored in `evidence.answers` (20 entries, 20 000 characters each), and the auditor reads it before the transcript. The protocol also tells Claude to put content the user must read or approve in the final message of the turn or in question option previews.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-10-02-visual-check-design.md
git commit -m "docs: record visual check implementation refinements"
```

---

### Task 1: Schema v2, migration, and the visualCheck preference

**Files:**
- Modify: `scripts/common/schema.mjs`
- Modify: `scripts/common/prefs.mjs:5-16`
- Test: `tests/unit/schema.test.mjs`, `tests/unit/prefs.test.mjs:10`

**Interfaces:**
- Produces: `SCHEMA_VERSION = 2`; `emptyVisual(): {decision: null, uiTouched: [], checks: []}`; `emptyEvidence()` now includes `visual` and `answers: []`; `migrateSessionRecord(v1)` returns `{ok: true, migrated: true, record: v2}`; preference `visualCheck` (`auto` | `off`, default `auto`).

- [ ] **Step 1: Replace the migration test and add visual validation tests in `tests/unit/schema.test.mjs`**

Replace the test `'migration accepts v1, rejects newer and unknown versions'` with:

```js
test('a v1 record migrates to v2 with empty visual and answers; newer and unknown versions are rejected', () => {
  const record = newSessionRecord({ sessionId: 'abc', cwd: '/p', now });
  assert.equal(record.schemaVersion, 2);
  assert.deepEqual(migrateSessionRecord(record), { ok: true, record, migrated: false });
  const v1 = structuredClone(record);
  v1.schemaVersion = 1;
  delete v1.evidence.visual;
  delete v1.evidence.answers;
  const migrated = migrateSessionRecord(v1);
  assert.equal(migrated.ok, true);
  assert.equal(migrated.migrated, true);
  assert.equal(migrated.record.schemaVersion, 2);
  assert.deepEqual(migrated.record.evidence.visual, { decision: null, uiTouched: [], checks: [] });
  assert.deepEqual(migrated.record.evidence.answers, []);
  assert.deepEqual(validateSessionRecord(migrated.record), { ok: true, errors: [] });
  assert.equal(migrateSessionRecord({ ...record, schemaVersion: 3 }).ok, false);
  assert.equal(migrateSessionRecord({ ...record, schemaVersion: 'x' }).ok, false);
  assert.equal(migrateSessionRecord('nope').ok, false);
});

test('evidence.visual and evidence.answers are validated', () => {
  const record = newSessionRecord({ sessionId: 'abc', cwd: '/p', now });
  record.evidence.visual.decision = { needed: true, reason: 'signup form', at: '2026-10-02T10:00:00.000Z' };
  assert.equal(validateSessionRecord(record).ok, true);
  record.evidence.visual.decision = { needed: 'yes', reason: 'x', at: '2026-10-02T10:00:00.000Z' };
  assert.ok(validateSessionRecord(record).errors.includes('evidence.visual.decision malformed'));
  record.evidence.visual = { decision: null, uiTouched: 'no', checks: [] };
  assert.ok(validateSessionRecord(record).errors.includes('evidence.visual malformed'));
  record.evidence.visual = { decision: null, uiTouched: [], checks: [] };
  record.evidence.answers = 'no';
  assert.ok(validateSessionRecord(record).errors.includes('evidence.answers must be an array'));
});
```

In `tests/unit/prefs.test.mjs` line 10, add `visualCheck: 'auto'` to the expected defaults object (after `retentionDays: 30,`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/unit/schema.test.mjs tests/unit/prefs.test.mjs`
Expected: FAIL (`record.schemaVersion` is 1; `visualCheck` missing).

- [ ] **Step 3: Implement in `scripts/common/schema.mjs`**

Change line 1 to `export const SCHEMA_VERSION = 2;` and line 17 to:

```js
const EVIDENCE_KEYS = ['artifacts', 'commands', 'toolEvents', 'claims', 'sources', 'unresolved', 'agents', 'dropped', 'visual', 'answers'];
const OBJECT_EVIDENCE_KEYS = new Set(['dropped', 'visual']);
```

Replace `emptyEvidence`:

```js
export function emptyVisual() {
  return { decision: null, uiTouched: [], checks: [] };
}

export function emptyEvidence() {
  return { artifacts: [], commands: [], toolEvents: [], claims: [], sources: [], unresolved: [], agents: [], dropped: { toolEvents: 0 }, visual: emptyVisual(), answers: [] };
}
```

In `validateSessionRecord`, replace the evidence block (lines 97-101) with:

```js
  else {
    for (const key of Object.keys(record.evidence)) if (!EVIDENCE_KEYS.includes(key)) errors.push(`unknown evidence field: ${key}`);
    for (const key of EVIDENCE_KEYS) if (!OBJECT_EVIDENCE_KEYS.has(key) && !Array.isArray(record.evidence[key])) errors.push(`evidence.${key} must be an array`);
    if (!isPlainObject(record.evidence.dropped) || !Number.isInteger(record.evidence.dropped.toolEvents)) errors.push('evidence.dropped malformed');
    const visual = record.evidence.visual;
    if (!isPlainObject(visual) || !Array.isArray(visual.uiTouched) || !Array.isArray(visual.checks)) errors.push('evidence.visual malformed');
    else if (!(visual.decision === null || (isPlainObject(visual.decision) && typeof visual.decision.needed === 'boolean' && typeof visual.decision.reason === 'string' && isIso(visual.decision.at)))) errors.push('evidence.visual.decision malformed');
  }
```

Replace `migrateSessionRecord`:

```js
export function migrateSessionRecord(record) {
  if (!isPlainObject(record)) return { ok: false, error: 'record is not an object' };
  if (record.schemaVersion === SCHEMA_VERSION) return { ok: true, record, migrated: false };
  if (record.schemaVersion === 1) {
    const evidence = isPlainObject(record.evidence) ? record.evidence : {};
    return { ok: true, migrated: true, record: { ...record, schemaVersion: SCHEMA_VERSION, evidence: { ...evidence, visual: emptyVisual(), answers: [] } } };
  }
  if (typeof record.schemaVersion === 'number' && record.schemaVersion > SCHEMA_VERSION) return { ok: false, error: `schemaVersion ${record.schemaVersion} is newer than supported ${SCHEMA_VERSION}` };
  return { ok: false, error: `unsupported schemaVersion ${String(record.schemaVersion)}` };
}
```

In `scripts/common/prefs.mjs`, add after the `retentionDays` line:

```js
  visualCheck: { type: 'enum', values: ['auto', 'off'], default: 'auto', description: 'Whether Claude decides and runs visual UI checks' },
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS (all previous tests plus the new ones). `tests/unit/store.test.mjs` writes a malformed v1 file; it still ends quarantined because validation fails after migration.

- [ ] **Step 5: Commit**

```bash
git add scripts/common/schema.mjs scripts/common/prefs.mjs tests/unit/schema.test.mjs tests/unit/prefs.test.mjs
git commit -m "feat: schema v2 with visual and answers evidence, visualCheck preference"
```

---

### Task 2: `answer-record` (loop-bug fix)

**Files:**
- Modify: `scripts/common/session.mjs` (add `recordAnswer`, extend `computeEvidenceDigest`)
- Modify: `scripts/state.mjs` (command `answer-record`)
- Modify: `scripts/common/render.mjs` (protocol item 7, amendment reminder, repair instruction, auditor prompt step 2)
- Modify: `agents/contract-auditor.md` (procedure step 2)
- Test: `tests/unit/session.test.mjs`, `tests/integration/state-cli.test.mjs`, `tests/unit/render.test.mjs`

**Interfaces:**
- Consumes: `emptyEvidence().answers` from Task 1.
- Produces: `recordAnswer(record, text, at)`; CLI `answer-record` with stdin `{"answer": string}` → `{ok, contractVersion, answers}`; render constant `ANSWER_RULE`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/session.test.mjs` (add `recordAnswer` to the session import):

```js
test('recordAnswer stores the answer with its contract version, caps size and count, and changes the evidence digest', () => {
  const record = fresh();
  const before = computeEvidenceDigest(record);
  recordAnswer(record, 'The answer is no, because X.', now);
  assert.deepEqual(record.evidence.answers[0], { contractVersion: 1, text: 'The answer is no, because X.', truncated: false, at: '2026-09-27T10:00:00.000Z' });
  assert.notEqual(computeEvidenceDigest(record), before);
  recordAnswer(record, 'x'.repeat(20_050), now);
  assert.deepEqual([record.evidence.answers[1].text.length, record.evidence.answers[1].truncated], [20_000, true]);
  for (let i = 0; i < 25; i += 1) recordAnswer(record, `a${i}`, now);
  assert.equal(record.evidence.answers.length, 20);
  assert.equal(record.evidence.answers.at(-1).text, 'a24');
  assert.throws(() => recordAnswer(record, '   ', now), /INVALID_ANSWER|non-empty/);
  assert.throws(() => recordAnswer(record, 42, now), /INVALID_ANSWER|non-empty/);
});
```

Append to `tests/integration/state-cli.test.mjs`:

```js
test('answer-record stores the answer for the open task and rejects empty input', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  runHook('prompt', root, promptInput({ prompt: 'should we use dots?', cwd }));
  const ok = runState(root, 'answer-record', { args: ['--session', 'sess-test-1'], input: { answer: "No: it can't give an exit code." } }).json;
  assert.deepEqual([ok.ok, ok.contractVersion, ok.answers], [true, 1, 1]);
  assert.equal(readSession(root, 'sess-test-1').evidence.answers[0].text, "No: it can't give an exit code.");
  const empty = runState(root, 'answer-record', { args: ['--session', 'sess-test-1'], input: { answer: '' } });
  assert.deepEqual([empty.status, empty.json.error.code], [1, 'INVALID_ANSWER']);
});
```

Append to `tests/unit/render.test.mjs`:

```js
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/unit/session.test.mjs tests/integration/state-cli.test.mjs tests/unit/render.test.mjs`
Expected: FAIL (`recordAnswer` is not exported; `answer-record` is an unknown command; text missing).

- [ ] **Step 3: Implement**

In `scripts/common/session.mjs`, after `const MAX_AGENTS = 100;` add:

```js
const MAX_ANSWERS = 20;
const MAX_ANSWER_CHARS = 20_000;
```

In `computeEvidenceDigest`, add after the `unresolved` line:

```js
    answers: evidence.answers.map((answer) => [answer.contractVersion, answer.text]),
```

After `declareArtifacts`, add:

```js
export function recordAnswer(record, text, at) {
  if (typeof text !== 'string' || text.trim() === '') throw new AdhdError('INVALID_ANSWER', 'answer must be a non-empty string');
  const answers = record.evidence.answers;
  answers.push({ contractVersion: record.contractVersion, text: text.slice(0, MAX_ANSWER_CHARS), truncated: text.length > MAX_ANSWER_CHARS, at: iso(at) });
  if (answers.length > MAX_ANSWERS) answers.splice(0, answers.length - MAX_ANSWERS);
  return record;
}
```

In `scripts/state.mjs`, import `recordAnswer` from `./common/session.mjs` and add to `commands` after `artifact-declare`:

```js
  async 'answer-record'({ root, flags, now }) {
    const sessionId = resolveSessionId(root, flags);
    const payload = await readStdinJson();
    return mutateOpen(root, sessionId, now, (record) => {
      recordAnswer(record, payload && payload.answer, now);
      return { result: { ok: true, contractVersion: record.contractVersion, answers: record.evidence.answers.length } };
    });
  },
```

In `scripts/common/render.mjs`:

After the `WAITING_RULE` constant add:

```js
const SUMMARY_RULE = 'Text written just before a tool call may reach the user only as a short summary. Put anything the user must read or approve in the final message of the turn, or in question option previews.';

function answerRule(answerCommand) {
  return `Record your complete answer before the audit (JSON on stdin; escape single quotes as '\\''): ${answerCommand} <<< '{"answer":"<the full answer you gave the user>"}'`;
}
```

In `renderTaskLockProtocol`, after the existing `evidenceCommand` line add:

```js
  const answerCommand = stateCommand({ pluginRoot, dataRoot, sessionId: record.sessionId, subcommand: 'answer-record' });
```

In the full protocol, insert after `WAITING_RULE,`:

```js
      SUMMARY_RULE,
```

and after the `'7. COMPLETION AUDIT …'` line's fence (i.e. right after `fence(auditor.prompt),`), insert:

```js
      answerRule(answerCommand),
```

In the amendment-reminder branch, after `WAITING_RULE,` insert:

```js
      answerRule(answerCommand),
```

In `renderRepairInstruction`, change `restate your complete answer, then re-run` to `restate your complete answer, record it with answer-record, then re-run`.

In `auditorInvocation`, replace the step-2 continuation line (the one starting `'   When a requirement is to tell the user something`) with:

```js
    '   When a requirement is to tell the user something, read evidence.answers in the state file first (each entry is an answer the worker recorded, with its contract version), then search every assistant reply since the request it belongs to: the latest substantive answer counts, and a later status-only line (such as "the check is running" or a one-line acknowledgement of an audit report) does not retract it. A reply may appear in the transcript only as a short summary; the recorded answer is the full text.',
```

In `agents/contract-auditor.md`, replace the step-2 continuation line (starting `   When a requirement is to tell the user something`) with:

```markdown
   When a requirement is to tell the user something (a verdict, an explanation, an answer), read `evidence.answers` in the state file first: each entry is an answer the worker recorded, with its contract version. Then search every assistant reply since the request it belongs to, not only the newest one. The latest substantive answer counts; a later status-only line such as "the check is running" or a one-line acknowledgement of an audit report does not retract it. A reply may appear in the transcript only as a short summary; the recorded answer is the full text.
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/common/session.mjs scripts/state.mjs scripts/common/render.mjs agents/contract-auditor.md tests/unit/session.test.mjs tests/integration/state-cli.test.mjs tests/unit/render.test.mjs
git commit -m "fix: let the auditor read recorded answers instead of relying on transcript text"
```

---

### Task 3: Visual core module

**Files:**
- Create: `scripts/common/visual.mjs`
- Modify: `scripts/common/session.mjs` (`recordToolEvent` notes UI edits; digest includes visual)
- Test: Create `tests/unit/visual.test.mjs`

**Interfaces:**
- Consumes: `emptyVisual()` (Task 1), `record.evidence.commands[]` entries `{toolUseId, command, exitStatus, ok, at}`.
- Produces (exports of `scripts/common/visual.mjs`):
  - `isUiPath(file: string): boolean`
  - `noteUiEdits(record, event): record`
  - `recordVisualDecision(record, {needed, reason}, at): record`
  - `recordVisualCheck(record, {resultFile}, {at, fileExists, readJson}): check` where `check = {method: 'script'|'browser', toolUseId: string|null, url, screenshots, ok, blocked, failures, at}`
  - `visualGaps(record, {fileExists}): Array<{code, detail}>` with codes `VISUAL_UNDECIDED`, `VISUAL_BLOCKED`, `VISUAL_MISSING`, `VISUAL_STALE`, `VISUAL_SCREENSHOT_MISSING`
  - `visualSummary(record): string` (`''` or ` · UI verified (<n> screenshots)`)

- [ ] **Step 1: Write the failing tests in `tests/unit/visual.test.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { newSessionRecord, validateSessionRecord } from '../../scripts/common/schema.mjs';
import { startTask, recordToolEvent, computeEvidenceDigest } from '../../scripts/common/session.mjs';
import { summarizeToolEvent } from '../../scripts/common/evidence.mjs';
import { isUiPath, recordVisualDecision, recordVisualCheck, visualGaps, visualSummary } from '../../scripts/common/visual.mjs';

const now = Date.parse('2026-10-02T10:00:00Z');
const DIR = '/data/visual/s/t1';
const fresh = (snapshot = {}) => startTask(newSessionRecord({ sessionId: 's', cwd: '/p', now }), { text: 'build a signup page', receivedAt: now, preferencesSnapshot: { repairCycles: 6, retentionDays: 30, ...snapshot } });
const event = (toolName, toolInput, at = now, id = `toolu_${toolName}_${at}`) => summarizeToolEvent({ hook_event_name: 'PostToolUse', tool_name: toolName, tool_use_id: id, tool_input: toolInput, tool_response: { stdout: '' } }, { now: at });
const runScript = (record, at = now + 1000) => recordToolEvent(record, event('Bash', { command: `cd /p && node "${DIR}/check.mjs"` }, at, 'toolu_run'), at);
const files = (...paths) => { const set = new Set(paths); return (p) => set.has(p); };
const json = (value) => () => ({ status: 'ok', value });
const shots = [`${DIR}/signup-desktop.png`, `${DIR}/signup-phone.png`];

test('isUiPath recognises UI files and ignores tests, builds, and backend code', () => {
  for (const p of ['src/App.tsx', 'index.html', 'styles/site.scss', 'src/components/Button.js', 'app/routes/home.ts', 'web/Page.vue', 'x/Card.svelte', 'C:\\proj\\src\\Login.jsx']) assert.equal(isUiPath(p), true, p);
  for (const p of ['src/server.ts', 'src/App.test.tsx', 'src/__tests__/a.tsx', 'node_modules/x/a.css', 'dist/app.css', 'README.md', 'scripts/build.js', '', 42]) assert.equal(isUiPath(p), false, String(p));
});

test('successful UI edits are tracked once per path in order; failed edits and non-UI files are not', () => {
  const record = fresh();
  recordToolEvent(record, event('Write', { file_path: '/p/src/App.tsx' }, now + 1), now + 1);
  recordToolEvent(record, event('Edit', { file_path: '/p/src/server.ts' }, now + 2), now + 2);
  recordToolEvent(record, event('Edit', { file_path: '/p/src/Form.css' }, now + 3), now + 3);
  recordToolEvent(record, event('Edit', { file_path: '/p/src/App.tsx' }, now + 4), now + 4);
  const failed = { ...event('Edit', { file_path: '/p/src/Nav.tsx' }, now + 5), ok: false };
  recordToolEvent(record, failed, now + 5);
  assert.deepEqual(record.evidence.visual.uiTouched.map((e) => e.path), ['/p/src/Form.css', '/p/src/App.tsx']);
  assert.equal(validateSessionRecord(record).ok, true);
});

test('recordVisualDecision requires a boolean and a 1-300 character reason', () => {
  const record = fresh();
  recordVisualDecision(record, { needed: true, reason: ' added /signup ' }, now);
  assert.deepEqual(record.evidence.visual.decision, { needed: true, reason: 'added /signup', at: '2026-10-02T10:00:00.000Z' });
  assert.throws(() => recordVisualDecision(record, { needed: 'yes', reason: 'x' }, now), /needed/);
  assert.throws(() => recordVisualDecision(record, { needed: false, reason: '' }, now), /reason/);
  assert.throws(() => recordVisualDecision(record, { needed: false, reason: 'x'.repeat(301) }, now), /reason/);
});

test('recordVisualCheck links the latest run of check.mjs and requires real screenshots', () => {
  const record = fresh();
  assert.throws(() => recordVisualCheck(record, { resultFile: `${DIR}/result.json` }, { at: now, fileExists: files(...shots), readJson: json({ passed: true, screenshots: shots }) }), /no recorded run/);
  runScript(record);
  const check = recordVisualCheck(record, { resultFile: `${DIR}/result.json` }, { at: now + 2000, fileExists: files(...shots), readJson: json({ passed: true, url: 'http://localhost:5173/signup', screenshots: shots, failures: [] }) });
  assert.deepEqual(check, { method: 'script', toolUseId: 'toolu_run', url: 'http://localhost:5173/signup', screenshots: shots, ok: true, blocked: null, failures: [], at: '2026-10-02T10:00:02.000Z' });
  assert.throws(() => recordVisualCheck(record, { resultFile: `${DIR}/result.json` }, { at: now, fileExists: files(shots[0]), readJson: json({ passed: true, screenshots: shots }) }), /screenshot/);
  assert.throws(() => recordVisualCheck(record, { resultFile: `${DIR}/result.json` }, { at: now, fileExists: files('/x.gif'), readJson: json({ passed: true, screenshots: ['/x.gif'] }) }), /screenshot/);
  assert.throws(() => recordVisualCheck(record, { resultFile: `${DIR}/result.json` }, { at: now, fileExists: files(), readJson: json({ passed: true, screenshots: [] }) }), /screenshots/);
  assert.throws(() => recordVisualCheck(record, { resultFile: `${DIR}/result.json` }, { at: now, fileExists: files(), readJson: () => ({ status: 'missing' }) }), /result file/);
});

test('a browser-method result needs no script run but still needs screenshots', () => {
  const record = fresh();
  const check = recordVisualCheck(record, { resultFile: `${DIR}/result.json` }, { at: now + 2000, fileExists: files(...shots), readJson: json({ method: 'browser', passed: true, url: 'http://localhost:3000', screenshots: shots }) });
  assert.deepEqual([check.method, check.toolUseId, check.ok], ['browser', null, true]);
  assert.throws(() => recordVisualCheck(record, { resultFile: `${DIR}/result.json` }, { at: now, fileExists: files(), readJson: json({ method: 'browser', passed: true, screenshots: shots }) }), /screenshot/);
  assert.throws(() => recordVisualCheck(record, { resultFile: `${DIR}/result.json` }, { at: now, fileExists: files(...shots), readJson: json({ method: 'magic', passed: true, screenshots: shots }) }), /method/);
});

test('a result file with passed:false is never ok, even when the command is recorded ok', () => {
  const record = fresh();
  runScript(record);
  const check = recordVisualCheck(record, { resultFile: `${DIR}/result.json` }, { at: now + 2000, fileExists: files(...shots), readJson: json({ passed: false, screenshots: shots, failures: ['error text not shown'] }) });
  assert.deepEqual([check.ok, check.failures], [false, ['error text not shown']]);
});

test('a blocked result is recorded without screenshots and only with a known prefix', () => {
  const record = fresh();
  runScript(record);
  const check = recordVisualCheck(record, { resultFile: `${DIR}/result.json` }, { at: now + 2000, fileExists: files(), readJson: json({ passed: false, blocked: 'PLAYWRIGHT_MISSING: install with npm i -D playwright && npx playwright install chromium' }) });
  assert.deepEqual([check.ok, check.blocked.startsWith('PLAYWRIGHT_MISSING'), check.screenshots], [false, true, []]);
  assert.throws(() => recordVisualCheck(record, { resultFile: `${DIR}/result.json` }, { at: now, fileExists: files(), readJson: json({ passed: false, blocked: 'I gave up' }) }), /screenshots/);
});

test('visualGaps covers undecided, not needed, blocked, missing, failed, passing, stale, and deleted screenshots', () => {
  const record = fresh();
  assert.deepEqual(visualGaps(record, { fileExists: files() }), []);
  recordToolEvent(record, event('Write', { file_path: '/p/src/Signup.tsx' }, now + 100), now + 100);
  assert.deepEqual(visualGaps(record, { fileExists: files() }).map((g) => g.code), ['VISUAL_UNDECIDED']);
  recordVisualDecision(record, { needed: false, reason: 'comment-only change' }, now + 200);
  assert.deepEqual(visualGaps(record, { fileExists: files() }), []);
  recordVisualDecision(record, { needed: true, reason: 'new signup form' }, now + 300);
  assert.deepEqual(visualGaps(record, { fileExists: files() }).map((g) => g.code), ['VISUAL_MISSING']);
  runScript(record, now + 400);
  recordVisualCheck(record, { resultFile: `${DIR}/result.json` }, { at: now + 500, fileExists: files(...shots), readJson: json({ passed: false, screenshots: shots, failures: ['button missing'] }) });
  const failed = visualGaps(record, { fileExists: files(...shots) });
  assert.deepEqual([failed[0].code, failed[0].detail.includes('button missing')], ['VISUAL_MISSING', true]);
  recordVisualCheck(record, { resultFile: `${DIR}/result.json` }, { at: now + 600, fileExists: files(...shots), readJson: json({ passed: true, screenshots: shots }) });
  assert.deepEqual(visualGaps(record, { fileExists: files(...shots) }), []);
  assert.equal(visualSummary(record), ' · UI verified (2 screenshots)');
  assert.deepEqual(visualGaps(record, { fileExists: files(shots[0]) }).map((g) => g.code), ['VISUAL_SCREENSHOT_MISSING']);
  recordToolEvent(record, event('Edit', { file_path: '/p/src/Signup.tsx' }, now + 700), now + 700);
  const stale = visualGaps(record, { fileExists: files(...shots) });
  assert.deepEqual([stale[0].code, stale[0].detail.includes('/p/src/Signup.tsx')], ['VISUAL_STALE', true]);
  recordVisualCheck(record, { resultFile: `${DIR}/result.json` }, { at: now + 800, fileExists: files(), readJson: json({ passed: false, blocked: 'APP_UNREACHABLE: http://localhost:5173' }) });
  assert.deepEqual(visualGaps(record, { fileExists: files(...shots) }).map((g) => g.code), ['VISUAL_BLOCKED']);
});

test('an edit at the same instant as the check is not stale', () => {
  const record = fresh();
  recordVisualDecision(record, { needed: true, reason: 'form' }, now);
  runScript(record, now + 10);
  recordVisualCheck(record, { resultFile: `${DIR}/result.json` }, { at: now + 20, fileExists: files(...shots), readJson: json({ passed: true, screenshots: shots }) });
  recordToolEvent(record, event('Edit', { file_path: '/p/src/a.css' }, now + 20), now + 20);
  assert.deepEqual(visualGaps(record, { fileExists: files(...shots) }), []);
});

test('visualCheck=off disables every visual gap', () => {
  const record = fresh({ visualCheck: 'off' });
  recordToolEvent(record, event('Write', { file_path: '/p/index.html' }, now + 1), now + 1);
  assert.deepEqual(visualGaps(record, { fileExists: files() }), []);
  assert.equal(visualSummary(record), '');
});

test('a new decision or check changes the evidence digest', () => {
  const record = fresh();
  const a = computeEvidenceDigest(record);
  recordVisualDecision(record, { needed: true, reason: 'form' }, now);
  const b = computeEvidenceDigest(record);
  runScript(record);
  recordVisualCheck(record, { resultFile: `${DIR}/result.json` }, { at: now + 2000, fileExists: files(...shots), readJson: json({ passed: true, screenshots: shots }) });
  const c = computeEvidenceDigest(record);
  assert.notEqual(a, b);
  assert.notEqual(b, c);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/unit/visual.test.mjs`
Expected: FAIL with "Cannot find module '.../scripts/common/visual.mjs'".

- [ ] **Step 3: Create `scripts/common/visual.mjs`**

```js
import path from 'node:path';
import { AdhdError } from './errors.mjs';

const UI_EXTENSIONS = new Set(['.html', '.htm', '.css', '.scss', '.sass', '.less', '.jsx', '.tsx', '.vue', '.svelte', '.astro']);
const UI_SCRIPT_EXTENSIONS = new Set(['.js', '.ts', '.mjs']);
const UI_SCRIPT_DIRS = new Set(['components', 'pages', 'app', 'views', 'layouts', 'routes']);
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'build', '.next', 'coverage', '__tests__']);
const UI_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const BLOCKED_PREFIXES = ['PLAYWRIGHT_MISSING', 'BROWSER_LAUNCH_FAILED', 'APP_UNREACHABLE'];
const METHODS = ['script', 'browser'];
const MAX_UI_TOUCHED = 200;
const MAX_CHECKS = 50;
const MAX_SCREENSHOTS = 40;
export const CHECK_SCRIPT = 'check.mjs';
export const RESULT_FILE = 'result.json';

const invalid = (message) => new AdhdError('INVALID_VISUAL', message);
const iso = (at) => new Date(at).toISOString();
const visualOff = (record) => record.preferencesSnapshot && record.preferencesSnapshot.visualCheck === 'off';

export function isUiPath(file) {
  if (typeof file !== 'string' || file === '') return false;
  const parts = file.replace(/\\/g, '/').split('/').filter(Boolean);
  const name = parts.at(-1) || '';
  const dirs = parts.slice(0, -1);
  if (dirs.some((part) => EXCLUDED_DIRS.has(part))) return false;
  if (/\.(test|spec)\.[^.]+$/.test(name)) return false;
  const ext = path.extname(name).toLowerCase();
  if (UI_EXTENSIONS.has(ext)) return true;
  return UI_SCRIPT_EXTENSIONS.has(ext) && dirs.some((part) => UI_SCRIPT_DIRS.has(part));
}

// Called for every captured tool event; only successful edits of UI files count.
export function noteUiEdits(record, event) {
  if (!UI_EDIT_TOOLS.has(event.toolName) || !event.ok) return record;
  const touched = record.evidence.visual.uiTouched;
  for (const file of event.paths || []) {
    if (!isUiPath(file)) continue;
    const index = touched.findIndex((entry) => entry.path === file);
    if (index !== -1) touched.splice(index, 1);
    touched.push({ path: file, toolUseId: event.toolUseId, at: event.at });
  }
  if (touched.length > MAX_UI_TOUCHED) touched.splice(0, touched.length - MAX_UI_TOUCHED);
  return record;
}

export function recordVisualDecision(record, payload, at) {
  if (!payload || typeof payload.needed !== 'boolean') throw invalid('needed must be true or false');
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  if (reason === '' || reason.length > 300) throw invalid('reason must be 1-300 characters');
  record.evidence.visual.decision = { needed: payload.needed, reason, at: iso(at) };
  return record;
}

// Claude cannot see tool-use ids, so the run is found by the check script path in the recorded command text.
function findRun(record, checkDir) {
  const needle = `${checkDir.replace(/\\/g, '/')}/${CHECK_SCRIPT}`;
  return record.evidence.commands.findLast((entry) => typeof entry.command === 'string' && entry.command.replace(/\\/g, '/').includes(needle));
}

export function recordVisualCheck(record, payload, { at, fileExists, readJson }) {
  if (!payload || typeof payload.resultFile !== 'string' || payload.resultFile.trim() === '') throw invalid('resultFile must be the path of result.json');
  const loaded = readJson(payload.resultFile);
  const result = loaded && loaded.status === 'ok' ? loaded.value : null;
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw invalid(`result file is missing or not a JSON object: ${payload.resultFile}`);
  const method = result.method === undefined ? 'script' : result.method;
  if (!METHODS.includes(method)) throw invalid(`method must be one of ${METHODS.join(', ')}`);
  // A browser-tools check has no script run; its screenshots are the evidence the auditor grades.
  const command = method === 'script' ? findRun(record, path.dirname(payload.resultFile)) : null;
  if (method === 'script' && !command) throw invalid(`no recorded run of ${path.join(path.dirname(payload.resultFile), CHECK_SCRIPT)}; run the script with Bash first`);
  const blocked = typeof result.blocked === 'string' && BLOCKED_PREFIXES.some((prefix) => result.blocked.startsWith(prefix)) ? result.blocked.slice(0, 300) : null;
  const screenshots = Array.isArray(result.screenshots) ? result.screenshots : [];
  if (!blocked) {
    if (screenshots.length === 0 || screenshots.length > MAX_SCREENSHOTS) throw invalid(`screenshots must list 1-${MAX_SCREENSHOTS} files`);
    for (const shot of screenshots) {
      if (typeof shot !== 'string' || !/\.(png|jpe?g)$/i.test(shot) || !fileExists(shot)) throw invalid(`screenshot not found or not a .png/.jpg file: ${String(shot)}`);
    }
  }
  const check = {
    method,
    toolUseId: command ? command.toolUseId : null,
    url: typeof result.url === 'string' ? result.url.slice(0, 500) : '',
    screenshots: blocked ? [] : screenshots,
    ok: !blocked && (command === null || command.ok === true) && result.passed === true,
    blocked,
    failures: Array.isArray(result.failures) ? result.failures.slice(0, 20).map((failure) => String(failure).slice(0, 300)) : [],
    at: iso(at),
  };
  const checks = record.evidence.visual.checks;
  checks.push(check);
  if (checks.length > MAX_CHECKS) checks.splice(0, checks.length - MAX_CHECKS);
  return check;
}

export function visualGaps(record, { fileExists }) {
  if (visualOff(record)) return [];
  const visual = record.evidence.visual;
  if (!visual.decision) {
    if (visual.uiTouched.length === 0) return [];
    return [{ code: 'VISUAL_UNDECIDED', detail: `UI files changed (${visual.uiTouched.slice(-3).map((entry) => entry.path).join(', ')}) but no visual-check decision was recorded; run visual-decide` }];
  }
  if (!visual.decision.needed) return [];
  const latest = visual.checks.at(-1);
  if (latest && latest.blocked) return [{ code: 'VISUAL_BLOCKED', detail: `the visual check could not run: ${latest.blocked}` }];
  const passing = visual.checks.findLast((check) => check.ok);
  if (!passing) {
    const detail = latest ? `the latest visual check failed: ${latest.failures.join('; ') || 'see the script output'}` : 'a visual check is needed but none was recorded; write and run the Playwright check script, then visual-record';
    return [{ code: 'VISUAL_MISSING', detail }];
  }
  const gaps = [];
  const lastEdit = visual.uiTouched.at(-1);
  if (lastEdit && Date.parse(lastEdit.at) > Date.parse(passing.at)) gaps.push({ code: 'VISUAL_STALE', detail: `re-run the visual check: ${lastEdit.path} changed after the last passing run` });
  const missing = passing.screenshots.filter((shot) => !fileExists(shot));
  if (missing.length > 0) gaps.push({ code: 'VISUAL_SCREENSHOT_MISSING', detail: `screenshot(s) no longer exist: ${missing.slice(0, 3).join(', ')}` });
  return gaps;
}

export function visualSummary(record) {
  if (visualOff(record)) return '';
  const visual = record.evidence.visual;
  if (!visual.decision || !visual.decision.needed) return '';
  const passing = visual.checks.findLast((check) => check.ok);
  return passing ? ` · UI verified (${passing.screenshots.length} screenshots)` : '';
}
```

In `scripts/common/session.mjs`:
- add `import { noteUiEdits } from './visual.mjs';`
- in `recordToolEvent`, before `return record;` add `noteUiEdits(record, event);`
- in `computeEvidenceDigest`, add after the `answers` line:

```js
    visual: [evidence.visual.decision ? [evidence.visual.decision.needed, evidence.visual.decision.reason] : null, evidence.visual.checks.map((check) => [check.toolUseId, check.ok, check.blocked, check.at])],
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/common/visual.mjs scripts/common/session.mjs tests/unit/visual.test.mjs
git commit -m "feat: visual check core (UI edit tracking, decision, check recording, gaps)"
```

---

### Task 4: CLI commands, data paths, retention

**Files:**
- Modify: `scripts/common/paths.mjs` (`dataPaths().visual`, `visualDir`)
- Modify: `scripts/state.mjs` (`visual-decide`, `visual-dir`, `visual-record`; delete-session and delete-all also remove visual files)
- Modify: `scripts/common/retention.mjs` (remove a session's visual folder with its record)
- Test: `tests/integration/state-cli.test.mjs`, `tests/unit/retention.test.mjs`

**Interfaces:**
- Consumes: Task 3 exports, `CHECK_SCRIPT`, `RESULT_FILE`.
- Produces: `visualDir(root, sessionId, taskId): string` (`<root>/visual/<sessionId>/<taskId>`); CLI `visual-dir` → `{dir, script, resultFile}`; `visual-decide` → `{ok, decision}`; `visual-record` → `{ok, check, gaps}`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/state-cli.test.mjs` (add `toolInput` to the helpers import):

```js
test('visual-dir, visual-decide, and visual-record work end to end; visual-record finds the run by the check script path and rejects when no run exists', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  runHook('prompt', root, promptInput({ prompt: 'build a signup page', cwd }));
  const where = runState(root, 'visual-dir', { args: ['--session', 'sess-test-1'] }).json;
  assert.ok(fs.statSync(where.dir).isDirectory());
  assert.equal(where.script, path.join(where.dir, 'check.mjs'));
  assert.equal(where.resultFile, path.join(where.dir, 'result.json'));
  const decided = runState(root, 'visual-decide', { args: ['--session', 'sess-test-1'], input: { needed: true, reason: 'new /signup page' } }).json;
  assert.deepEqual([decided.ok, decided.decision.needed], [true, true]);
  const shots = ['desktop.png', 'phone.png'].map((name) => path.join(where.dir, name));
  for (const shot of shots) fs.writeFileSync(shot, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(where.resultFile, JSON.stringify({ passed: true, url: 'http://localhost:5173/signup', screenshots: shots, failures: [] }));
  const early = runState(root, 'visual-record', { args: ['--session', 'sess-test-1'], input: { resultFile: where.resultFile } });
  assert.deepEqual([early.status, early.json.error.code], [1, 'INVALID_VISUAL']);
  runHook('evidence', root, toolInput({ cwd, toolUseId: 'toolu_check', toolInputValue: { command: `node "${where.script}"` } }));
  const recorded = runState(root, 'visual-record', { args: ['--session', 'sess-test-1'], input: { resultFile: where.resultFile } }).json;
  assert.deepEqual([recorded.ok, recorded.check.ok, recorded.check.toolUseId, recorded.gaps], [true, true, 'toolu_check', []]);
  const bad = runState(root, 'visual-decide', { args: ['--session', 'sess-test-1'], input: { needed: 'maybe', reason: 'x' } });
  assert.deepEqual([bad.status, bad.json.error.code], [1, 'INVALID_VISUAL']);
});

test('data delete-session removes the session visual folder', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  runHook('prompt', root, promptInput({ prompt: 'ui work', cwd }));
  const { dir } = runState(root, 'visual-dir', { args: ['--session', 'sess-test-1'] }).json;
  fs.writeFileSync(path.join(dir, 'a.png'), 'x');
  const deleted = runState(root, 'data', { args: ['delete-session', '--session', 'sess-test-1'] }).json;
  assert.ok(deleted.deleted.includes(path.join(root, 'visual', 'sess-test-1')));
  assert.equal(fs.existsSync(path.join(root, 'visual', 'sess-test-1')), false);
});
```

Append to `tests/unit/retention.test.mjs` and change its helpers import to `import { tmpDataRoot, writeSession } from '../helpers.mjs';` (`fs`, `path`, `cleanupExpired`, and `newSessionRecord` are already imported):

```js
test('cleanup removes an expired session visual folder together with its record', () => {
  const root = tmpDataRoot();
  const now = Date.parse('2026-10-02T10:00:00Z');
  const record = newSessionRecord({ sessionId: 'old-sess', cwd: '/p', now: now - 40 * 86_400_000, retentionDays: 30 });
  record.phase = 'COMPLETE';
  writeSession(root, record);
  const dir = path.join(root, 'visual', 'old-sess', 't1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.png'), 'x');
  const result = cleanupExpired(root, { now });
  assert.equal(result.removedSessions, 1);
  assert.equal(fs.existsSync(path.join(root, 'visual', 'old-sess')), false);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/integration/state-cli.test.mjs tests/unit/retention.test.mjs`
Expected: FAIL (unknown commands; folder not removed).

- [ ] **Step 3: Implement**

`scripts/common/paths.mjs` — in `dataPaths` add `visual: path.join(root, 'visual'),` after `diagnostics`. After `sessionFile` add:

```js
export function visualDir(root, sessionId, taskId) {
  if (!TASK_ID_RE.test(String(taskId))) throw new AdhdError('INVALID_TASK_ID', 'task id must be 1-32 lowercase alphanumerics');
  return assertInside(root, path.join(root, 'visual', validateSessionId(sessionId), taskId));
}
```

`scripts/common/retention.mjs` — inside the `if ((expired && …) || abandoned)` branch, replace its body with:

```js
        if (removeQuietly(full)) {
          result[archived ? 'removedArchives' : 'removedSessions'] += 1;
          if (!archived && typeof record.sessionId === 'string') removeQuietly(path.join(paths.visual, path.basename(record.sessionId)));
        }
```

`scripts/state.mjs`:
- imports: add `visualDir` to the `./common/paths.mjs` import; add `import { recordVisualDecision, recordVisualCheck, visualGaps, CHECK_SCRIPT, RESULT_FILE } from './common/visual.mjs';`
- in `dataDeleteSession`, before `return { ok: true, deleted };` add:

```js
  const visual = path.join(paths.visual, sessionId);
  if (fileExists(visual) && removeQuietly(visual)) deleted.push(visual);
```

- in `dataDeleteAll`, change the targets list to `[paths.preferences, paths.projects, paths.sessions, paths.exports, paths.diagnostics, paths.visual]`.
- add to `commands` after `answer-record`:

```js
  async 'visual-decide'({ root, flags, now }) {
    const sessionId = resolveSessionId(root, flags);
    const payload = await readStdinJson();
    return mutateOpen(root, sessionId, now, (record) => {
      recordVisualDecision(record, payload, now);
      return { result: { ok: true, decision: record.evidence.visual.decision } };
    });
  },
  'visual-dir'({ root, flags }) {
    const sessionId = resolveSessionId(root, flags);
    const record = requireRecord(root, sessionId);
    if (!record.taskId || !isOpenPhase(record.phase)) fail('NO_ACTIVE_TASK', `task phase is ${record.phase}`);
    const dir = visualDir(root, sessionId, record.taskId);
    ensureDir(dir);
    return { dir, script: path.join(dir, CHECK_SCRIPT), resultFile: path.join(dir, RESULT_FILE) };
  },
  async 'visual-record'({ root, flags, now }) {
    const sessionId = resolveSessionId(root, flags);
    const payload = await readStdinJson();
    return mutateOpen(root, sessionId, now, (record) => {
      const check = recordVisualCheck(record, payload, { at: now, fileExists, readJson: readJsonFile });
      return { result: { ok: true, check, gaps: visualGaps(record, { fileExists }) } };
    });
  },
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/common/paths.mjs scripts/common/retention.mjs scripts/state.mjs tests/integration/state-cli.test.mjs tests/unit/retention.test.mjs
git commit -m "feat: visual-dir, visual-decide, visual-record commands with retention and deletion"
```

---

### Task 5: Stop-hook gate

**Files:**
- Modify: `scripts/common/session.mjs` (`evaluateStop` adds visual gaps)
- Modify: `scripts/stop-check.mjs:46-58` (completion line, blocked pause)
- Test: `tests/integration/stop-check.test.mjs`

**Interfaces:**
- Consumes: `visualGaps`, `visualSummary` (Task 3); CLI commands (Task 4).

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/stop-check.test.mjs` (add `toolInput` to the helpers import if absent):

```js
function visualSetup(root, cwd) {
  const where = runState(root, 'visual-dir', { args: ['--session', 'sess-test-1'] }).json;
  const shots = ['d.png', 'p.png'].map((name) => path.join(where.dir, name));
  for (const shot of shots) fs.writeFileSync(shot, 'png');
  return { where, shots };
}

function runCheck(root, cwd, where, result, id = 'toolu_check') {
  fs.writeFileSync(where.resultFile, JSON.stringify(result));
  runHook('evidence', root, toolInput({ cwd, toolUseId: id, toolInputValue: { command: `node "${where.script}"` } }));
  return runState(root, 'visual-record', { args: ['--session', 'sess-test-1'], input: { resultFile: where.resultFile } }).json;
}

const writeUi = (root, cwd, id, file = 'src/Signup.tsx') => runHook('evidence', root, toolInput({ cwd, toolName: 'Write', toolUseId: id, toolInputValue: { file_path: path.join(cwd, file), content: 'x' }, toolResponse: { type: 'create' } }));

test('a UI edit without a visual decision blocks even with an all-PASS receipt', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  begin(root, cwd, 'build a signup page');
  writeUi(root, cwd, 'toolu_w1');
  audit(root, readSession(root, 'sess-test-1'));
  const result = runHook('stop', root, stopInput({ cwd, lastAssistantMessage: 'Done.' })).json;
  assert.equal(result.decision, 'block');
  assert.ok(result.reason.includes('[VISUAL_UNDECIDED]'));
});

test('a needed and passing visual check completes with the UI line; a later UI edit makes it stale', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  begin(root, cwd, 'build a signup page');
  writeUi(root, cwd, 'toolu_w1');
  runState(root, 'visual-decide', { args: ['--session', 'sess-test-1'], input: { needed: true, reason: 'new signup page' } });
  const { where, shots } = visualSetup(root, cwd);
  assert.equal(runCheck(root, cwd, where, { passed: true, url: 'file:///x', screenshots: shots }).check.ok, true);
  audit(root, readSession(root, 'sess-test-1'));
  const done = runHook('stop', root, stopInput({ cwd, lastAssistantMessage: 'Done.' })).json;
  assert.match(done.systemMessage, /COMPLETE \(1\/1 items PASS, 0 repair\(s\)\) · UI verified \(2 screenshots\)/);

  const root2 = tmpDataRoot();
  begin(root2, cwd, 'build a signup page');
  runState(root2, 'visual-decide', { args: ['--session', 'sess-test-1'], input: { needed: true, reason: 'new signup page' } });
  const second = visualSetup(root2, cwd);
  runCheck(root2, cwd, second.where, { passed: true, screenshots: second.shots });
  writeUi(root2, cwd, 'toolu_w2');
  audit(root2, readSession(root2, 'sess-test-1'));
  const stale = runHook('stop', root2, stopInput({ cwd, lastAssistantMessage: 'Done.' })).json;
  assert.equal(stale.decision, 'block');
  assert.ok(stale.reason.includes('[VISUAL_STALE]'));
});

test('a blocked visual check plus a BLOCKED receipt item pauses the task', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  begin(root, cwd, 'build a signup page');
  runState(root, 'visual-decide', { args: ['--session', 'sess-test-1'], input: { needed: true, reason: 'new signup page' } });
  const { where } = visualSetup(root, cwd);
  runCheck(root, cwd, where, { passed: false, blocked: 'PLAYWRIGHT_MISSING: install with npm i -D playwright && npx playwright install chromium' });
  audit(root, readSession(root, 'sess-test-1'), { items: [{ id: 'R1', requirement: 'UI verified visually', status: 'BLOCKED', gap: 'Playwright is not installed; ask the user' }] });
  const result = runHook('stop', root, stopInput({ cwd, lastAssistantMessage: 'Playwright is missing.' })).json;
  assert.equal(result.decision, undefined);
  assert.match(result.systemMessage, /paused/);
  assert.equal(readSession(root, 'sess-test-1').phase, 'ACTIVE');
});

test('visualCheck=off lets a UI task complete without a visual check', () => {
  const root = tmpDataRoot();
  const cwd = tmpProjectDir();
  runState(root, 'prefs', { args: ['set', '--key', 'visualCheck', '--value', 'off', '--scope', 'global', '--cwd', cwd] });
  begin(root, cwd, 'build a signup page');
  writeUi(root, cwd, 'toolu_w1');
  audit(root, readSession(root, 'sess-test-1'));
  const result = runHook('stop', root, stopInput({ cwd, lastAssistantMessage: 'Done.' })).json;
  assert.match(result.systemMessage, /COMPLETE/);
  assert.equal(result.systemMessage.includes('UI verified'), false);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/integration/stop-check.test.mjs`
Expected: FAIL (no VISUAL_* gaps; no UI line).

- [ ] **Step 3: Implement**

`scripts/common/session.mjs`: import `visualGaps` alongside `noteUiEdits` from `./visual.mjs`; in `evaluateStop`, before `const unique = dedupe(gaps);` add:

```js
  gaps.push(...visualGaps(record, { fileExists }));
```

`scripts/stop-check.mjs`:
- add `import { visualSummary } from './common/visual.mjs';`
- change the COMPLETE message to:

```js
    return { result: { systemMessage: `ADHD: contract verified — COMPLETE (${coverage.passed}/${coverage.total} items PASS, ${record.repair.completed} repair(s))${visualSummary(record)}.` } };
```

- change the blocked-pause condition to:

```js
  if (evaluation.gaps.every((gap) => gap.code === 'ITEM_BLOCKED' || gap.code === 'VISUAL_BLOCKED')) {
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS. If the existing COMPLETE regex in `'a fresh all-PASS receipt with existing artifacts completes the task'` fails because of the trailing `.` placement, the message still ends with `repair(s)).` when no visual check ran — `visualSummary` returns `''`.

- [ ] **Step 5: Commit**

```bash
git add scripts/common/session.mjs scripts/stop-check.mjs tests/integration/stop-check.test.mjs
git commit -m "feat: enforce the visual check in the Stop hook"
```

---

### Task 6: Protocol text and auditor instructions for the visual check

**Files:**
- Modify: `scripts/common/render.mjs` (`visualSection`, used by the full protocol and the amendment reminder; auditor prompt step)
- Modify: `agents/contract-auditor.md` (new procedure step)
- Test: `tests/unit/render.test.mjs`

**Interfaces:**
- Consumes: `prefs.effective.visualCheck` (Task 1), CLI names (Task 4).
- Produces: `visualSection({ decideCommand, dirCommand, recordCommand }): string`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/render.test.mjs`:

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/unit/render.test.mjs`
Expected: FAIL (no visual section).

- [ ] **Step 3: Implement**

In `scripts/common/render.mjs`, add after `answerRule`:

```js
export function visualSection({ decideCommand, dirCommand, recordCommand }) {
  return [
    "6b. VISUAL CHECK. Before finishing, decide whether this task created or changed something a person sees or operates in a browser (pages, components, styles, templates, a route's UI). Backend-only code, tests, docs, CLI, and config with no visible effect need no check. Record the decision (JSON on stdin):",
    `${decideCommand} <<< '{"needed":true,"reason":"<one line>"}'`,
    `   When needed: get the check directory, script path, and result file with ${dirCommand}`,
    '   Write the Playwright script to that script path (check.mjs) and run it with Bash from the project directory as node "<script path>". The script must:',
    '   - load Playwright from the project: createRequire(path.join(process.cwd(), "package.json")), trying "playwright" then "@playwright/test";',
    '   - reuse a running dev server (never kill or restart one); if none runs, start the dev script in the background and leave it running; open static .html files with file://;',
    '   - visit every page or state the task changed, perform the actions the request names, and assert their visible result;',
    '   - fail on uncaught page errors and console.error;',
    '   - save a PNG screenshot at 1280x800 and at 390x844 for each page or state into the check directory;',
    '   - write the result file as {"passed":true|false,"url":"<url>","screenshots":["<absolute paths>"],"failures":["<what failed>"]} and exit 0 only when every assertion passed.',
    '   If the project has no Playwright but your own browser tools are available (Claude in Chrome or Playwright MCP), use them instead: visit the same pages, perform the same actions, save the same PNG screenshots into the check directory, and write the result file with "method":"browser" added. No script run is needed for that method.',
    '   When neither can run, write {"passed":false,"blocked":"PLAYWRIGHT_MISSING: install with npm i -D playwright && npx playwright install chromium"} (or "BROWSER_LAUNCH_FAILED: <message>", or "APP_UNREACHABLE: <url>"); a script exits 3, 4, or 5. Never install anything yourself.',
    `   Then record the run (JSON on stdin): ${recordCommand} <<< '{"resultFile":"<result file path>"}'`,
    '   A blocked check pauses the task: tell the user exactly what is missing and how to fix it. The auditor will open every screenshot and grade it against the request.',
  ].join('\n');
}
```

In `renderTaskLockProtocol`, after the `answerCommand` line add:

```js
  const visualOn = prefs.effective.visualCheck !== 'off';
  const visual = visualOn ? visualSection({
    decideCommand: stateCommand({ pluginRoot, dataRoot, sessionId: record.sessionId, subcommand: 'visual-decide' }),
    dirCommand: stateCommand({ pluginRoot, dataRoot, sessionId: record.sessionId, subcommand: 'visual-dir' }),
    recordCommand: stateCommand({ pluginRoot, dataRoot, sessionId: record.sessionId, subcommand: 'visual-record' }),
  }) : null;
```

In the full protocol, insert after the artifact-declare line (`` `${artifactCommand}   <<< …` ``):

```js
      ...(visual ? [visual] : []),
```

In the amendment-reminder branch, after `answerRule(answerCommand),` insert:

```js
      ...(visual && (record.evidence.visual.uiTouched.length > 0 || (record.evidence.visual.decision && record.evidence.visual.decision.needed)) ? [visual] : []),
```

In `auditorInvocation`, insert after the step-3 line:

```js
    '3b. Visual check: when evidence.visual.decision.needed is true, open every screenshot of the latest check with ok true using Read, grade them against the request (requested elements present, nothing visibly broken such as overlap, clipped text, or a blank page, phone layout usable), and add the item "UI verified visually" as PASS or PARTIAL with the exact visual gap; when the latest check has blocked set, mark that item BLOCKED with the blocked reason; a check with method "browser" has no script run, so rely on its screenshots alone. When decision.needed is false but evidence.visual.uiTouched is non-empty, judge the recorded reason and mark a weak reason PARTIAL.',
```

In `agents/contract-auditor.md`, insert after procedure step 5:

```markdown
5b. Visual check: when `evidence.visual.decision.needed` is true, open every screenshot of the latest check with `ok: true` using Read (it displays images) and grade them against the request: requested elements present, nothing visibly broken (overlap, clipped text, a blank page), phone layout usable. Add the item "UI verified visually" as PASS, or PARTIAL with the exact visual gap. When the latest check has `blocked` set, mark that item BLOCKED with the blocked reason. A check with `method: "browser"` has no script run, so its `passed` is the worker's own statement: rely on the screenshots alone. When `decision.needed` is false but `evidence.visual.uiTouched` is non-empty, judge the recorded reason and mark a weak reason PARTIAL.
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/common/render.mjs agents/contract-auditor.md tests/unit/render.test.mjs
git commit -m "feat: protocol and auditor instructions for the visual check"
```

---

### Task 7: Docs, eval, version, benchmark, validation

**Files:**
- Modify: `README.md`
- Create: `evals/adhd-visual-check/prompt.md`, `evals/adhd-visual-check/graders/criteria.md`
- Modify: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (version 0.1.3)

- [ ] **Step 1: README**

In "What it does", insert after item 6 (the WAITING ON YOU pause) and renumber the restore item to 8:

```markdown
7. Checks web UI work visually. When a task creates or changes something you see in a browser, Claude records that a visual check is needed, writes a Playwright script that opens the changed pages, performs the actions you asked for, and saves screenshots at desktop (1280 px) and phone (390 px) widths. The task cannot complete until a passing check is recorded, and the contract auditor opens the screenshots itself and grades them against your request. If your project has no Playwright, Claude uses its own browser tools (Claude in Chrome or Playwright MCP) to take the same screenshots. Only when neither works does the task pause and tell you exactly what to install or start; nothing is installed automatically. Turn it off with `visualCheck=off`.
```

In the Stop-hook table row, change `Hyperfocus ledger coverage)` to `Hyperfocus ledger coverage, visual check)`.

In the preferences table add the row:

```markdown
| `visualCheck` | `auto`, `off` | `auto` |
```

In "Limitations" add:

```markdown
- The visual check uses your project's Playwright and Chromium; the plugin never installs them. Claude Code's Bash results carry no exit code, so pass/fail comes from the `result.json` the check script writes, and the auditor's screenshot review is the independent judgment.
- A reply written just before a tool call can be stored in the transcript only as a short summary. Claude therefore records each complete answer with `state.mjs answer-record`, and the auditor reads that copy first.
```

In the `scripts/state.mjs` sentence of "How it works", change the command list to: `` `audit-record`, `evidence-add`, `artifact-declare`, `answer-record`, `visual-decide`, `visual-dir`, `visual-record`, `prefs`, `data`, and a few lifecycle commands``.

- [ ] **Step 2: Eval case**

`evals/adhd-visual-check/prompt.md`:

```markdown
---
name: adhd-visual-check
description: Tests that a web UI task ends with a recorded, passing visual check with screenshots before completion.
tags: [visual-check, ui]
runs: 3
max_turns: 60
timeout_seconds: 900
allowed_tools: ["Write", "Edit", "Bash(node *)", "Bash(npx *)", "Bash(npm *)"]
---

Create a static page site/index.html with a heading "Sign up", an email field, and a Submit button that shows the text "Please enter a valid email" under the field when the email has no @ sign.
```

`evals/adhd-visual-check/graders/criteria.md`:

```markdown
---
type: llm
name: visual-check-before-completion
focus: trace
---

Before claiming completion, Claude recorded a visual-check decision of needed, ran a Playwright check script that submitted an invalid email and asserted the error text, recorded the run with visual-record, and the auditor opened the screenshots. If Playwright was unavailable, the task paused with the exact install instruction instead of claiming completion.
```

- [ ] **Step 3: Version 0.1.3**

Set `"version": "0.1.3"` in `package.json`, `.claude-plugin/plugin.json`, and the plugin entry of `.claude-plugin/marketplace.json`.

- [ ] **Step 4: Verify everything**

Run: `npm test`
Expected: PASS, 0 failures.

Run: `npm run bench`
Expected: every p95 within its target (inactive/control < 50 ms, prompt-state < 100 ms).

Run: `claude plugin validate . --strict`
Expected: `✔ Validation passed`.

- [ ] **Step 5: Commit**

```bash
git add README.md evals/adhd-visual-check package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "docs: visual check and recorded answers; bump to 0.1.3"
```
