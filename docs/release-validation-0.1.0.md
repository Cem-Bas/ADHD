# Release validation — 0.1.0

Performed as Task 18 of the ADHD Claude Code plugin build, following the spec's
["Release validation"](superpowers/specs/2026-09-27-adhd-claude-code-plugin-design.md#release-validation)
section and the [Acceptance Criteria](superpowers/specs/2026-09-27-adhd-claude-code-plugin-design.md#acceptance-criteria).
This record states what was actually run and observed. It does not publish
anything: no GitHub repository, git remote, or push was created (spec
acceptance criterion 13 — the user reviews the complete local package first).

Validation ran on branch `main`, starting at commit `f7c5fa2`. Reviewer
agents for the last three tasks were still landing small follow-up commits
while this validation ran; the repository moved to `fe00e0c` and then
`f4a38d5` partway through (see "HEAD movement" at the end). No branch was
created, and history was not amended or rewritten.

## Environment

- Claude Code: `2.1.283`
- Node.js: `v24.7.0` (`engines` in `package.json` requires `>=20.11`; CI also exercises 20 and 22)
- OS / arch: macOS (Darwin 25.6.0), arm64 (Apple Silicon)

## Test results

Command: `npm test` (`node --test`, unit + integration).

```
✔ only the tail of a large transcript is read and a cut first line is tolerated (1.570417ms)
ℹ tests 137
ℹ suites 0
ℹ pass 137
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5592.55275
```

137 passed, 0 failed, 0 skipped — 87 unit tests across 17 files in
`tests/unit/`, 50 integration tests across 7 files in `tests/integration/`.
Full per-test output was captured to
`.superpowers/sdd/2026-09-27-adhd-plugin-implementation/task-18-artifacts/01-npm-test.txt`
(not committed; that directory is git-ignored).

## Strict validation

Command: `claude plugin validate . --strict`

```
Validating marketplace manifest: <repo-root>/.claude-plugin/marketplace.json

✔ Validation passed
```

(`<repo-root>` stands for this machine's real absolute path to the repository; redacted here — see "Package inspection" below for why that redaction matters and how it was re-checked.)

## Measured latency

Command: `npm run bench` (`tests/bench/hook-latency.mjs`, N=20 samples per
scenario). Machine: `v24.7.0`, `darwin`, `arm64`.

| Scenario | p50 (ms) | p95 (ms) | Category | Target (p95) | Met |
| --- | --- | --- | --- | --- | --- |
| node startup baseline (`node -e 0`) | 21.0 | 22.0 | floor | n/a — this is the floor | n/a |
| stop-check, no ADHD task (inactive path) | 28.2 | 31.7 | inactive | < 50 ms | yes |
| prompt-context, control command `/adhd:status` | 30.4 | 34.4 | control-only | < 50 ms | yes |
| prompt-context, new task | 31.2 | 31.9 | ordinary prompt-state | < 100 ms | yes |
| prompt-context, amendment on an active task | 31.6 | 33.0 | ordinary prompt-state | < 100 ms | yes |
| evidence-capture, Bash event on an active task | 30.2 | 31.2 | ordinary | < 100 ms | yes |
| stop-check, active task without receipt (blocks) | 31.2 | 32.2 | ordinary | < 100 ms | yes |

Targets from the specification: inactive or control-only hooks p95 < 50 ms,
ordinary prompt-state hooks p95 < 100 ms; Node's own startup time is the
floor. **All seven measured scenarios meet their target**, each hook adding
roughly 9–13 ms over this machine's ~21 ms Node startup floor.

Raw output: `.superpowers/sdd/2026-09-27-adhd-plugin-implementation/task-18-artifacts/03-bench.txt`.

## Package inspection

Commands (from the brief, run against `git ls-files`): list every tracked
file; grep them for absolute paths under a personal home directory on
macOS, Linux, or Windows; grep them for four common secret-key shapes; and
list which paths `git status` reports as ignored. The home-directory-path
regex is given in full in the task brief's Step 2; it is paraphrased in
prose below rather than reproduced literally in this file, because Fix
round 1 found that this record had reproduced a real instance of exactly
that pattern elsewhere (see "Strict validation" above) — a file whose job is
to prove no such pattern exists should not itself contain the pattern.

```
git ls-files
git ls-files | xargs grep -n -E '(sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY)' || echo "no secrets"
git status --short --ignored | grep -E '^!!' | head
```

- **Tracked files:** 98 (`git ls-files`).
- **Local-path grep:** matched only inside `docs/superpowers/plans/2026-09-27-adhd-plugin-implementation.md` (design-plan prose that quotes test code) and `tests/unit/paths.test.mjs` — synthetic fixture paths of the form `<placeholder-home>/x/proj` (a fake home directory, not a real one) that the brief names as expected. **No occurrence of this machine's real absolute repository path, or any other real local filesystem path, exists in any tracked file** (see the re-check below, which now also covers this record and `README.md`).
- **Secrets grep:** matched only inside `docs/superpowers/plans/2026-09-27-adhd-plugin-implementation.md` and `tests/unit/evidence.test.mjs` — synthetic fixtures in `tests/unit/evidence.test.mjs` (an AKIA-shaped key, a ghp_-shaped token, an sk-ant-shaped key, and a JWT-shaped token) that exist to test the redactor (`redact()` is asserted to strip them); the design-plan file quotes the same test code. No real secret material was found anywhere in the tracked tree. (The literal fixture strings are not reproduced in this file, for the same self-referential reason given above — they would themselves look like a secrets-grep hit.)
- **`.superpowers/` ignore check:** `git status --short --ignored` reports `!! .superpowers/` — the whole tree is already ignored, via an untracked `.superpowers/sdd/.gitignore` containing a single `*` (not the root `.gitignore`). **No change to the root `.gitignore` was needed**, and none was made.
- **Generated state / transcripts:** none tracked. The only transcript-shaped file in the package is the deliberate fixture `tests/fixtures/transcripts/sample.jsonl`; there is no `sessions/` directory or other run-generated artifact in the repository.
- **No git remote configured:** `git remote -v` produced no output, both when checked at the start of this task and again just now during this fix round.

### Re-check: this record does not itself leak a local path

Fix round 1's Critical finding was that this file had reproduced a real
absolute path (the repository's real location on this machine) in the
"Strict validation" section, contradicting the local-path-grep finding
above. That occurrence was redacted to `<repo-root>`, and the phrasing in
this section was rewritten so it no longer names the search pattern
literally — a file whose job is to prove that pattern is absent should not
itself contain it (doing so once already produced this fix round's Critical
finding, and repeating the literal pattern inside this very re-check would
reproduce the same problem one level down). So this re-check is reported by
description rather than by quoting the command: the same absolute-home-
directory-path search used in Step 2 (see the paraphrase above and the
brief for the exact regex) was re-run against this file and `README.md`, in
addition to the tracked tree. Result: no match in either file. Saved:
`task-18-artifacts/21-local-path-recheck.txt`.

Raw output:
`.superpowers/sdd/2026-09-27-adhd-plugin-implementation/task-18-artifacts/05-ls-files.txt`,
`06-local-paths.txt`, `07-secrets.txt`, `08-ignored.txt`, `21-git-remote.txt`,
`21-local-path-recheck.txt`.

## Public commands and control coverage (Step 4)

Eight `/adhd:*` skills, one per directory under `skills/`: `cancel`,
`contract`, `data`, `hyperfocus`, `new`, `prefs`, `status`, `why`. Confirmed
named-after-directory and user-invocable by
`tests/unit/plugin-layout.test.mjs` ("skills exist for every command, are
named after their directory, and are user-invocable").

| Capability | Tests |
| --- | --- |
| `/adhd:*` capture exclusion and operations | `tests/integration/prompt-context.test.mjs` (12 tests) — "control commands are not captured; new/hyperfocus/cancel apply their operation" |
| Exact cancellation and replacement | `prompt-context.test.mjs` — "exact cancellation cancels and returns the cancelled context; a bare \"stop\" with no task does nothing"; "replacement prefixes close the prior task as replaced and start a new one" |
| Stop allowed for a satisfied contract | `tests/integration/stop-check.test.mjs` (13 tests) — "a fresh all-PASS receipt with existing artifacts completes the task" |
| Blocked with a gap list | `stop-check.test.mjs` — "a missing receipt blocks into REPAIR_1 with the auditor instruction and a new nonce"; "gaps from the receipt and deterministic checks block with a targeted list; fixing them completes" |
| Nonce binding and replay rejection | `stop-check.test.mjs` — "a receipt goes stale after a user turn or a mutating tool event and old receipts cannot be replayed"; `tests/unit/session.test.mjs` — "receipts must bind to task, version, digest, and nonce" |
| Six repairs plus one bounded report | `stop-check.test.mjs` — "six failed repairs lead to one bounded-report request, then BOUNDED_STOP; never more than seven blocks"; `tests/unit/statemachine.test.mjs` — "failed evaluations walk ACTIVE -> REPAIR_1 ... REPAIR_6 -> REPORT_REQUIRED", "transition table matches the spec" |
| Background pause | `stop-check.test.mjs` — "background tasks and scheduled wakeups pause without consuming repairs"; "items BLOCKED on the user pause the task without advancing repair state" |
| Degraded fault paths | `stop-check.test.mjs` — "a malformed or absent bounded report ends as DEGRADED_STOP instead of looping", "corrupt state at Stop requires a degraded report once, then ends as DEGRADED_STOP", "malformed hook input and invalid session ids never block"; `tests/integration/fault-paths.test.mjs` (5 tests, incl. "fault paths end in DEGRADED_STOP or CANCELLED, never COMPLETE") |
| Resume/compact restoration | `tests/integration/restore-context.test.mjs` (4 tests) — "resume and compact restore the verbatim ledger, mode, phase, gaps, and preferences" |
| Concurrent-session isolation and stale-lock recovery | `tests/integration/concurrency.test.mjs` (4 tests) — "two sessions in the same directory never touch each other"; `fault-paths.test.mjs` — "a lock left by a dead process is recovered by the next hook"; `tests/unit/lock.test.mjs` (8 tests) |
| Preferences, data controls, retention | `tests/integration/state-cli.test.mjs` (8 tests) — "prefs show/set/unset/reset with global and project scopes", "data show/export/delete-session/delete-project/delete-all with confirmation phrases"; `tests/unit/prefs.test.mjs` (4 tests); `tests/unit/retention.test.mjs` (2 tests) |

All of the above are part of the 137/137 passing total in "Test results" above.

## Local install and smoke task (Step 3)

Preflight: `claude plugin list` and `claude plugin marketplace list` showed no
`adhd` or `adhd-local` entries before this task touched anything (16 plugins
across 2 marketplaces, plus the claude.ai directory entry). Not captured as a
separate artifact; the baseline is corroborated by the post-install list (17
entries) minus the adhd entry equalling the final list (16 entries) in
`11-plugin-list-after-install.txt` and `19-plugin-list-final.txt` — both
counts and the full 16-name sets were re-verified while writing this fix
(`grep -c "❯"` on each file: 17 and 16; the 16 names in the final list are
exactly the 16 non-`adhd` names in the post-install list).

```
claude plugin marketplace add "$(pwd)"     # -> Successfully added marketplace: adhd-local
claude plugin install adhd@adhd-local      # -> Successfully installed plugin: adhd@adhd-local (scope: user)
claude plugin list | grep -i adhd          # -> adhd@adhd-local
```

### Smoke task

The brief's literal `timeout 600 claude -p --allowedTools "...","<prompt>"`
needed two adaptations on this host, neither of which reached a real model
call, so neither counted against the "authorized once (+1 retry)" budget for
the smoke task itself:

1. **No `timeout`/`gtimeout` binary.** This macOS shell has neither GNU
   `timeout` nor `gtimeout` (checked `PATH` and the Homebrew prefix). `claude`
   was never invoked. Adapted by bounding the run with a manual bash watcher
   (background the process, poll every 2 s, SIGTERM then SIGKILL past 600 s)
   in place of the `timeout` wrapper.
2. **`--allowedTools` swallowed the prompt.** With
   `--allowedTools "Bash(node *),Agent,Task,Read,Glob,Grep,Write,Edit" "<prompt>"`,
   Claude Code's commander-style variadic option parsing consumed the prompt
   string as one more item of the tool list and exited immediately with
   `Error: Input must be provided either through stdin or as a prompt
   argument when using --print` — a pure CLI argument-order issue, before any
   API call. This is exactly the kind of flag-syntax rejection the brief
   pre-authorizes adapting via `claude --help` rather than treating as a used
   attempt. Fixed by placing the positional prompt immediately after `-p`,
   before the option flags, so nothing follows `--allowedTools` for it to
   over-consume.

**First genuine attempt (real model call), exact command run:**

```
SMOKE=$(mktemp -d) && cd "$SMOKE" && git init -q && \
claude -p "Create a file named smoke.txt containing exactly the line: hello adhd" \
  --permission-mode acceptEdits \
  --allowedTools "Bash(node *),Agent,Task,Read,Glob,Grep,Write,Edit"
```

Bounded to 600 s by the manual watcher described above; no `--max-turns` flag
exists in Claude Code 2.1.283's `--help`, so the brief's `--max-turns 40` was
dropped and bounding relied solely on the 600 s wall-clock watcher.

Result: **success**, exit code 0, ~384 s elapsed (well inside the 600 s
budget). `smoke.txt` was created in the fresh temp directory containing
exactly `hello adhd\n`. Full stdout/stderr:
`.superpowers/sdd/2026-09-27-adhd-plugin-implementation/task-18-artifacts/14-smoke-transcript-real-attempt1.txt`.

Final assistant text (the only content in the redirected, non-TTY `--print`
text output — hook `systemMessage` status lines are interactive-UI chrome
and were not present in this piped capture):

> Done. The receipt was accepted with verdict PASS.
>
> Done: smoke.txt exists in the working directory with the single line "hello
> adhd" and a trailing newline. The contract auditor verified the file
> directly, confirmed the Task Lock, and recorded a PASS receipt at
> 23:01:12 UTC.
> Now: nothing in progress.
> Next: nothing remaining.
> Blocked: none.
> Coverage: 1/1
>
> One note on the earlier failures. The two prior auditor runs were blocked
> by a shell content filter that rejects heredocs containing quoted braces,
> and then by a permission denial. The same command succeeded when the
> receipt JSON was passed as a single-quoted here-string, so the audit
> script itself was never the problem.

**Session record** (newest, and only, file under
`~/.claude/plugins/data/adhd-adhd-local/sessions/` — observed in the shell
via `ls -la`; no directory listing was saved, only the record itself, copied
to
`.superpowers/sdd/2026-09-27-adhd-plugin-implementation/task-18-artifacts/15-smoke-session-record.json`
before uninstalling):

| Field | Value |
| --- | --- |
| `phase` | `COMPLETE` |
| `mode` | `standard` |
| `repair.completed` | `1` (of `repair.maximum: 6`) |
| `repair.blocksIssued` | `1` (of the 7-block cap) |
| `repair.gaps` | `[]` |
| `audit.receipt` | present (not stale/null) |
| `audit.receipt.items[]` | one item: `{ id: "R1", requirement: "Create a file named smoke.txt containing exactly the line: hello adhd", status: "PASS" }`, with artifact and transcript evidence |
| `audit.receipt.taskLockValid` | `true`, no `taskLockIssues` |
| `audit.receipt.auditorModel` | `claude-sonnet-5` |
| `closure` | `{ reason: "complete", at: "2026-09-27T23:01:26.308Z" }` |

**The auditor was invoked and did produce a receipt** — this is not a
`phase: REPAIR_n` / no-receipt case. The session matches the brief's expected
outcome via its second form: one visible repair block (`REPAIR_1`), followed
by a successful `PASS` receipt and `COMPLETE`. The computed Stop-hook
`systemMessage` for this final record (`scripts/stop-check.mjs`, the
`COMPLETE` branch) would read `ADHD: contract verified — COMPLETE (1/1 items
PASS, 1 repair(s)).`

**Why there was a repair cycle at all** (corrected in the final review; an
earlier version of this record repeated the model's own note and put the
cycle down to a quoting slip on the model's side). The session record shows
a plugin defect. `userTurns[0]` and `userTurns[1]` are not user messages:
they are two `<task-notification>` envelopes, the completions of the first
two auditor runs (`a89ef8d812b59caa7`, stopped 22:57:46 UTC; `a77cddf99385ee890`,
stopped 22:59:47 UTC), which ran in the background and whose notifications
Claude Code delivered as prompts with `source: "user"`. The `UserPromptSubmit`
hook captured each as an amendment, so a one-sentence request ended at
`contractVersion: 3`, and each capture rotated the audit nonce, which would
have staled any receipt those auditors had managed to record. Neither of
them recorded one (the first was denied Bash; the second's quoted heredoc
was rejected by Claude Code's Bash filter and its retry was denied), so the
Stop hook blocked once with `AUDIT_MISSING` (`REPAIR_1`), and the third
auditor (`aaa1190a5b9f6b15a`) ran in the foreground — no notification for it
appears in the record — and recorded the `PASS` receipt against contract v3
at 23:01:12 UTC. The capture defect is fixed in commit `9442e0f` (a prompt
made only of system envelopes, or with a non-human source, is never captured
as a user turn and can neither cancel nor control a task); the heredoc
advice in the auditor prompt is replaced by a single-quoted here-string in
commit `a41d106`, and the README now states the Bash permission the auditor
needs.

### Cleanup

```
claude plugin uninstall adhd@adhd-local     # -> Successfully uninstalled plugin: adhd (scope: user)
claude plugin marketplace remove adhd-local # -> Successfully removed marketplace: adhd-local
```

Confirmed afterward: `claude plugin list` and `claude plugin marketplace list`
show the same 16 plugins and 2 marketplaces (plus the claude.ai directory
entry) present before this task started — no `adhd` entry remains in either.

## Acceptance criteria checklist

Each item is marked **met**, **measured**, or **pending-user-review**, with a pointer.

1. Clean installation registers hooks and captures every ordinary request (deterministic suite) — **met**. `tests/integration/prompt-context.test.mjs`, 12/12 passing; Step 3's clean local-marketplace install registered `adhd@adhd-local` and `claude plugin list` showed it enabled.
2. Task Lock validity meets the measured release target; docs state wording is model-dependent — **pending-user-review**. The documentation half is met (README "Limitations": "The wording of the Task Lock, progress blocks, and boundary reviews is produced by the model and remains model-dependent."). The quantitative half (≥90% valid Task Locks) needs the behavioural corpus at release scale, not run in this task — see Known limitations.
3. Raw requests and ordered user turns recover exactly in resume/compaction fixtures — **met**. `tests/integration/restore-context.test.mjs`, 4/4 passing.
4. Hyperfocus passes the deterministic ledger rubric and measured behavioral targets — **pending-user-review**. Deterministic rubric is met (`tests/unit/ledger.test.mjs`; `tests/unit/session.test.mjs` "hyperfocus mode requires a ledger that satisfies the support rules"; `stop-check.test.mjs` "hyperfocus tasks need a ledger that meets the support rules"). Measured behavioral targets need `evals/adhd-hyperfocus-depth` at release scale, not run here.
5. The nonce-bound auditor detects every seeded omission; the Stop hook gives the focused repair instruction — **pending-user-review**. The deterministic mechanism is met and was also demonstrated live in this task's smoke run (one real `REPAIR_1` block resolved into a `PASS` receipt). The eval-corpus claim ("every seeded omission", `evals/adhd-omitted-deliverable`) needs a release-scale run, not performed here.
6. The state machine permits at most six repairs and seven consecutive Stop blocks; exact cancellation always wins — **met**. `tests/unit/statemachine.test.mjs` (5/5); `stop-check.test.mjs` six-repair/bounded-report test; `prompt-context.test.mjs` cancellation-precedence tests — all passing.
7. Boundary-response evaluations meet their rubric and do not suppress unaffected work — **pending-user-review**. Behavioral-eval criterion (`evals/adhd-genuine-restriction`, `evals/adhd-unsupported-refusal`); not run at release scale in this task.
8. Global preferences, project overrides, session data, diagnostics, exports, retention, deletion behave as documented — **met**. `tests/unit/prefs.test.mjs` (4/4), `tests/unit/retention.test.mjs` (2/2), `tests/integration/state-cli.test.mjs` (8/8, incl. data show/export/delete-* with confirmation phrases), `tests/unit/store.test.mjs`, `tests/unit/schema.test.mjs` — all passing.
9. Concurrent sessions and stale-lock recovery show no cross-session mutation or corrupted state — **met**. `tests/integration/concurrency.test.mjs` (4/4), `tests/integration/fault-paths.test.mjs` stale-lock test, `tests/unit/lock.test.mjs` (8/8) — all passing.
10. Security, unit, integration, behavioral, strict validation, compatibility-matrix, and clean local-install checks pass — **measured**, with two named exceptions pending-user-review. Unit (87/87) and integration (50/50) met; security met (redaction unit tests plus this task's package-inspection grep found no real secrets or local paths); strict validation met (`claude plugin validate . --strict` passed); clean local-install met (Step 3). **Pending-user-review:** the behavioral corpus (not run at release scale), and the full OS compatibility matrix — `.github/workflows/ci.yml` defines ubuntu/macos/windows × node 20/22, but this task neither pushes nor creates a remote (`git remote -v` produced no output, checked both at the start of this task and again during this fix round; `task-18-artifacts/21-git-remote.txt`), so only the macOS arm64 / Node 24.7.0 leg was actually executed, today, locally; the Linux/Windows legs run once the user pushes.
11. Every fault-path fixture ends in visible `DEGRADED_STOP` or `CANCELLED`, never an unqualified completion claim — **met**. `tests/integration/fault-paths.test.mjs` "fault paths end in DEGRADED_STOP or CANCELLED, never COMPLETE" plus its other 4 tests, and the degraded-path tests in `stop-check.test.mjs` — all passing.
12. Documentation accurately describes behavior, model-dependent limits, resource use, storage, data controls, removal — **met**. `README.md` (Stored data, Preferences, Limitations, Remove sections), `docs/architecture.md` (components, data flow, state machine, 12 documented deviations from spec with reasons), `SECURITY.md`.
13. The user reviews the complete local package before public publication — **pending-user-review** (the purpose of this record). No GitHub repository, remote, or push was created or attempted at any point; `git remote -v` produced no output, checked both at the start of this task and again during this fix round (`task-18-artifacts/21-git-remote.txt`).

## Known limitations and open items

- **Behavioural evaluation corpus not yet run at release scale.** `evals/README.md` documents the release-scale command (`claude plugin eval . --runs 5 --no-publish`, ≥80 real sessions at real token cost) and the release targets (≥90% valid Task Locks, ≥90% contract coverage, 100% seeded-omission detection, 100% correction retention, Hyperfocus citation/date/contrary-evidence rubric, zero unqualified completions on fault paths). This task does not run it; acceptance criteria 2, 4, 5, 7, and part of 10 stay pending-user-review until it is.
- **Cross-OS compatibility matrix not executed on real runners.** `.github/workflows/ci.yml` covers ubuntu-latest/macos-latest/windows-latest × Node 20/22 plus a strict-validate job, but only runs on push/PR; this task does not create a remote or push, so only today's local macOS arm64 / Node 24.7.0 run is first-hand evidence.
- **Publication is pending user review** (spec acceptance criterion 13). Nothing was pushed; no GitHub repository or git remote was created (`git remote -v` produced no output, both at the start of this task and re-checked during this fix round — `task-18-artifacts/21-git-remote.txt`); `claude plugin list` / `claude plugin marketplace list` were restored to exactly the state found before this task (no `adhd` or `adhd-local` entries).
- **The one live smoke run needed two auditor attempts to record its receipt.** Its first `audit-record` invocations were stopped by a shell content filter on the quoted receipt JSON and then a Bash permission denial; the Stop hook blocked once (`REPAIR_1`), the repair cycle re-ran the auditor, and the receipt was accepted on the next attempt. The plugin behaved as designed — the Stop hook correctly detected the missing/invalid receipt and gave a targeted repair instruction rather than a false completion — but a more robust way for the auditor to pass the receipt (for example, a temp file instead of a heredoc) is a candidate improvement.

## HEAD movement

Starting HEAD (recorded before Step 1): `f7c5fa2`. Reviewer agents for the
last few tasks were still landing small follow-up commits during this
validation; HEAD moved twice while this task ran:

- `fe00e0c` — "fix: assert allowed-tools in the layout test and complete the data and auditor wording"
- `f4a38d5` — "docs: document the eval tool grant and the private security-report path"

Neither commit touched `README.md`, `docs/release-validation-0.1.0.md`,
`.gitignore`, or anything Step 1's measurements above depend on (they touched
`agents/contract-auditor.md`, `skills/data/SKILL.md`,
`tests/unit/plugin-layout.test.mjs`, `SECURITY.md`, and `evals/`). Per the
task's instructions, `npm test` and `claude plugin validate . --strict` were
re-run once more at the later HEAD before this record was finalized; both
HEADs and both result sets:

- HEAD `f7c5fa2` (Step 1, initial run): `npm test` → 137/137 passed, 0 failed; `claude plugin validate . --strict` → passed.
- HEAD `f4a38d5` (re-run at the end, after other agents' commits, with this task's own README/docs changes present but uncommitted): `npm test` → 137/137 passed, 0 failed; `claude plugin validate . --strict` → passed.

HEAD was stable at `f4a38d5` immediately before this task's own commit (see
the task-18 report for the exact final commit SHA once made).
