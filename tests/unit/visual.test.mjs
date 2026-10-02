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
