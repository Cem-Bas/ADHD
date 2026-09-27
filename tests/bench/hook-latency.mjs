import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { tmpDataRoot, tmpProjectDir, runHook, promptInput, stopInput, toolInput } from '../helpers.mjs';

const N = Number(process.env.ADHD_BENCH_N || 20);
const root = tmpDataRoot();
const cwd = tmpProjectDir();

function measure(label, run) {
  const samples = [];
  for (let i = 0; i < N; i += 1) {
    const started = performance.now();
    run(i);
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const quantile = (q) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))];
  const result = { label, p50: Number(quantile(0.5).toFixed(1)), p95: Number(quantile(0.95).toFixed(1)), n: N };
  console.log(`${label.padEnd(46)} p50 ${String(result.p50).padStart(7)} ms  p95 ${String(result.p95).padStart(7)} ms`);
  return result;
}

const results = [];
results.push(measure('node startup baseline (node -e 0)', () => spawnSync(process.execPath, ['-e', '0'])));
results.push(measure('stop-check, no ADHD task (inactive path)', () => runHook('stop', root, stopInput({ sessionId: 'idle', cwd }))));
results.push(measure('prompt-context, control command /adhd:status', () => runHook('prompt', root, promptInput({ sessionId: 'control', prompt: '/adhd:status', cwd }))));
results.push(measure('prompt-context, new task', (i) => runHook('prompt', root, promptInput({ sessionId: `new-${i}`, prompt: 'bench task', cwd }))));
runHook('prompt', root, promptInput({ sessionId: 'active', prompt: 'bench task', cwd }));
results.push(measure('prompt-context, amendment on an active task', (i) => runHook('prompt', root, promptInput({ sessionId: 'active', prompt: `turn ${i}`, cwd }))));
results.push(measure('evidence-capture, Bash event on an active task', (i) => runHook('evidence', root, toolInput({ sessionId: 'active', cwd, toolUseId: `u${i}` }))));
for (let i = 0; i < N; i += 1) runHook('prompt', root, promptInput({ sessionId: `stop-${i}`, prompt: 'bench task', cwd }));
results.push(measure('stop-check, active task without receipt (blocks)', (i) => runHook('stop', root, stopInput({ sessionId: `stop-${i}`, cwd }))));
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, results }));
