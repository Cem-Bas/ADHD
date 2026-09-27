# ADHD — keep Claude Code anchored to your actual request

ADHD is an always-on Claude Code plugin. It makes scope, progress, research depth, limitations, and completion evidence visible so that correcting Claude stays cheap. It was designed for people who benefit from short steps, stable wording, visible state, and explicit completion checks. It does not diagnose or treat anything, it does not infer anything about you, and nothing in it depends on a diagnosis. The repository is named `ADHD`; the deep-research mode is named **Hyperfocus**.

## What it does

Every ordinary request you type becomes a task contract that the plugin stores verbatim. From then on Claude:

1. Opens its first substantive reply with a compact **TASK LOCK** (goal, deliverable, must-include list, constraints, mode, done-when) and starts working in the same turn.
2. Treats later messages as amendments and shows the delta as `Changed: <previous requirement> -> <corrected requirement>`. Only `/adhd:new`, a prompt starting with `New task:` or `Replace task:`, starts a new task. Only `/adhd:cancel`, or a whole message of `cancel`, `stop`, `stop this task`, or `cancel this task`, cancels one. "Stop doing X and do Y" is an amendment.
3. Reports `Done / Now / Next / Blocked / Coverage` at milestones, without invented percentages or time estimates.
4. Explains a refusal or limitation as a precise boundary review (blocked action, reason type, basis, what was completed, closest route) and keeps doing the unaffected work.
5. Cannot finish until the independent `adhd:contract-auditor` subagent has recorded a receipt bound to the task, contract version, request digest, and a one-time nonce, with every requirement PASS. Gaps start a focused repair cycle (at most six). After that the plugin demands a bounded-stop report and never calls the task complete.
6. Restores the original request, amendments, mode, phase, and open gaps after `/resume` or automatic compaction, so you never restate the task.

**Hyperfocus** (`/adhd:hyperfocus`, the preference `researchDepth=hyperfocus`, or a phrase such as "deep research", "research this deeply", or "exhaustive research") adds a claim-to-source ledger: up to four parallel source researchers, two independent evidence chains for disputed or unstable claims, contrary evidence, dated sources, and a coverage-gap pass before synthesis. The Stop hook checks the ledger against the support rules.

## Requirements

- Claude Code 2.1.271 or later (built and tested against 2.1.283).
- Node.js 20.11 or later on your `PATH`; the hooks run `node` directly with no shell, so no Bash, `jq`, or PowerShell is needed. Tested on Node 20, 22, and 24.
- macOS, Linux, or Windows.

## Install

The repository root is a local marketplace named `adhd-local`.

```bash
claude plugin marketplace add /absolute/path/to/ADHD
claude plugin install adhd@adhd-local
```

To try it for one session without installing:

```bash
claude --plugin-dir /absolute/path/to/ADHD
```

Start a new Claude Code session. The plugin is active for every session; there is no start command.

## Remove

```bash
claude plugin uninstall adhd@adhd-local
claude plugin marketplace remove adhd-local
```

Uninstalling leaves stored preferences and task records in place. Run `/adhd:data delete-all` before uninstalling if you want them gone (see Stored data).

## Commands

| Command | What it does |
| --- | --- |
| `/adhd:hyperfocus [request]` | Switch the active task, or the supplied request, to Hyperfocus deep research. |
| `/adhd:new [request]` | Close the current task without calling it complete and start a replacement. |
| `/adhd:status` | Show Done / Now / Next / Blocked, coverage of contract items, mode, and repair count. |
| `/adhd:contract` | Show the original request, every amendment verbatim, and the current Task Lock. |
| `/adhd:prefs [show \| set <key> <value> \| unset <key> \| reset] [--project]` | Inspect or change preferences; `--project` writes a project override. |
| `/adhd:why` | Re-evaluate the most recent restriction and explain it as a boundary review. |
| `/adhd:data show \| export \| delete-session \| delete-project \| delete-all` | Inspect, export, or explicitly delete stored plugin data. |
| `/adhd:cancel` | Cancel the active task immediately, with no cleanup or follow-on changes. |

Natural-language equivalents work: "what's the status?", "show me the contract", "cancel". You do not need to memorise the commands.

## Example: Standard mode

You: `Add a --json flag to the CLI and document it in the README.`

Claude:

```text
TASK LOCK
Goal: Add a --json output flag to the CLI and document it.
Deliverable: CLI change; README section for --json.
Must include: the flag, its output shape, README documentation.
Constraints: none stated
Mode: Standard
Done when: --json works in a run and the README describes it.

NOW: reading the CLI argument parser.
```

You: `Actually call it --format json, not --json.`

Claude: `Changed: --json flag -> --format json option` and continues. When it believes the work is done it invokes the contract auditor. If the auditor finds the README paragraph missing, the Stop hook blocks with `REPAIR 1 of 6` and the exact gap; Claude fixes it, re-audits, and only then finishes. Your terminal shows `ADHD: contract verified — COMPLETE (2/2 items PASS, 1 repair(s)).`

## Example: Hyperfocus mode

You: `/adhd:hyperfocus Which Node.js release line should a new CLI target this year?`

Claude decomposes the question (current LTS schedule, end-of-life dates, ecosystem support), runs up to four `adhd:source-researcher` subagents, records each claim and source in the ledger, seeks contrary evidence, and then answers in five sections: Sourced facts (with dates), Reasonable inferences, Recommendations, Unresolved questions (what evidence is missing and how it would change the answer), and Sources (url, publisher, date, chain id, confidence). A core claim with only one evidence chain is marked low confidence and listed under Unresolved; the Stop hook blocks if a core claim is unsupported and not listed there.

## How it works

Command hooks in `hooks/hooks.json` run small Node scripts. Nothing runs in a shell and prompt text is never interpolated into a command.

| Event | Script | Effect |
| --- | --- | --- |
| `UserPromptSubmit` | `scripts/prompt-context.mjs` | Applies `/adhd:*` controls, exact cancel/replace phrases, stores every ordinary prompt verbatim as the original request or the next amendment, detects Hyperfocus, and injects the Task Lock protocol plus the auditor invocation. |
| `SessionStart` (`startup`, `resume`, `clear`, `compact`, `fork`) | `scripts/restore-context.mjs` | On `resume` and `compact`, re-injects the ledger, mode, phase, gaps, and preferences. On `startup` runs retention cleanup. On `clear` closes an open task. |
| `PostToolUse`, `PostToolUseFailure`, `SubagentStart`, `SubagentStop` | `scripts/evidence-capture.mjs` | Records bounded evidence: tool name, call id, success, exit status, file paths, URLs, a hash and clipped preview of output, and subagent activity. |
| `Stop` | `scripts/stop-check.mjs` | Runs the deterministic checks (fresh nonce-bound receipt, PASS items, declared artifacts exist, referenced commands succeeded, Hyperfocus ledger coverage), marks COMPLETE, or blocks with a targeted repair instruction (max six), then a bounded-stop report (block seven), then stops. |

Skills (`skills/*/SKILL.md`) provide the `/adhd:*` commands; agents (`agents/*.md`) provide `adhd:contract-auditor`, `adhd:source-researcher`, and `adhd:evidence-verifier`. `scripts/state.mjs` is the only way state is written outside the hooks: `audit-record`, `evidence-add`, `artifact-declare`, `prefs`, `data`, and a few lifecycle commands, all with JSON in and JSON out.

Fail-open means the session is never trapped: malformed hook input, corrupted state, a missing transcript, a stuck lock, or an exception all end as a visible `DEGRADED_STOP` (never as a completion claim) or `CANCELLED`. The Stop hook issues at most seven consecutive blocks, below Claude Code's own cap of eight.

## Stored data

Durable data lives only in the plugin data directory Claude Code assigns (`~/.claude/plugins/data/adhd-adhd-local/` for the local marketplace; `~/.claude/plugins/data/adhd-local/` when loaded with `--plugin-dir`). Nothing is sent to any third-party backend; the researcher and auditor subagents are ordinary Claude Code subagents in your own session.

```text
preferences.json                       global preferences
projects/<project-key>/preferences.json project overrides (the key is a hash, not the path)
sessions/<session-id>.json             the task record for one Claude Code session
sessions/<session-id>.<task-id>.json   earlier finished tasks of that session
diagnostics/<session-id>.jsonl         bounded, redacted diagnostics
exports/                               files written by /adhd:data export
```

A session record holds the verbatim original request and amendments, mode, phase, preferences snapshot, evidence (declared files, command exit statuses, hashed and clipped tool output up to 128 KiB each, Hyperfocus claims and sources), the audit receipt, and repair state. It is capped at 2 MiB. Secrets that look like tokens, keys, or passwords are redacted from previews and diagnostics.

Retention: finished session records are deleted 30 days after they finish (preference `retentionDays`, 0–365); diagnostics after 14 days; an open task untouched for 90 days is treated as abandoned. Cleanup runs at session start. `/adhd:data show` lists everything with sizes, `/adhd:data export` writes a JSON export, and the delete commands remove exactly what they name; project-wide and all-data deletion show the targets first and require an exact confirmation phrase.

## Preferences

`/adhd:prefs show` displays every value with its source (default, global, or project). Nothing else is stored.

| Key | Values | Default |
| --- | --- | --- |
| `outputDetail` | `brief`, `standard`, `detailed` | `standard` |
| `chunkSize` | `one-action`, `small-batch` | `one-action` |
| `progressCadence` | `minimal`, `milestone`, `frequent` | `milestone` |
| `researchDepth` | `standard`, `hyperfocus` | `standard` |
| `sourceStrictness` | `standard`, `strict` | `standard` |
| `sourceVerification` | `true`, `false` | `true` |
| `taskLockDetail` | `compact`, `detailed` | `compact` |
| `repairCycles` | `0`–`6` | `6` |
| `approvalPolicy` | `material-only`, `always-ask` | `material-only` |
| `retentionDays` | `0`–`365` | `30` |

## Limitations

- The hooks enforce structure: verbatim capture, a fresh nonce-bound audit receipt, deterministic evidence checks, and the repair bound. The wording of the Task Lock, progress blocks, and boundary reviews is produced by the model and remains model-dependent.
- The plugin does not and cannot override Anthropic policy, operating-system permissions, your authorisation, or the law. It makes restrictions precise; it does not bypass them.
- Every ordinary request is audited before Claude may finish, which adds one subagent call per completed task (two or more when repairs happen).
- Claude Code has no per-agent wall-clock timeout. Researchers and the auditor are limited to 12 turns; the 120-second budget is an instruction in their prompts.
- The auditor's Bash access is limited to the `state.mjs audit-record` command by instruction and by its tool list, not by a permission rule.
- Prompts injected by the system (scheduled wakeups, loop wakeups, background-task notifications) are not part of the task ledger and never consume repair cycles.
- Behavioural targets (Task Lock validity, correction retention, Hyperfocus citation coverage) are measured with the evaluation corpus in `evals/`, not guaranteed.

## Measured latency

Measured on the release machine with `npm run bench` (Task 18 fills this table).

## Development

```bash
npm test                          # unit + integration tests (node --test)
npm run bench                     # hook latency p50/p95
claude plugin validate . --strict # manifest, hooks, skills, agents
```

See `CONTRIBUTING.md` for the workflow and `docs/architecture.md` for the design, the state machine, and the differences from the original specification. The behavioural evaluation corpus and how to run it are in `evals/README.md`.

## License

Apache-2.0. See `LICENSE`.
