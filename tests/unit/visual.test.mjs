import test from 'node:test';
import assert from 'node:assert/strict';
import { newSessionRecord, validateSessionRecord } from '../../scripts/common/schema.mjs';
import { startTask, recordToolEvent, computeEvidenceDigest } from '../../scripts/common/session.mjs';
import { summarizeToolEvent } from '../../scripts/common/evidence.mjs';
import { isUiPath, recordVisualDecision, recordVisualCheck, visualGaps, visualSummary } from '../../scripts/common/visual.mjs';

const now = Date.parse('2026-10-02T10:00:00Z');
const DIR = '/data/visual/s/t1';
const RESULT = `${DIR}/result.json`;
const fresh = (snapshot = {}) => startTask(newSessionRecord({ sessionId: 's', cwd: '/p', now }), { text: 'build a signup page', receivedAt: now, preferencesSnapshot: { repairCycles: 6, retentionDays: 30, ...snapshot } });
const event = (toolName, toolInput, at = now, id = `toolu_${toolName}_${at}`) => summarizeToolEvent({ hook_event_name: 'PostToolUse', tool_name: toolName, tool_use_id: id, tool_input: toolInput, tool_response: { stdout: '' } }, { now: at });
const bash = (record, command, at, id = `toolu_bash_${at}`) => recordToolEvent(record, event('Bash', { command }, at, id), at);
const runScript = (record, at = now + 1000, id = 'toolu_run') => bash(record, `cd /p && node "${DIR}/check.mjs"`, at, id);
const editUi = (record, at, file = '/p/src/Signup.tsx') => recordToolEvent(record, event('Edit', { file_path: file }, at), at);
const shots = [`${DIR}/signup-desktop.png`, `${DIR}/signup-phone.png`];
// Builds the injected file-system view recordVisualCheck needs.
const ctx = ({ result, have = shots, mtimes = {}, at = now + 5000 }) => {
  const present = new Set(have);
  return { at, checkDir: DIR, fileExists: (p) => present.has(p), readJson: () => (result === undefined ? { status: 'missing' } : { status: 'ok', value: result }), mtime: (p) => mtimes[p] ?? now };
};
const record1 = (record, result, extra = {}) => recordVisualCheck(record, { resultFile: RESULT }, ctx({ result, ...extra }));

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

test('needed:false cannot replace the decision once a check was recorded', () => {
  const record = fresh();
  recordVisualDecision(record, { needed: true, reason: 'form' }, now);
  runScript(record);
  record1(record, { passed: false, screenshots: shots, failures: ['button missing'] });
  assert.throws(() => recordVisualDecision(record, { needed: false, reason: 'not really needed' }, now + 6000), /already recorded/);
  recordVisualDecision(record, { needed: true, reason: 'form, re-scoped' }, now + 6000);
  assert.equal(record.evidence.visual.decision.reason, 'form, re-scoped');
});

test('recordVisualCheck links the latest node run of check.mjs, dates it by the run, and requires real screenshots', () => {
  const record = fresh();
  assert.throws(() => record1(record, { passed: true, screenshots: shots }), /no recorded run/);
  runScript(record, now + 1000);
  const check = record1(record, { passed: true, url: 'http://localhost:5173/signup', screenshots: shots, failures: [] });
  assert.deepEqual(check, { method: 'script', toolUseId: 'toolu_run', url: 'http://localhost:5173/signup', screenshots: shots, ok: true, blocked: null, failures: [], at: '2026-10-02T10:00:01.000Z' });
  assert.throws(() => record1(record, { passed: true, screenshots: shots }, { have: [shots[0]] }), /screenshot/);
  assert.throws(() => record1(record, { passed: true, screenshots: [`${DIR}/x.gif`] }, { have: [`${DIR}/x.gif`] }), /screenshot/);
  assert.throws(() => record1(record, { passed: true, screenshots: [] }), /screenshots/);
  assert.throws(() => record1(record, undefined), /result file/);
});

test('only a node invocation of check.mjs counts as the run', () => {
  const record = fresh();
  bash(record, `cat > "${DIR}/check.mjs" <<'EOF'\nconsole.log(1)\nEOF`, now + 100);
  bash(record, `node --check "${DIR}/check.mjs"`, now + 200);
  bash(record, `rm -f ${DIR}/check.mjs.bak && ls ${DIR}`, now + 300);
  assert.throws(() => record1(record, { passed: true, screenshots: shots }), /no recorded run/);
  bash(record, `node ${DIR}/check.mjs 2>&1 | tail -5`, now + 400, 'toolu_real');
  assert.equal(record1(record, { passed: true, screenshots: shots }).toolUseId, 'toolu_real');
});

test('the result file and every screenshot must be inside the check directory', () => {
  const record = fresh();
  runScript(record);
  assert.throws(() => recordVisualCheck(record, { resultFile: 'result.json' }, ctx({ result: { passed: true, screenshots: shots } })), /resultFile/);
  assert.throws(() => recordVisualCheck(record, { resultFile: '/elsewhere/result.json' }, ctx({ result: { passed: true, screenshots: shots } })), /resultFile/);
  assert.throws(() => record1(record, { passed: true, screenshots: ['/p/docs/old.png'] }, { have: ['/p/docs/old.png'] }), /inside the check directory/);
  assert.throws(() => record1(record, { passed: true, screenshots: [`${DIR}/../t0/a.png`] }, { have: [`${DIR}/../t0/a.png`] }), /inside the check directory/);
});

test('a browser-method result needs a browser tool use since the last UI edit and is dated by its oldest screenshot', () => {
  const record = fresh();
  editUi(record, now + 100);
  const mtimes = { [shots[0]]: now + 300, [shots[1]]: now + 400 };
  assert.throws(() => record1(record, { method: 'browser', passed: true, screenshots: shots }, { mtimes }), /browser tool/);
  recordToolEvent(record, event('mcp__claude-in-chrome__computer', { action: 'screenshot' }, now + 50), now + 50);
  assert.throws(() => record1(record, { method: 'browser', passed: true, screenshots: shots }, { mtimes }), /browser tool/);
  recordToolEvent(record, event('mcp__plugin_playwright_playwright__browser_take_screenshot', {}, now + 200), now + 200);
  const check = record1(record, { method: 'browser', passed: true, url: 'http://localhost:3000', screenshots: shots }, { mtimes });
  assert.deepEqual([check.method, check.toolUseId, check.ok, check.at], ['browser', null, true, '2026-10-02T10:00:00.300Z']);
  assert.throws(() => record1(record, { method: 'browser', passed: true, screenshots: shots }, { have: [], mtimes }), /screenshot/);
  assert.throws(() => record1(record, { method: 'magic', passed: true, screenshots: shots }, { mtimes }), /method/);
});

test('a result file with passed:false is never ok, even when the command is recorded ok', () => {
  const record = fresh();
  runScript(record);
  const check = record1(record, { passed: false, screenshots: shots, failures: ['error text not shown'] });
  assert.deepEqual([check.ok, check.failures], [false, ['error text not shown']]);
});

test('a blocked result is recorded without screenshots and only with a known prefix', () => {
  const record = fresh();
  runScript(record);
  const check = record1(record, { passed: false, blocked: 'PLAYWRIGHT_MISSING: install with npm i -D playwright && npx playwright install chromium' }, { have: [] });
  assert.deepEqual([check.ok, check.blocked.startsWith('PLAYWRIGHT_MISSING'), check.screenshots], [false, true, []]);
  assert.throws(() => record1(record, { passed: false, blocked: 'I gave up' }, { have: [] }), /screenshots/);
});

test('visualGaps covers undecided, not needed, missing, failed, passing, deleted screenshots, stale, and blocked', () => {
  const record = fresh();
  const have = (...paths) => { const set = new Set(paths); return { fileExists: (p) => set.has(p) }; };
  assert.deepEqual(visualGaps(record, have()), []);
  editUi(record, now + 100);
  assert.deepEqual(visualGaps(record, have()).map((g) => g.code), ['VISUAL_UNDECIDED']);
  recordVisualDecision(record, { needed: false, reason: 'comment-only change' }, now + 200);
  assert.deepEqual(visualGaps(record, have()), []);
  recordVisualDecision(record, { needed: true, reason: 'new signup form' }, now + 300);
  assert.deepEqual(visualGaps(record, have()).map((g) => g.code), ['VISUAL_MISSING']);
  runScript(record, now + 400, 'toolu_r1');
  record1(record, { passed: false, screenshots: shots, failures: ['button missing'] });
  const failed = visualGaps(record, have(...shots));
  assert.deepEqual([failed[0].code, failed[0].detail.includes('button missing')], ['VISUAL_MISSING', true]);
  runScript(record, now + 500, 'toolu_r2');
  record1(record, { passed: true, screenshots: shots });
  assert.deepEqual(visualGaps(record, have(...shots)), []);
  assert.equal(visualSummary(record), ' · UI verified (2 screenshots)');
  assert.deepEqual(visualGaps(record, have(shots[0])).map((g) => g.code), ['VISUAL_SCREENSHOT_MISSING']);
  editUi(record, now + 700);
  const stale = visualGaps(record, have(...shots));
  assert.deepEqual([stale[0].code, stale[0].detail.includes('/p/src/Signup.tsx')], ['VISUAL_STALE', true]);
  runScript(record, now + 800, 'toolu_r3');
  record1(record, { passed: false, blocked: 'APP_UNREACHABLE: http://localhost:5173' }, { have: [] });
  assert.deepEqual(visualGaps(record, have(...shots)).map((g) => g.code), ['VISUAL_BLOCKED']);
});

test('a newer failing check is not hidden by an older passing one', () => {
  const record = fresh();
  recordVisualDecision(record, { needed: true, reason: 'form' }, now);
  runScript(record, now + 100, 'toolu_r1');
  record1(record, { passed: true, screenshots: shots });
  runScript(record, now + 200, 'toolu_r2');
  record1(record, { passed: false, screenshots: shots, failures: ['error message missing'] });
  assert.deepEqual(visualGaps(record, { fileExists: () => true }).map((g) => g.code), ['VISUAL_MISSING']);
  assert.equal(visualSummary(record), '');
});

test('a script check is dated by its run, so a UI edit before recording makes it stale', () => {
  const record = fresh();
  recordVisualDecision(record, { needed: true, reason: 'form' }, now);
  runScript(record, now + 100);
  editUi(record, now + 200);
  record1(record, { passed: true, screenshots: shots }, { at: now + 300 });
  assert.deepEqual(visualGaps(record, { fileExists: () => true }).map((g) => g.code), ['VISUAL_STALE']);
});

test('an edit at the same instant as the check counts as stale', () => {
  const record = fresh();
  recordVisualDecision(record, { needed: true, reason: 'form' }, now);
  runScript(record, now + 20);
  record1(record, { passed: true, screenshots: shots });
  editUi(record, now + 20, '/p/src/a.css');
  assert.deepEqual(visualGaps(record, { fileExists: () => true }).map((g) => g.code), ['VISUAL_STALE']);
});

test('visualCheck=off disables every visual gap', () => {
  const record = fresh({ visualCheck: 'off' });
  recordToolEvent(record, event('Write', { file_path: '/p/index.html' }, now + 1), now + 1);
  assert.deepEqual(visualGaps(record, { fileExists: () => false }), []);
  assert.equal(visualSummary(record), '');
});

test('a new decision or check changes the evidence digest', () => {
  const record = fresh();
  const a = computeEvidenceDigest(record);
  recordVisualDecision(record, { needed: true, reason: 'form' }, now);
  const b = computeEvidenceDigest(record);
  runScript(record);
  record1(record, { passed: true, screenshots: shots });
  const c = computeEvidenceDigest(record);
  assert.notEqual(a, b);
  assert.notEqual(b, c);
});
