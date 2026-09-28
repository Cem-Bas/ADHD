export const CONTROL_COMMANDS = ['hyperfocus', 'new', 'status', 'contract', 'prefs', 'why', 'data', 'cancel'];
export const CANCEL_RE = /^(?:cancel|stop|stop this task|cancel this task)[.!]?$/i;
export const REPLACE_RE = /^(?:new task|replace task):[ \t]*/i;
const CONTROL_RE = /^\/adhd:([a-z-]+)(?:\s+([\s\S]*))?$/;

export function classifyPrompt(prompt) {
  const text = typeof prompt === 'string' ? prompt : '';
  const trimmed = text.trim();
  const control = trimmed.match(CONTROL_RE);
  if (control && CONTROL_COMMANDS.includes(control[1])) return { kind: 'control', command: control[1], args: (control[2] || '').trim() };
  if (CANCEL_RE.test(trimmed)) return { kind: 'cancel' };
  const replace = trimmed.match(REPLACE_RE);
  if (replace) return { kind: 'replace', text: trimmed.slice(replace[0].length) };
  return { kind: 'ordinary', text };
}

const HYPERFOCUS_PATTERNS = [
  /\bdeep(?:ly)?[- ]research\b/i,
  /\bresearch(?:\s+(?:this|it|that|these|those))?\s+(?:deeply|exhaustively)\b/i,
  /\bexhaustive(?:ly)?[- ]research\b/i,
  /\bhyperfocus\b/i,
];

export function detectHyperfocus(prompt) {
  const text = typeof prompt === 'string' ? prompt : '';
  return HYPERFOCUS_PATTERNS.some((pattern) => pattern.test(text));
}

export const MACHINE_SOURCES = new Set(['loop_wakeup', 'schedule_wakeup', 'system', 'poll_event']);
const HUMAN_SOURCES = new Set(['user', 'sdk']);
const ENVELOPE_PATTERNS = [
  /<task-notification>[\s\S]*?<\/task-notification>/gi,
  /<system-reminder>[\s\S]*?<\/system-reminder>/gi,
  /<agent-message from="[^"\r\n]+">\r?\n\[Subagent hand-back\] The text below is the final report of a subagent this session delegated to\.[\s\S]*?<\/agent-message>/gi,
];
const SYSTEM_NOTIFICATION_RE = /^\[SYSTEM NOTIFICATION/i;

export function isHumanPromptSource(source) {
  return source === undefined || source === null || HUMAN_SOURCES.has(source);
}

export function isMachinePromptSource(source) {
  return !isHumanPromptSource(source);
}

export function isSystemEnvelope(prompt) {
  const text = typeof prompt === 'string' ? prompt.trim() : '';
  if (text === '') return false;
  let rest = text;
  for (const pattern of ENVELOPE_PATTERNS) rest = rest.replace(pattern, '');
  rest = rest.trim();
  return rest === '' || SYSTEM_NOTIFICATION_RE.test(rest);
}
