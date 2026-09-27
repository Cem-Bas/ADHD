export const SCHEMA_VERSION = 1;
export const REPAIR_PHASES = ['REPAIR_1', 'REPAIR_2', 'REPAIR_3', 'REPAIR_4', 'REPAIR_5', 'REPAIR_6'];
export const TERMINAL_PHASES = ['COMPLETE', 'BOUNDED_STOP', 'DEGRADED_STOP', 'CANCELLED'];
export const OPEN_PHASES = ['ACTIVE', ...REPAIR_PHASES, 'REPORT_REQUIRED', 'DEGRADED_REPORT_REQUIRED'];
export const PHASES = ['IDLE', ...OPEN_PHASES, ...TERMINAL_PHASES];
export const MODES = ['standard', 'hyperfocus'];
export const MAX_SESSION_BYTES = 2 * 1024 * 1024;
export const MAX_TOOL_RESULT_BYTES = 128 * 1024;
export const MAX_TOOL_EVENTS = 500;

const TOP_LEVEL_KEYS = ['schemaVersion', 'sessionId', 'taskId', 'contractVersion', 'requestDigest', 'cwd', 'transcriptPath', 'phase', 'mode', 'originalRequest', 'userTurns', 'preferencesSnapshot', 'evidence', 'audit', 'repair', 'closure', 'createdAt', 'updatedAt', 'expiresAt', 'extensions'];
const EVIDENCE_KEYS = ['artifacts', 'commands', 'toolEvents', 'claims', 'sources', 'unresolved', 'agents', 'dropped'];
const FORBIDDEN_EXTENSION_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'command', 'commands', 'exec', 'shell', 'script', 'eval', 'args']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIso(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

export function emptyEvidence() {
  return { artifacts: [], commands: [], toolEvents: [], claims: [], sources: [], unresolved: [], agents: [], dropped: { toolEvents: 0 } };
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
  if (!isPlainObject(value)) {
    errors.push(`${trail} must be an object`);
    return;
  }
  if (depth > 8) {
    errors.push(`${trail} nests too deeply`);
    return;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (FORBIDDEN_EXTENSION_KEYS.has(key)) errors.push(`${trail}.${key} is not allowed`);
    const child = value[key];
    if (isPlainObject(child)) checkExtensions(child, errors, depth + 1, `${trail}.${key}`);
    else if (Array.isArray(child)) child.forEach((item, i) => { if (isPlainObject(item)) checkExtensions(item, errors, depth + 1, `${trail}.${key}[${i}]`); });
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
    for (const key of EVIDENCE_KEYS) if (key !== 'dropped' && !Array.isArray(record.evidence[key])) errors.push(`evidence.${key} must be an array`);
    if (!isPlainObject(record.evidence.dropped) || !Number.isInteger(record.evidence.dropped.toolEvents)) errors.push('evidence.dropped malformed');
  }
  if (!isPlainObject(record.audit) || !('nonce' in record.audit) || !('receipt' in record.audit)) errors.push('audit malformed');
  if (!isPlainObject(record.repair) || !Number.isInteger(record.repair.completed) || !Number.isInteger(record.repair.maximum) || !Array.isArray(record.repair.gaps) || !Number.isInteger(record.repair.blocksIssued)) errors.push('repair malformed');
  if (!(record.closure === null || (isPlainObject(record.closure) && typeof record.closure.reason === 'string' && isIso(record.closure.at)))) errors.push('closure malformed');
  for (const key of ['createdAt', 'updatedAt', 'expiresAt']) if (!isIso(record[key])) errors.push(`${key} must be an ISO-8601 timestamp`);
  if (record.extensions !== undefined) checkExtensions(record.extensions, errors);
  return { ok: errors.length === 0, errors };
}

export function migrateSessionRecord(record) {
  if (!isPlainObject(record)) return { ok: false, error: 'record is not an object' };
  if (record.schemaVersion === SCHEMA_VERSION) return { ok: true, record, migrated: false };
  if (typeof record.schemaVersion === 'number' && record.schemaVersion > SCHEMA_VERSION) return { ok: false, error: `schemaVersion ${record.schemaVersion} is newer than supported ${SCHEMA_VERSION}` };
  return { ok: false, error: `unsupported schemaVersion ${String(record.schemaVersion)}` };
}

export function isOpenPhase(phase) {
  return OPEN_PHASES.includes(phase);
}

export function isTerminalPhase(phase) {
  return TERMINAL_PHASES.includes(phase);
}
