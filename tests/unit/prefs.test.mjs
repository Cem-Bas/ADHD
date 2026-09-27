import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpDataRoot } from '../helpers.mjs';
import { defaultPreferences, validatePreference, loadPreferences, setPreference, unsetPreference, resetPreferences } from '../../scripts/common/prefs.mjs';

test('defaults match the spec', () => {
  assert.deepEqual(defaultPreferences(), {
    outputDetail: 'standard', chunkSize: 'one-action', progressCadence: 'milestone', researchDepth: 'standard', sourceStrictness: 'standard',
    sourceVerification: true, taskLockDetail: 'compact', repairCycles: 6, approvalPolicy: 'material-only', retentionDays: 30,
  });
});

test('validation coerces strings and rejects out-of-range values', () => {
  assert.deepEqual(validatePreference('sourceVerification', 'false'), { ok: true, value: false });
  assert.deepEqual(validatePreference('repairCycles', '3'), { ok: true, value: 3 });
  assert.equal(validatePreference('repairCycles', '7').ok, false);
  assert.equal(validatePreference('retentionDays', 366).ok, false);
  assert.equal(validatePreference('outputDetail', 'loud').ok, false);
  assert.equal(validatePreference('nope', 1).ok, false);
  assert.equal(validatePreference('repairCycles', '').ok, false);
  assert.equal(validatePreference('repairCycles', null).ok, false);
  assert.equal(validatePreference('repairCycles', [3]).ok, false);
  assert.deepEqual(validatePreference('repairCycles', ' 4 '), { ok: true, value: 4 });
});

test('project overrides win over global which win over defaults, and sources say so', () => {
  const root = tmpDataRoot();
  const cwd = '/some/project';
  setPreference(root, { scope: 'global', key: 'outputDetail', value: 'brief' });
  setPreference(root, { scope: 'global', key: 'repairCycles', value: 4 });
  setPreference(root, { scope: 'project', cwd, key: 'repairCycles', value: 2 });
  const loaded = loadPreferences(root, cwd);
  assert.equal(loaded.effective.outputDetail, 'brief');
  assert.equal(loaded.effective.repairCycles, 2);
  assert.equal(loaded.sources.repairCycles, 'project');
  assert.equal(loaded.sources.outputDetail, 'global');
  assert.equal(loaded.sources.chunkSize, 'default');
  assert.equal(loadPreferences(root, '/other').effective.repairCycles, 4);
  unsetPreference(root, { scope: 'project', cwd, key: 'repairCycles' });
  assert.equal(loadPreferences(root, cwd).effective.repairCycles, 4);
  resetPreferences(root, { scope: 'all', cwd });
  assert.deepEqual(loadPreferences(root, cwd).effective, defaultPreferences());
  assert.equal(fs.existsSync(loaded.files.global), false);
});

test('invalid values inside preference files are ignored rather than crashing', () => {
  const root = tmpDataRoot();
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(`${root}/preferences.json`, JSON.stringify({ outputDetail: 'loud', repairCycles: 5, junk: true }));
  const loaded = loadPreferences(root, '/p');
  assert.equal(loaded.effective.outputDetail, 'standard');
  assert.equal(loaded.effective.repairCycles, 5);
  fs.writeFileSync(`${root}/preferences.json`, '{broken');
  assert.equal(loadPreferences(root, '/p').effective.repairCycles, 6);
});
