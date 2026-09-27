import fs from 'node:fs';

const TAIL_BYTES = 512 * 1024;
const MAX_TEXT_CHARS = 64 * 1024;

export function readTranscriptTail(transcriptPath, maxBytes = TAIL_BYTES) {
  if (typeof transcriptPath !== 'string' || transcriptPath === '') return '';
  let handle;
  try {
    handle = fs.openSync(transcriptPath, 'r');
    const size = fs.fstatSync(handle).size;
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } catch {
    return '';
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

function parseLines(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // a cut first line or a non-JSON line; skip it
    }
  }
  return entries;
}

function isRealUserTurn(entry) {
  return entry.type === 'user' && entry.isMeta !== true && entry.message && typeof entry.message.content === 'string';
}

export function readLastAssistantText(transcriptPath) {
  const entries = parseLines(readTranscriptTail(transcriptPath));
  let start = 0;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (isRealUserTurn(entries[i])) {
      start = i + 1;
      break;
    }
  }
  const texts = [];
  for (const entry of entries.slice(start)) {
    if (entry.type !== 'assistant' || entry.isSidechain === true || !entry.message || !Array.isArray(entry.message.content)) continue;
    for (const block of entry.message.content) if (block && block.type === 'text' && typeof block.text === 'string') texts.push(block.text);
  }
  return texts.join('\n').slice(-MAX_TEXT_CHARS);
}
