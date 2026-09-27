import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SCRIPTS = {
  prompt: path.join(REPO_ROOT, 'scripts', 'prompt-context.mjs'),
  restore: path.join(REPO_ROOT, 'scripts', 'restore-context.mjs'),
  evidence: path.join(REPO_ROOT, 'scripts', 'evidence-capture.mjs'),
  stop: path.join(REPO_ROOT, 'scripts', 'stop-check.mjs'),
  state: path.join(REPO_ROOT, 'scripts', 'state.mjs'),
};

export function tmpDataRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'adhd-test-'));
}

export function tmpProjectDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'adhd-project-'));
}

export function runScript(scriptPath, { input = null, args = [], env = {}, timeout = 20000 } = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    input: input === null ? undefined : typeof input === 'string' ? input : JSON.stringify(input),
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout,
  });
  let json = null;
  const trimmed = (result.stdout || '').trim();
  if (trimmed) {
    try {
      json = JSON.parse(trimmed.split('\n').pop());
    } catch {
      json = null;
    }
  }
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '', json };
}

export function runHook(kind, root, input) {
  return runScript(SCRIPTS[kind], { input, args: ['--data', root] });
}

export function runState(root, subcommand, { args = [], input = null } = {}) {
  return runScript(SCRIPTS.state, { input, args: [subcommand, '--data', root, ...args] });
}

const base = ({ sessionId = 'sess-test-1', cwd = process.cwd(), transcriptPath = null }) => ({
  session_id: sessionId,
  transcript_path: transcriptPath || path.join(os.tmpdir(), `${sessionId}.jsonl`),
  cwd,
  permission_mode: 'default',
});

export function promptInput({ prompt, source = 'user', ...rest } = {}) {
  return { ...base(rest), hook_event_name: 'UserPromptSubmit', prompt, source };
}

export function stopInput({ lastAssistantMessage = '', stopHookActive = false, backgroundTasks = [], sessionCrons = [], ...rest } = {}) {
  const input = { ...base(rest), hook_event_name: 'Stop', stop_hook_active: stopHookActive, background_tasks: backgroundTasks, session_crons: sessionCrons };
  if (lastAssistantMessage !== null) input.last_assistant_message = lastAssistantMessage;
  return input;
}

export function sessionStartInput({ source = 'startup', ...rest } = {}) {
  return { ...base(rest), hook_event_name: 'SessionStart', source };
}

export function toolInput({ toolName = 'Bash', toolInputValue = { command: 'echo hi' }, toolResponse = { stdout: 'hi', stderr: '' }, toolUseId = 'toolu_1', failure = false, error = 'boom', agentId, ...rest } = {}) {
  const input = { ...base(rest), tool_name: toolName, tool_input: toolInputValue, tool_use_id: toolUseId };
  if (agentId) input.agent_id = agentId;
  if (failure) return { ...input, hook_event_name: 'PostToolUseFailure', error };
  return { ...input, hook_event_name: 'PostToolUse', tool_response: toolResponse };
}

export function subagentInput({ event = 'SubagentStart', agentId = 'agent-1', agentType = 'adhd:source-researcher', ...rest } = {}) {
  return { ...base(rest), hook_event_name: event, agent_id: agentId, agent_type: agentType };
}

export function sessionFilePath(root, sessionId) {
  return path.join(root, 'sessions', `${sessionId}.json`);
}

export function readSession(root, sessionId) {
  return JSON.parse(fs.readFileSync(sessionFilePath(root, sessionId), 'utf8'));
}

export function writeSession(root, record) {
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  fs.writeFileSync(sessionFilePath(root, record.sessionId), JSON.stringify(record));
}

export function passingReceipt(record, overrides = {}) {
  return {
    taskId: record.taskId,
    contractVersion: record.contractVersion,
    requestDigest: record.requestDigest,
    nonce: record.audit.nonce,
    auditorModel: 'test-model',
    taskLockValid: true,
    taskLockIssues: [],
    items: [{ id: 'R1', requirement: 'do the thing', status: 'PASS', evidence: [{ type: 'transcript', note: 'done' }] }],
    summary: 'all good',
    ...overrides,
  };
}
