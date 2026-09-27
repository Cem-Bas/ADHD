import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../helpers.mjs';

export function frontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `${file} has YAML frontmatter`);
  const fields = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1');
  }
  return { fields, body: text.slice(match[0].length) };
}

test('agents declare the bounded configuration the spec requires', () => {
  const dir = path.join(REPO_ROOT, 'agents');
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, ['contract-auditor.md', 'evidence-verifier.md', 'source-researcher.md']);
  for (const file of files) {
    const { fields, body } = frontmatter(path.join(dir, file));
    assert.equal(fields.name, file.replace(/\.md$/, ''));
    assert.ok(fields.description.length > 40);
    assert.equal(fields.maxTurns, '12');
    assert.ok(['sonnet', 'haiku'].includes(fields.model));
    assert.ok(/120 seconds/.test(body), `${file} states the 120 second budget`);
  }
  const auditor = frontmatter(path.join(dir, 'contract-auditor.md'));
  assert.equal(auditor.fields.tools, 'Read, Grep, Glob, Bash');
  assert.ok(auditor.body.includes('audit-record'));
  assert.ok(auditor.body.includes('PASS only with verifiable evidence'));
  const researcher = frontmatter(path.join(dir, 'source-researcher.md'));
  assert.ok(researcher.fields.tools.includes('WebSearch'));
  assert.ok(researcher.body.includes('"evidenceChainId"'));
  const verifier = frontmatter(path.join(dir, 'evidence-verifier.md'));
  assert.equal(verifier.fields.tools.includes('Bash'), false);
  assert.ok(verifier.body.includes('never the conclusion'));
});

test('manifests agree on the version and the hooks config is exec-form only', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const plugin = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const market = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.equal(plugin.name, 'adhd');
  assert.equal(plugin.version, pkg.version);
  assert.equal(market.plugins[0].version, pkg.version);
  assert.equal(market.plugins[0].source, './');
  const hooks = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ['PostToolUse', 'PostToolUseFailure', 'SessionStart', 'Stop', 'SubagentStart', 'SubagentStop', 'UserPromptSubmit']);
  for (const groups of Object.values(hooks)) for (const group of groups) for (const hook of group.hooks) {
    assert.equal(hook.type, 'command');
    assert.equal(hook.command, 'node');
    assert.ok(Array.isArray(hook.args) && hook.args[0].startsWith('${CLAUDE_PLUGIN_ROOT}/scripts/'));
    assert.deepEqual(hook.args.slice(1), ['--data', '${CLAUDE_PLUGIN_DATA}']);
    assert.ok(fs.existsSync(path.join(REPO_ROOT, hook.args[0].replace('${CLAUDE_PLUGIN_ROOT}/', ''))));
  }
});

test('skills exist for every command, are named after their directory, and are user-invocable', () => {
  const dir = path.join(REPO_ROOT, 'skills');
  const expected = ['cancel', 'contract', 'data', 'hyperfocus', 'new', 'prefs', 'status', 'why'];
  assert.deepEqual(fs.readdirSync(dir).sort(), expected);
  for (const name of expected) {
    const { fields, body } = frontmatter(path.join(dir, name, 'SKILL.md'));
    assert.equal(fields.name, name);
    assert.ok(fields.description.includes(`/adhd:${name}`), `${name} description names its command`);
    if (name === 'prefs' || name === 'data') assert.match(fields['allowed-tools'], new RegExp(`^Bash\\(node \\*scripts/state\\.mjs ${name} \\*\\)$`), `${name} restricts Bash to its state.mjs subcommand`);
    else assert.equal(fields['allowed-tools'], undefined, `${name} declares no allowed-tools`);
    assert.ok(body.trim().length > 100);
  }
  assert.equal(frontmatter(path.join(dir, 'why', 'SKILL.md')).fields['disable-model-invocation'], undefined);
  for (const name of expected.filter((n) => n !== 'why')) assert.equal(frontmatter(path.join(dir, name, 'SKILL.md')).fields['disable-model-invocation'], 'true');
  assert.ok(frontmatter(path.join(dir, 'data', 'SKILL.md')).body.includes('delete all adhd data'));
  assert.ok(frontmatter(path.join(dir, 'hyperfocus', 'SKILL.md')).body.includes('adhd:source-researcher'));
  assert.ok(frontmatter(path.join(dir, 'data', 'SKILL.md')).body.includes('delete project <projectKey>'));
  assert.ok(frontmatter(path.join(REPO_ROOT, 'agents', 'contract-auditor.md')).body.includes('auditorModel'));
});
