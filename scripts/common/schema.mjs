export const SCHEMA_VERSION = 2;
export const REPAIR_PHASES = ['REPAIR_1', 'REPAIR_2', 'REPAIR_3', 'REPAIR_4', 'REPAIR_5', 'REPAIR_6'];
export const TERMINAL_PHASES = ['COMPLETE', 'BOUNDED_STOP', 'DEGRADED_STOP', 'CANCELLED'];
export const OPEN_PHASES = ['ACTIVE', ...REPAIR_PHASES, 'REPORT_REQUIRED', 'DEGRADED_REPORT_REQUIRED'];
export const PHASES = ['IDLE', ...OPEN_PHASES, ...TERMINAL_PHASES];
export const MODES = ['standard', 'hyperfocus'];
export const MAX_SESSION_BYTES = 2 * 1024 * 1024;
export const MAX_TOOL_RESULT_BYTES = 128 * 1024;
export const MAX_TOOL_EVENTS = 500;
export const MAX_REPAIRS = 6;
export const MAX_CONSECUTIVE_BLOCKS = 7;
export const CLOSURE_REASONS = ['complete', 'bounded', 'degraded', 'cancelled', 'replaced', 'cleared'];
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const NONCE_RE = /^[0-9a-f]{32}$/;

const TOP_LEVEL_KEYS = ['schemaVersion', 'sessionId', 'taskId', 'contractVersion', 'requestDigest', 'cwd', 'transcriptPath', 'phase', 'mode', 'originalRequest', 'userTurns', 'preferencesSnapshot', 'evidence', 'audit', 'repair', 'closure', 'createdAt', 'updatedAt', 'expiresAt', 'extensions'];
const EVIDENCE_KEYS = ['artifacts', 'commands', 'toolEvents', 'claims', 'sources', 'unresolved', 'agents', 'dropped', 'visual', 'answers'];
const OBJECT_EVIDENCE_KEYS = new Set(['dropped', 'visual']);
const FORBIDDEN_EXTENSION_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'command', 'commands', 'exec', 'shell', 'script', 'eval', 'args']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIso(value) {
  return typeof value === 'string' && ISO_RE.test(value) && !Number.isNaN(Date.parse(value));
}

export function emptyVisual() {
  return { decision: null, uiTouched: [], checks: [] };
}

export function emptyEvidence() {
  return { artifacts: [], commands: [], toolEvents: [], claims: [], sources: [], unresolved: [], agents: [], dropped: { toolEvents: 0 }, visual: emptyVisual(), answers: [] };
}

export function newSessionRecord({ sessionId, cwd, now, transcriptPath = null, preferencesSnapshot = {}, retentionDays = 30 }) {
  const iso = new Date(now).toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    sessionId,
    taskId: null,
    contractVersion: 0,
    requestDigest: null,
    cwd,
    transcriptPath,
    phase: 'IDLE',
    mode: 'standard',
    originalRequest: null,
    userTurns: [],
    preferencesSnapshot,
    evidence: emptyEvidence(),
    audit: { nonce: null, receipt: null, invalidatedAt: null, requestedAt: null },
    repair: { completed: 0, maximum: 6, gaps: [], blocksIssued: 0 },
    closure: null,
    createdAt: iso,
    updatedAt: iso,
    expiresAt: new Date(now + retentionDays * 86_400_000).toISOString(),
    extensions: { version: 1 },
  };
}

function checkExtensions(value, errors, depth = 0, trail = 'extensions') {
  if (depth > 8) {
    errors.push(`${trail} nests too deeply`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => { if (Array.isArray(item) || isPlainObject(item)) checkExtensions(item, errors, depth + 1, `${trail}[${i}]`); });
    return;
  }
  if (!isPlainObject(value)) {
    errors.push(`${trail} must be an object`);
    return;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (FORBIDDEN_EXTENSION_KEYS.has(key)) errors.push(`${trail}.${key} is not allowed`);
    const child = value[key];
    if (Array.isArray(child) || isPlainObject(child)) checkExtensions(child, errors, depth + 1, `${trail}.${key}`);
  }
  if (depth === 0 && !Number.isInteger(value.version)) errors.push('extensions.version must be an integer');
}

export function validateSessionRecord(record) {
  const errors = [];
  if (!isPlainObject(record)) return { ok: false, errors: ['record must be an object'] };
  for (const key of Object.keys(record)) if (!TOP_LEVEL_KEYS.includes(key)) errors.push(`unknown field: ${key}`);
  if (record.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (typeof record.sessionId !== 'string' || record.sessionId === '') errors.push('sessionId must be a non-empty string');
  if (!(record.taskId === null || typeof record.taskId === 'string')) errors.push('taskId must be null or a string');
  if (!Number.isInteger(record.contractVersion) || record.contractVersion < 0) errors.push('contractVersion must be a non-negative integer');
  if (!(record.requestDigest === null || /^sha256:[0-9a-f]{64}$/.test(record.requestDigest))) errors.push('requestDigest malformed');
  if (typeof record.cwd !== 'string') errors.push('cwd must be a string');
  if (!(record.transcriptPath === null || typeof record.transcriptPath === 'string')) errors.push('transcriptPath must be null or a string');
  if (!PHASES.includes(record.phase)) errors.push(`phase must be one of ${PHASES.join(', ')}`);
  if (!MODES.includes(record.mode)) errors.push(`mode must be one of ${MODES.join(', ')}`);
  if (!(record.originalRequest === null || (isPlainObject(record.originalRequest) && typeof record.originalRequest.text === 'string' && isIso(record.originalRequest.receivedAt)))) errors.push('originalRequest malformed');
  if (!Array.isArray(record.userTurns)) errors.push('userTurns must be an array');
  else record.userTurns.forEach((turn, i) => { if (!isPlainObject(turn) || turn.sequence !== i + 1 || typeof turn.text !== 'string' || !isIso(turn.receivedAt)) errors.push(`userTurns[${i}] malformed`); });
  if (!isPlainObject(record.preferencesSnapshot)) errors.push('preferencesSnapshot must be an object');
  if (!isPlainObject(record.evidence)) errors.push('evidence must be an object');
  else {
    for (const key of Object.keys(record.evidence)) if (!EVIDENCE_KEYS.includes(key)) errors.push(`unknown evidence field: ${key}`);
    for (const key of EVIDENCE_KEYS) if (!OBJECT_EVIDENCE_KEYS.has(key) && !Array.isArray(record.evidence[key])) errors.push(`evidence.${key} must be an array`);
    if (!isPlainObject(record.evidence.dropped) || !Number.isInteger(record.evidence.dropped.toolEvents)) errors.push('evidence.dropped malformed');
    const visual = record.evidence.visual;
    if (!isPlainObject(visual) || !Array.isArray(visual.uiTouched) || !Array.isArray(visual.checks)) errors.push('evidence.visual malformed');
    else if (!(visual.decision === null || (isPlainObject(visual.decision) && typeof visual.decision.needed === 'boolean' && typeof visual.decision.reason === 'string' && isIso(visual.decision.at)))) errors.push('evidence.visual.decision malformed');
  }
  if (!isPlainObject(record.audit)) errors.push('audit malformed');
  else {
    if (!(record.audit.nonce === null || (typeof record.audit.nonce === 'string' && NONCE_RE.test(record.audit.nonce)))) errors.push('audit.nonce must be null or 32 hex characters');
    if (!(record.audit.receipt === null || isPlainObject(record.audit.receipt))) errors.push('audit.receipt must be null or an object');
    for (const key of ['invalidatedAt', 'requestedAt']) if (!(record.audit[key] === null || isIso(record.audit[key]))) errors.push(`audit.${key} must be null or an ISO-8601 timestamp`);
  }
  if (!isPlainObject(record.repair) || !Array.isArray(record.repair.gaps)) errors.push('repair malformed');
  else {
    if (!Number.isInteger(record.repair.completed) || record.repair.completed < 0 || record.repair.completed > MAX_REPAIRS) errors.push(`repair.completed must be an integer between 0 and ${MAX_REPAIRS}`);
    if (!Number.isInteger(record.repair.maximum) || record.repair.maximum < 0 || record.repair.maximum > MAX_REPAIRS) errors.push(`repair.maximum must be an integer between 0 and ${MAX_REPAIRS}`);
    if (!Number.isInteger(record.repair.blocksIssued) || record.repair.blocksIssued < 0 || record.repair.blocksIssued > MAX_CONSECUTIVE_BLOCKS) errors.push(`repair.blocksIssued must be an integer between 0 and ${MAX_CONSECUTIVE_BLOCKS}`);
  }
  if (!(record.closure === null || (isPlainObject(record.closure) && CLOSURE_REASONS.includes(record.closure.reason) && isIso(record.closure.at)))) errors.push('closure malformed');
  for (const key of ['createdAt', 'updatedAt', 'expiresAt']) if (!isIso(record[key])) errors.push(`${key} must be an ISO-8601 timestamp`);
  if (record.extensions !== undefined) {
    if (!isPlainObject(record.extensions)) errors.push('extensions must be an object');
    else checkExtensions(record.extensions, errors);
  }
  return { ok: errors.length === 0, errors };
}

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

export function isOpenPhase(phase) {
  return OPEN_PHASES.includes(phase);
}

export function isTerminalPhase(phase) {
  return TERMINAL_PHASES.includes(phase);
}
