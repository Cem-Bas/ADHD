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

test('urls carrying secret-like query parameters are redacted before they are stored', () => {
  const urls = extractUrls({ url: 'https://api.example/v1?token=abcdefghijklmnop' }, 'fetched https://cdn.example/x?api_key=0123456789abcdef and https://ok.example/page');
  assert.deepEqual(urls, ['https://api.example/v1?[REDACTED]', 'https://cdn.example/x?[REDACTED]', 'https://ok.example/page']);
  const event = summarizeToolEvent({ hook_event_name: 'PostToolUse', tool_name: 'WebFetch', tool_use_id: 'u4', tool_input: { url: 'https://api.example/v1?token=abcdefghijklmnop' }, tool_response: 'see https://api.example/v1?token=abcdefghijklmnop' }, { now: 0 });
  assert.deepEqual(event.urls, ['https://api.example/v1?[REDACTED]']);
  assert.equal(JSON.stringify(event).includes('abcdefghijklmnop'), false);
});

test('failure events keep a recoverable exit status, and Bearer redaction leaves prose alone', () => {
  const failed = summarizeToolEvent({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 'u9', tool_input: { command: 'npm test' }, error: 'Command failed. Exit code: 1' }, { now: 0 });
  assert.deepEqual([failed.ok, failed.exitStatus], [false, 1]);
  assert.equal(redact('Bearer certificates were issued to the vendor'), 'Bearer certificates were issued to the vendor');
  assert.equal(redact('Authorization: Bearer abc.def.ghi').includes('abc.def.ghi'), false);
  assert.equal(redact('Bearer x1y2z3w4v5u6t7').includes('x1y2z3'), false);
  assert.equal(redact('Bearer bonds'), 'Bearer bonds');
});
