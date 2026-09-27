import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, clipAndHash, extractPaths, extractUrls, extractExitStatus, summarizeToolEvent, MUTATING_TOOLS } from '../../scripts/common/evidence.mjs';

test('redact hides common secret shapes but keeps ordinary text', () => {
  const text = 'token=abcdef123456 AKIAABCDEFGHIJKLMNOP ghp_abcdefghijklmnopqrstuvwxyz0123 sk-ant-api03-abcdefghijklmnopqrstuvwxyz Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U plain words stay';
  const out = redact(text);
  assert.equal(out.includes('AKIAABCDEFGHIJKLMNOP'), false);
  assert.equal(out.includes('ghp_abcdefghijklmnopqrstuvwxyz0123'), false);
  assert.equal(out.includes('abcdef123456'), false);
  assert.equal(out.includes('eyJhbGciOiJIUzI1NiJ9'), false);
  assert.ok(out.includes('plain words stay'));
});

test('clipAndHash caps bytes, hashes the full input, and previews redacted text', () => {
  const big = 'x'.repeat(200 * 1024);
  const result = clipAndHash(big, 128 * 1024);
  assert.equal(result.bytes, 200 * 1024);
  assert.equal(result.clipped, true);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.preview.length, 200);
  assert.equal(clipAndHash('short').clipped, false);
});

test('paths, urls and exit statuses are extracted from tool payloads', () => {
  assert.deepEqual(extractPaths({ file_path: 'a.md', edits: [{ file_path: 'b.md' }, { file_path: 'a.md' }] }), ['a.md', 'b.md']);
  assert.deepEqual(extractPaths({ notebook_path: 'n.ipynb' }), ['n.ipynb']);
  assert.deepEqual(extractPaths(null), []);
  assert.deepEqual(extractUrls({ url: 'https://a.example/x' }, 'see https://b.example/y and https://a.example/x'), ['https://a.example/x', 'https://b.example/y']);
  assert.equal(extractExitStatus({ exitCode: 2 }), 2);
  assert.equal(extractExitStatus({ stdout: 'x', interrupted: true }), 130);
  assert.equal(extractExitStatus('Command failed. Exit code: 1'), 1);
  assert.equal(extractExitStatus({ stdout: 'fine' }), null);
});

test('summarizeToolEvent covers success, failure, and agent metadata', () => {
  const ok = summarizeToolEvent({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'u1', tool_input: { command: 'npm test' }, tool_response: { stdout: 'ok', exitCode: 0 } }, { now: 0 });
  assert.equal(ok.ok, true);
  assert.equal(ok.command, 'npm test');
  assert.equal(ok.at, '1970-01-01T00:00:00.000Z');
  const failed = summarizeToolEvent({ hook_event_name: 'PostToolUseFailure', tool_name: 'Edit', tool_use_id: 'u2', tool_input: { file_path: 'x.js' }, error: 'password=hunter22 not found' }, { now: 0 });
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.paths, ['x.js']);
  assert.equal(failed.error.includes('hunter22'), false);
  const agent = summarizeToolEvent({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'u3', tool_input: { subagent_type: 'adhd:contract-auditor', description: 'audit', prompt: 'long' }, tool_response: 'done' }, { now: 0 });
  assert.equal(agent.agentType, 'adhd:contract-auditor');
  assert.equal(MUTATING_TOOLS.has('Agent'), false);
  assert.equal(MUTATING_TOOLS.has('Bash'), true);
});
