import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPrompt, detectHyperfocus, isMachinePromptSource, isHumanPromptSource, isSystemEnvelope } from '../../scripts/common/controls.mjs';
import { TASK_NOTIFICATION } from '../helpers.mjs';

test('control commands are recognised with args and surrounding whitespace', () => {
  assert.deepEqual(classifyPrompt('/adhd:status'), { kind: 'control', command: 'status', args: '' });
  assert.deepEqual(classifyPrompt('/adhd:status\n'), { kind: 'control', command: 'status', args: '' });
  assert.deepEqual(classifyPrompt('  /adhd:new build a CLI\nwith tests '), { kind: 'control', command: 'new', args: 'build a CLI\nwith tests' });
  assert.deepEqual(classifyPrompt('/adhd:prefs set outputDetail brief'), { kind: 'control', command: 'prefs', args: 'set outputDetail brief' });
  assert.equal(classifyPrompt('/adhd:unknown').kind, 'ordinary');
  assert.equal(classifyPrompt('/ralph-loop go').kind, 'ordinary');
});

test('cancellation is exact and case-insensitive with optional terminal punctuation', () => {
  for (const p of ['cancel', 'Stop', 'STOP THIS TASK.', 'cancel this task!', '  stop  ', '/adhd:cancel']) assert.ok(['cancel', 'control'].includes(classifyPrompt(p).kind), p);
  for (const p of ['stop doing X and do Y', 'please stop', 'stop.now', 'cancel the meeting', 'stop this task please']) assert.equal(classifyPrompt(p).kind, 'ordinary', p);
});

test('replacement prefixes strip the prefix and keep the rest verbatim', () => {
  assert.deepEqual(classifyPrompt('New task: build "x" $(rm -rf /)'), { kind: 'replace', text: 'build "x" $(rm -rf /)' });
  assert.deepEqual(classifyPrompt('replace TASK:   do y\nline2'), { kind: 'replace', text: 'do y\nline2' });
  assert.deepEqual(classifyPrompt('New task:'), { kind: 'replace', text: '' });
  assert.equal(classifyPrompt('A new task: is not a prefix').kind, 'ordinary');
});

test('ordinary prompts are returned untouched', () => {
  const text = '  keep  my   spacing\n\tand "quotes" `ticks` $(sub) 日本語 🚀 ';
  assert.deepEqual(classifyPrompt(text), { kind: 'ordinary', text });
  assert.deepEqual(classifyPrompt(undefined), { kind: 'ordinary', text: '' });
});

test('hyperfocus detection uses unambiguous phrases only', () => {
  for (const p of ['Please do deep research on X', 'research this deeply', 'I need exhaustive research', 'Deep-research the market', 'use hyperfocus for this', 'Research it deeply.']) assert.equal(detectHyperfocus(p), true, p);
  for (const p of ['research the topic', 'go deep into the code', 'a very long prompt '.repeat(200), 'the deep end of the pool', 'exhaustive tests']) assert.equal(detectHyperfocus(p), false, p);
});

test('machine prompt sources are identified', () => {
  for (const s of ['loop_wakeup', 'schedule_wakeup', 'system', 'poll_event']) assert.equal(isMachinePromptSource(s), true);
  for (const s of ['user', 'sdk', undefined]) assert.equal(isMachinePromptSource(s), false);
});

test('only user, sdk, and an absent source are human; any other source is machine', () => {
  for (const s of ['user', 'sdk', undefined, null]) {
    assert.equal(isHumanPromptSource(s), true, String(s));
    assert.equal(isMachinePromptSource(s), false, String(s));
  }
  for (const s of ['loop_wakeup', 'schedule_wakeup', 'system', 'poll_event', 'task_notification', 'some_future_source']) {
    assert.equal(isHumanPromptSource(s), false, s);
    assert.equal(isMachinePromptSource(s), true, s);
  }
});

test('a prompt made only of system envelopes is a system envelope; prose around one is not', () => {
  assert.ok(TASK_NOTIFICATION.startsWith('<task-notification>') && TASK_NOTIFICATION.endsWith('</task-notification>'));
  assert.equal(isSystemEnvelope(TASK_NOTIFICATION), true);
  assert.equal(isSystemEnvelope(`\n  ${TASK_NOTIFICATION}\n\n${TASK_NOTIFICATION}\n`), true);
  assert.equal(isSystemEnvelope(`${TASK_NOTIFICATION}\n<system-reminder>\nThe file was modified.\n</system-reminder>`), true);
  assert.equal(isSystemEnvelope('<system-reminder>\nremember the ledger\n</system-reminder>'), true);
  assert.equal(isSystemEnvelope('[SYSTEM NOTIFICATION - NOT USER INPUT] The background shell "npm test" finished with exit code 0.'), true);
  assert.equal(isSystemEnvelope('[system notification - not user input]\nlower-case marker'), true);
  assert.equal(isSystemEnvelope(`${TASK_NOTIFICATION}\n[SYSTEM NOTIFICATION - NOT USER INPUT] and a notice`), true);
  assert.equal(isSystemEnvelope(`please also add tests\n${TASK_NOTIFICATION}`), false);
  assert.equal(isSystemEnvelope(`${TASK_NOTIFICATION}\nthanks, now ship it`), false);
  assert.equal(isSystemEnvelope('fix the bug [SYSTEM NOTIFICATION - NOT USER INPUT] later'), false);
  assert.equal(isSystemEnvelope('<task-notification>unterminated'), false);
  assert.equal(isSystemEnvelope('do the thing'), false);
  assert.equal(isSystemEnvelope('stop'), false);
  assert.equal(isSystemEnvelope(''), false);
  assert.equal(isSystemEnvelope('   '), false);
  assert.equal(isSystemEnvelope(undefined), false);
});
