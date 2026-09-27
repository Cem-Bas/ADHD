import { readJsonFile, writeFileAtomic, removeQuietly } from './fsx.mjs';
import { dataPaths, projectPreferencesFile } from './paths.mjs';
import { AdhdError } from './errors.mjs';

export const PREFERENCE_DEFINITIONS = {
  outputDetail: { type: 'enum', values: ['brief', 'standard', 'detailed'], default: 'standard', description: 'How much explanation accompanies results' },
  chunkSize: { type: 'enum', values: ['one-action', 'small-batch'], default: 'one-action', description: 'How many actions Claude takes before reporting state' },
  progressCadence: { type: 'enum', values: ['minimal', 'milestone', 'frequent'], default: 'milestone', description: 'How often Done/Now/Next/Blocked updates appear' },
  researchDepth: { type: 'enum', values: ['standard', 'hyperfocus'], default: 'standard', description: 'Default research mode for new tasks' },
  sourceStrictness: { type: 'enum', values: ['standard', 'strict'], default: 'standard', description: 'How strictly sources are required for material claims' },
  sourceVerification: { type: 'boolean', default: true, description: 'Verify unstable or time-sensitive facts' },
  taskLockDetail: { type: 'enum', values: ['compact', 'detailed'], default: 'compact', description: 'Task Lock verbosity' },
  repairCycles: { type: 'integer', min: 0, max: 6, default: 6, description: 'Maximum automatic repair cycles per task' },
  approvalPolicy: { type: 'enum', values: ['material-only', 'always-ask'], default: 'material-only', description: 'When Claude pauses for approval' },
  retentionDays: { type: 'integer', min: 0, max: 365, default: 30, description: 'Days to keep finished session records' },
};

export function defaultPreferences() {
  return Object.fromEntries(Object.entries(PREFERENCE_DEFINITIONS).map(([key, def]) => [key, def.default]));
}

export function validatePreference(key, raw) {
  const def = PREFERENCE_DEFINITIONS[key];
  if (!def) return { ok: false, error: `unknown preference: ${key}` };
  if (def.type === 'enum') return def.values.includes(raw) ? { ok: true, value: raw } : { ok: false, error: `${key} must be one of ${def.values.join(', ')}` };
  if (def.type === 'boolean') {
    if (raw === true || raw === 'true') return { ok: true, value: true };
    if (raw === false || raw === 'false') return { ok: true, value: false };
    return { ok: false, error: `${key} must be true or false` };
  }
  const number = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(number) || number < def.min || number > def.max) return { ok: false, error: `${key} must be an integer between ${def.min} and ${def.max}` };
  return { ok: true, value: number };
}

function readPreferenceFile(file) {
  const result = readJsonFile(file);
  if (result.status !== 'ok' || result.value === null || typeof result.value !== 'object' || Array.isArray(result.value)) return {};
  const out = {};
  for (const [key, value] of Object.entries(result.value)) {
    const checked = validatePreference(key, value);
    if (checked.ok) out[key] = checked.value;
  }
  return out;
}

export function loadPreferences(root, cwd) {
  const files = { global: dataPaths(root).preferences, project: projectPreferencesFile(root, cwd || process.cwd()) };
  const global = readPreferenceFile(files.global);
  const project = readPreferenceFile(files.project);
  const effective = defaultPreferences();
  const sources = {};
  for (const key of Object.keys(PREFERENCE_DEFINITIONS)) {
    sources[key] = 'default';
    if (key in global) { effective[key] = global[key]; sources[key] = 'global'; }
    if (key in project) { effective[key] = project[key]; sources[key] = 'project'; }
  }
  return { effective, sources, global, project, files };
}

function scopeFile(root, scope, cwd) {
  if (scope === 'global') return dataPaths(root).preferences;
  if (scope === 'project') return projectPreferencesFile(root, cwd || process.cwd());
  throw new AdhdError('PREF_INVALID', 'scope must be global or project');
}

export function setPreference(root, { scope = 'global', cwd, key, value }) {
  const checked = validatePreference(key, value);
  if (!checked.ok) throw new AdhdError('PREF_INVALID', checked.error);
  const file = scopeFile(root, scope, cwd);
  const current = readPreferenceFile(file);
  current[key] = checked.value;
  writeFileAtomic(file, `${JSON.stringify(current, null, 2)}\n`);
  return current;
}

export function unsetPreference(root, { scope = 'global', cwd, key }) {
  if (!PREFERENCE_DEFINITIONS[key]) throw new AdhdError('PREF_INVALID', `unknown preference: ${key}`);
  const file = scopeFile(root, scope, cwd);
  const current = readPreferenceFile(file);
  delete current[key];
  writeFileAtomic(file, `${JSON.stringify(current, null, 2)}\n`);
  return current;
}

export function resetPreferences(root, { scope = 'all', cwd }) {
  const removed = [];
  if (scope === 'global' || scope === 'all') { removeQuietly(dataPaths(root).preferences); removed.push('global'); }
  if (scope === 'project' || scope === 'all') { removeQuietly(projectPreferencesFile(root, cwd || process.cwd())); removed.push('project'); }
  if (removed.length === 0) throw new AdhdError('PREF_INVALID', 'scope must be global, project, or all');
  return removed;
}
