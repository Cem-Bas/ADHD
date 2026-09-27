# Behavioural evaluation corpus

These cases exercise the failure modes the plugin targets: answering a nearby question, omitting a deliverable, dropping a correction, shallow Hyperfocus research, treating repeated coverage as independent evidence, missing contrary evidence, vague refusals, and genuine restrictions. Two multi-turn scenarios (resume after interruption, immediate cancellation) are covered by the deterministic integration tests instead.

## Running

```bash
claude plugin eval . --runs 5 --no-publish --allow-tools "Write,Edit,Bash(node *)"   # all cases, with and without the plugin
claude plugin eval . --case adhd-hyperfocus-depth --no-publish                          # one case (research only)
```

Three cases (`adhd-omitted-deliverable`, `adhd-correction-retention`, `adhd-unsupported-refusal`) ask Claude to create files. The eval runner gates `Write`, `Edit`, and `Bash` behind an operator grant, so pass `--allow-tools "Write,Edit,Bash(node *)"` when running them; without the grant their `file_exists` graders fail by design. The `Bash(node *)` grant lets the plugin's own `state.mjs` commands run inside the evaluated session.

Each run is a real Claude Code session on your own account; the whole corpus at five runs per case is at least 80 sessions (8 cases × 5 runs × with/without arms) and costs real tokens. The release target is at least 50 runs across the scenarios with results recorded together with the Claude Code and model versions used.

## Release targets (measured, not guaranteed)

- At least 90% valid Task Locks (goal preserves intent; deliverables and constraints cover every explicit requirement; correct mode; testable completion rule; no invented deliverable).
- At least 90% full contract-item coverage; 100% detection of the seeded omitted deliverable; 100% retention of the seeded correction.
- Hyperfocus: 100% citation coverage for core claims, 100% date checks for unstable claims, explicit handling of contrary evidence, correct independence grouping.
- Zero unqualified completion claims on fault-path fixtures (enforced by `tests/integration/fault-paths.test.mjs`).

Results are exploratory product evidence, not claims about all people with ADHD or learning disabilities. Store run reports under `evals/results/` (git-ignored).
