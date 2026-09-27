import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDataRoot } from '../helpers.mjs';
import { writeFileAtomic, readJsonFile, quarantine, appendLine, listFiles, fileExists } from '../../scripts/common/fsx.mjs';

test('writeFileAtomic creates parent dirs, leaves no temp file, and replaces content', () => {
  const root = tmpDataRoot();
  const file = path.join(root, 'sessions', 'a.json');
  writeFileAtomic(file, '{"v":1}');
  writeFileAtomic(file, '{"v":2}');
  assert.deepEqual(readJsonFile(file), { status: 'ok', value: { v: 2 } });
  assert.deepEqual(listFiles(path.join(root, 'sessions')), ['a.json']);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('readJsonFile distinguishes missing from corrupt', () => {
  const root = tmpDataRoot();
  assert.equal(readJsonFile(path.join(root, 'nope.json')).status, 'missing');
  fs.writeFileSync(path.join(root, 'bad.json'), '{not json');
  const bad = readJsonFile(path.join(root, 'bad.json'));
  assert.equal(bad.status, 'corrupt');
  assert.equal(bad.raw, '{not json');
});

test('quarantine moves a file into diagnostics and records why', () => {
  const root = tmpDataRoot();
  const file = path.join(root, 'sessions', 'x.json');
  writeFileAtomic(file, 'garbage');
  const dest = quarantine(root, file, 'unparseable');
  assert.equal(fileExists(file), false);
  assert.ok(dest.startsWith(path.join(root, 'diagnostics')));
  const log = fs.readFileSync(path.join(root, 'diagnostics', 'quarantine.jsonl'), 'utf8');
  assert.match(log, /unparseable/);
});

test('appendLine flattens newlines so JSONL stays one record per line', () => {
  const root = tmpDataRoot();
  const file = path.join(root, 'd', 'log.jsonl');
  appendLine(file, 'one\ntwo');
  appendLine(file, 'three');
  assert.deepEqual(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean), ['one two', 'three']);
});
