import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPrompt, detectHyperfocus, isMachinePromptSource } from '../../scripts/common/controls.mjs';

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
