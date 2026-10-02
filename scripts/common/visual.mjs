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
