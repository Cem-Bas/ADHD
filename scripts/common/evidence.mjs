import { sha256Hex } from './ids.mjs';
import { MAX_TOOL_RESULT_BYTES } from './schema.mjs';

export const CAPTURED_TOOLS = new Set(['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task']);
export const MUTATING_TOOLS = new Set(['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

const READ_ONLY_PROGRAMS = new Set(['cat', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'ls', 'wc', 'pwd', 'echo', 'printf', 'diff', 'stat', 'file', 'which', 'cd', 'true', 'uniq', 'cut', 'tr', 'jq', 'basename', 'dirname', 'realpath', 'sed', 'find', 'sort', 'git']);
const READ_ONLY_GIT = new Set(['status', 'log', 'show', 'diff', 'rev-parse', 'ls-files', 'blame', 'grep']);
const HARMLESS_REDIRECTS = /\s(?:2>&1|[12]?>\s*\/dev\/null)(?=\s|$)/g;

function readOnlySegment(segment) {
  const words = segment.trim().split(/\s+/);
  const [program, ...args] = words;
  if (!program) return true;
  if (!READ_ONLY_PROGRAMS.has(program)) return false;
  if (program === 'sed') return !args.some((arg) => /^-[a-zA-Z]*i/.test(arg) || arg.startsWith('--in-place'));
  if (program === 'find') return !args.some((arg) => ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprintf', '-fls'].includes(arg));
  if (program === 'sort') return !args.some((arg) => arg.startsWith('-o') || arg.startsWith('--output'));
  if (program === 'git') {
    const at = args.findIndex((arg) => !arg.startsWith('-'));
    return at >= 0 && args.slice(0, at).every((arg) => arg === '--no-pager') && READ_ONLY_GIT.has(args[at]) && !args.some((arg) => arg.startsWith('--output'));
  }
  return true;
}

// A command that only reads (cat, grep, git status, ...) cannot change what an audit verified,
// so it must not make a recorded receipt stale. Anything unrecognised counts as mutating.
export function isReadOnlyCommand(command) {
  if (typeof command !== 'string' || command.trim() === '' || command.length >= 500) return false;
  const text = ` ${command}`.replace(HARMLESS_REDIRECTS, ' ');
  if (/[>`]|\$\(|<\(/.test(text)) return false;
  return text.split(/&&|\|\||[;|\n]/).every(readOnlySegment);
}

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bbearer\s+(?=[A-Za-z0-9._~+/=-]*[0-9._~+/=-])[A-Za-z0-9._~+/=-]{10,}/gi,
  /\b(?:token|password|passwd|pwd|secret|api[_-]?key|access[_-]?key)\b\s*[:=]\s*["']?[^\s"']{6,}/gi,
];

export function redact(text) {
  let out = String(text ?? '');
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[REDACTED]');
  return out;
}

export function clipAndHash(text, maxBytes = MAX_TOOL_RESULT_BYTES) {
  const buffer = Buffer.from(String(text ?? ''), 'utf8');
  const clipped = buffer.length > maxBytes;
  const kept = clipped ? buffer.subarray(0, maxBytes).toString('utf8') : buffer.toString('utf8');
  return { sha256: sha256Hex(buffer), bytes: buffer.length, clipped, preview: redact(kept).slice(0, 200) };
}

function asString(value) {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function extractPaths(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return [];
  const out = new Set();
  for (const key of ['file_path', 'path', 'notebook_path', 'filePath']) if (typeof toolInput[key] === 'string') out.add(toolInput[key]);
  if (Array.isArray(toolInput.edits)) for (const edit of toolInput.edits) if (edit && typeof edit.file_path === 'string') out.add(edit.file_path);
  return [...out];
}

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;

export function extractUrls(toolInput, toolResponse) {
  const out = new Set();
  if (toolInput && typeof toolInput.url === 'string') out.add(redact(toolInput.url));
  const text = asString(toolResponse).slice(0, 64 * 1024);
  for (const match of text.match(URL_RE) || []) {
    out.add(redact(match));
    if (out.size >= 50) break;
  }
  return [...out];
}

export function extractExitStatus(toolResponse) {
  if (toolResponse && typeof toolResponse === 'object') {
    for (const key of ['exitCode', 'exit_code', 'code', 'status']) if (Number.isInteger(toolResponse[key])) return toolResponse[key];
    if (toolResponse.interrupted === true) return 130;
  }
  const match = asString(toolResponse).match(/[Ee]xit code[:\s]+(\d{1,3})\b/);
  return match ? Number(match[1]) : null;
}

export function summarizeToolEvent(input, { now = Date.now(), maxBytes = MAX_TOOL_RESULT_BYTES } = {}) {
  const failure = input.hook_event_name === 'PostToolUseFailure';
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const response = failure ? input.error : input.tool_response;
  const exitStatus = extractExitStatus(response);
  return {
    toolUseId: String(input.tool_use_id || ''),
    toolName: String(input.tool_name || ''),
    at: new Date(now).toISOString(),
    ok: !failure && (exitStatus === null || exitStatus === 0),
    exitStatus,
    error: failure ? redact(asString(input.error)).slice(0, 500) : null,
    command: typeof toolInput.command === 'string' ? redact(toolInput.command).slice(0, 500) : null,
    paths: extractPaths(toolInput),
    urls: extractUrls(toolInput, response),
    agentType: typeof toolInput.subagent_type === 'string' ? toolInput.subagent_type : null,
    description: typeof toolInput.description === 'string' ? toolInput.description.slice(0, 200) : null,
    output: clipAndHash(asString(response), maxBytes),
  };
}
