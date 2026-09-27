import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpDataRoot } from '../helpers.mjs';
import { readLastAssistantText } from '../../scripts/common/transcript.mjs';

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'transcripts', 'sample.jsonl');

test('collects the assistant text blocks after the last real user turn, skipping sidechains', () => {
  assert.equal(readLastAssistantText(fixture), 'First part.\nSecond part.');
});

test('missing or unreadable transcripts yield an empty string', () => {
  assert.equal(readLastAssistantText(path.join(tmpDataRoot(), 'nope.jsonl')), '');
  assert.equal(readLastAssistantText(null), '');
});

test('only the tail of a large transcript is read and a cut first line is tolerated', () => {
  const file = path.join(tmpDataRoot(), 'big.jsonl');
  const filler = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(4000) }] }, isSidechain: false });
  const lines = Array.from({ length: 200 }, () => filler);
  lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: 'again' }, isMeta: false }));
  lines.push(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ADHD BOUNDED STOP REPORT' }] }, isSidechain: false }));
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  assert.equal(readLastAssistantText(file), 'ADHD BOUNDED STOP REPORT');
});
