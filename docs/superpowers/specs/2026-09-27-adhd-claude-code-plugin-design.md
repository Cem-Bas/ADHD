# ADHD Claude Code Plugin Design

**Date:** 2026-09-27

**Repository:** `ADHD`

**Plugin ID:** `adhd`

**Initial release:** `0.1.0`

**Status:** Conversational design approved; written-spec review pending

## Purpose

ADHD is an always-on Claude Code plugin that keeps work anchored to the user's actual request. It makes scope, progress, research depth, limitations, and completion evidence visible. It is designed to reduce working-memory demands and make correction inexpensive, particularly for people who benefit from short steps, stable wording, visible state, and explicit completion checks.

The plugin does not diagnose ADHD or learning disabilities, claim that one workflow fits every person, or provide treatment. Its preferences describe interaction needs rather than medical traits. The repository name is `ADHD`; the optional deep-research mode is named **Hyperfocus**.

## Problem

The plugin addresses five recurring failures:

1. Claude answers a nearby question rather than the one the user asked.
2. Claude performs shallow research after the user explicitly requests depth.
3. Claude gives vague or unsupported refusals instead of identifying the exact boundary.
4. Claude silently loses constraints, corrections, or the original goal during long work.
5. Claude declares completion without checking every requested deliverable.

## Design Basis

The interaction model adapts instructional practices from the U.S. Department of Education guide *Teaching Children with Attention Deficit Hyperactivity Disorder: Instructional Strategies and Practices* (2006): individualize around needs and strengths; preview the plan; state expectations and required resources; simplify instructions and choices; divide work into smaller units; provide visible reminders; check understanding during work; warn before transitions; use immediate, specific feedback; support self-monitoring; and verify work at the end.

These principles are adapted for adult interaction with an AI coding assistant. They are product-design inputs, not medical claims. W3C cognitive-accessibility guidance further supports visible purpose, short task paths, feedback, reduced memory demands, progress indicators, undo, and user-controlled personalization.

## Goals

- Preserve the exact user request and all explicit amendments.
- Display a compact task contract before substantial work, then begin immediately.
- Keep one current action and a visible `Done / Now / Next / Blocked` state.
- Provide an explicit Hyperfocus research mode with measurable evidence requirements.
- Audit completion against the entire request and automatically repair identified gaps.
- Explain genuine restrictions precisely while continuing unaffected work.
- Learn only transparent, user-editable interaction preferences.
- Work as an installable public Claude Code CLI plugin on macOS, Linux, and Windows where Node is available.
- Remain cancellable and bounded under every condition.

## Non-goals

- Overriding Anthropic policies, operating-system permissions, user authorization, or applicable law.
- Treating legality as proof that a provider must allow an action.
- Diagnosing, treating, or inferring ADHD, learning disabilities, intelligence, personality, or mental state.
- Retraining Claude or claiming that preference storage changes the underlying model.
- Supporting Claude.ai, Claude Desktop chat, Codex, or other assistants in the first release.
- Running an infinite autonomous loop.
- Publishing the repository before the user reviews the completed local implementation.

## Terminology

- **Task Contract:** The preserved original request, amendments, deliverables, constraints, mode, and definition of done.
- **Task Lock:** The compact, visible rendering of the active Task Contract.
- **Standard mode:** The default workflow, including source verification for factual and time-sensitive claims.
- **Hyperfocus mode:** The explicit deep-research workflow.
- **Repair cycle:** One continuation triggered by the completion auditor to address a specific gap.
- **Material claim:** A claim that affects the conclusion, recommendation, decision, or requested deliverable.

## User Experience

### Automatic activation

Installing and enabling the plugin activates it for every Claude Code session. The user does not need to run a start command. Plugin control commands are excluded from ordinary task capture.

For a new request, the first substantive response begins with:

```text
TASK LOCK
Goal: ...
Deliverable: ...
Must include: ...
Constraints: ...
Mode: Standard | Hyperfocus
Done when: ...

NOW: ...
```

Claude begins useful work in the same turn. It waits only when a missing fact would materially change the deliverable, when authorization is genuinely absent, or immediately before a consequential external action that requires approval.

### Amendments and corrections

While a task is active, new user instructions steer or amend it unless the user uses `/adhd:new` or begins the prompt with the exact, case-insensitive prefix `New task:` or `Replace task:`. The hook records every ordinary user turn verbatim and leaves semantic classification to the contract auditor. Claude displays the smallest useful delta:

```text
Changed: previous requirement -> corrected requirement
```

The raw original request is never overwritten. Each amendment is appended with its order and timestamp. Later explicit corrections take precedence over earlier conflicting instructions. Questions, answers to Claude's questions, status requests, and corrections remain part of the active task instead of silently replacing it.

Cancellation is deterministic only for `/adhd:cancel` or when the entire trimmed prompt matches `cancel`, `stop`, `stop this task`, or `cancel this task`, with optional terminal punctuation. Phrases such as "stop doing X and do Y" are amendments. Cancellation stops immediately and performs no cleanup, deletion, extra revision, or follow-on action unless requested.

### Progress visibility

At meaningful milestones, Claude reports:

```text
Done: objectively completed items
Now: the single current action
Next: the next concrete action
Blocked: the exact blocker and what resolves it
Coverage: completed contract items / total contract items
```

The plugin does not invent percentages or completion times. Long operations restore this state after interruptions or context compression rather than asking the user to repeat prior context.

## Research Modes

### Standard mode

Standard mode is always active and requires:

- Verification of unstable or time-sensitive facts.
- Preference for primary or authoritative sources when practical.
- Direct citations for externally sourced material claims.
- Clear separation of sourced fact, inference, and recommendation.
- Disclosure of material uncertainty.

### Hyperfocus mode

Hyperfocus mode activates through `/adhd:hyperfocus`, an explicit preference, or unambiguous phrases such as "deep research," "research this deeply," or "exhaustive research." It does not activate merely because a prompt is long.

Hyperfocus mode must:

1. Decompose the request into answerable research questions.
2. Identify which claims are current, disputed, consequential, or dependent on weak evidence.
3. Assign distinct questions to parallel source researchers when there are at least two independent research questions and parallel work is expected to reduce elapsed time. The default cap is four concurrent researchers.
4. Prefer current primary and authoritative sources.
5. Corroborate central or disputed claims with independent evidence chains under the support rules below.
6. Seek contrary evidence and record material disagreements.
7. Maintain a claim-to-source ledger with source date and confidence.
8. Run a coverage-gap pass before synthesis.
9. Distinguish sourced facts, reasonable inferences, recommendations, and unresolved questions.
10. Stop only when every research question meets the support rules or the remaining evidence gap is explicitly reported.

Two evidence chains are independent only when neither republishes or merely cites the same originating claim, dataset, press release, or analysis, and they come from separate authoring institutions or independently collected evidence. Multiple pages from one institution count as one chain unless they document independently collected evidence. Several articles repeating the same underlying source count as one evidence chain. A high source count alone does not satisfy Hyperfocus mode.

The version 1 claim ledger contains:

```text
claimId, text, class, stability, controversy, confidence, rationale
sources[]: url, title, publisher, publicationDate, accessedAt,
           sourceType, evidenceChainId, relation
unresolved[]
```

- `class` is `core`, `supporting`, or `background`.
- `stability` is `stable` or `unstable`.
- `controversy` is `disputed` or `undisputed`.
- `relation` is `supports`, `contradicts`, or `context`.
- `confidence` is `high`, `moderate`, or `low`.

Support is adequate when all core claims have direct citations, every unstable claim has a date check, every core stable and undisputed claim has at least one primary or authoritative source, and every core disputed or unstable claim has two independent authoritative evidence chains when they exist. When a second independent chain cannot be found after a targeted search, the claim is marked low confidence and the gap is reported. Supporting claims require one credible source or an explicit inference label. High confidence requires at least two independent high-authority chains with no unresolved material contradiction; moderate confidence requires one strong chain or multiple consistent weaker chains; low confidence covers sparse, indirect, or conflicting evidence.

A material disagreement is one that could change the answer, recommendation, risk, or requested decision. Hyperfocus may finish with an unresolved question only when the missing evidence and its effect on the conclusion are visible.

## Boundary Review

Before refusing or redirecting a request, Claude must identify the smallest exact action under review and distinguish among:

- Platform or provider restriction.
- Law or regulation.
- Missing authorization, privacy protection, or credential.
- Missing information or unavailable tool.
- Technical limitation.
- Uncertainty that requires verification.

A boundary response contains:

```text
Blocked action: the smallest exact portion that cannot be completed
Reason type: one of the categories above
Basis: the specific public rule or verified fact when available
Completed: requested portions already completed and unaffected
Closest route: the smallest permissible change that preserves the goal
```

Claude must not invent a policy, claim an action is illegal without support, moralize, or silently answer a different question. Genuine restrictions remain binding. The plugin improves precision and scope; it does not bypass them.

## Completion and Automatic Repair

The canonical Task Contract is the versioned raw request ledger, not Claude's summary. It consists of the original prompt, ordered user turns, explicit replacement and cancellation controls, effective preferences, and deterministic precedence rules. The visible Task Lock is a projection that the auditor checks against this ledger.

Before allowing an ordinary task to stop, the plugin requires a fresh completion audit that reads:

- The raw original request.
- Every explicit amendment and correction.
- The canonical request ledger and visible Task Lock.
- Required artifacts, sources, tests, or external-state evidence.

Each contract item receives one status:

- `PASS`: Completed with verifiable evidence.
- `PARTIAL`: Some requested work or evidence is missing.
- `BLOCKED`: Completion depends on an unresolved external condition or required user fact.

The main agent must invoke the bundled `adhd:contract-auditor` custom subagent before completion. The auditor receives the session-state path, transcript path, task ID, contract version, and a one-time audit nonce. It independently derives the requirement list from the canonical ledger, inspects the transcript and evidence registry, and records a structured receipt by passing JSON over standard input to `state.mjs audit-record`. The helper accepts a receipt only when its task ID, contract version, request digest, and nonce match the active state. The receipt contains the itemized verdict, gaps, evidence references, auditor model, and timestamp. Any later user turn or evidence mutation invalidates it.

This uses a stable custom subagent invoked by the main agent. Version 1 does not depend on experimental agent-based hooks. If Claude omits the auditor, the Stop hook requests it as the next repair action.

The plugin does not permit a normal completion claim while a required item is `PARTIAL` or `BLOCKED`. A failed audit starts a focused repair cycle containing only the identified gaps and relevant contract context. The maximum is six repair cycles per task.

The state machine is:

```text
IDLE -> ACTIVE
ACTIVE -> COMPLETE | REPAIR_1 | CANCELLED | DEGRADED_REPORT_REQUIRED
REPAIR_1 -> COMPLETE | REPAIR_2 | CANCELLED | DEGRADED_REPORT_REQUIRED
...
REPAIR_6 -> COMPLETE | REPORT_REQUIRED | CANCELLED
REPORT_REQUIRED -> BOUNDED_STOP
DEGRADED_REPORT_REQUIRED -> DEGRADED_STOP
COMPLETE | BOUNDED_STOP | DEGRADED_STOP | CANCELLED -> IDLE on next new task
```

The initial failed Stop decision starts `REPAIR_1`. Each later failed evaluation advances one repair state. After `REPAIR_6` fails, the hook blocks once more with instructions to produce a bounded-stop report listing unresolved items, evidence gathered, the exact blocker, and the smallest next action. The next Stop verifies that report and allows `BOUNDED_STOP`; it must not label the task complete. This uses at most seven consecutive Stop-hook continuations, below Claude Code's default cap of eight.

`stop_hook_active: true` identifies a continuation already caused by the hook. It does not automatically bypass validation. The hook reads the explicit state, continues only while the next state is resolvable, and never exceeds the seven-block design limit. If the final bounded report is malformed, the hook allows a visible `DEGRADED_STOP` rather than risking an unbounded loop.

## Architecture

### Package structure

```text
ADHD/
|-- .claude-plugin/
|   |-- plugin.json
|   `-- marketplace.json
|-- skills/
|   |-- hyperfocus/SKILL.md
|   |-- new/SKILL.md
|   |-- status/SKILL.md
|   |-- contract/SKILL.md
|   |-- preferences/SKILL.md
|   |-- why/SKILL.md
|   |-- data/SKILL.md
|   `-- cancel/SKILL.md
|-- agents/
|   |-- source-researcher.md
|   |-- evidence-verifier.md
|   `-- contract-auditor.md
|-- hooks/
|   `-- hooks.json
|-- scripts/
|   |-- prompt-context.mjs
|   |-- restore-context.mjs
|   |-- evidence-capture.mjs
|   |-- stop-check.mjs
|   |-- state.mjs
|   `-- common/
|-- tests/
|   |-- unit/
|   |-- integration/
|   `-- fixtures/
|-- evals/
|-- docs/
|-- README.md
|-- CONTRIBUTING.md
|-- SECURITY.md
|-- LICENSE
`-- package.json
```

The runtime uses dependency-free JavaScript modules and Node's standard library. The minimum versions are Node 20.11 and Claude Code 2.1.271. Hooks invoke `node` with a fixed script path and argument array. User prompt text is passed through JSON or standard input and is never interpolated into executable shell source.

### Hook flow

#### `SessionStart`

A command hook matching `startup`, `resume`, `clear`, `compact`, and `fork` loads the exact session record when one exists. On `resume` and `compact`, it returns `additionalContext` containing the original request, ordered amendments, mode, current state, unresolved gaps, effective preferences, and audit freshness. This is the recovery path after automatic compaction; `PostCompact` may record diagnostics but is not relied on to inject context. On `startup`, `clear`, or `fork`, the hook creates or selects the correct isolated session state without copying an unrelated active task.

#### `UserPromptSubmit`

The command hook receives Claude Code's hook JSON through standard input. It:

1. Exits quickly for plugin control commands after applying the requested control operation.
2. Resolves the session ID and working directory.
3. Loads preferences and any active session record.
4. Applies exact cancellation or replacement patterns, then stores the raw prompt as the original request or next ordered user turn.
5. Detects explicit Hyperfocus phrases and records the requested mode.
6. Invalidates any older audit receipt and writes state atomically.
7. Returns additional context containing the canonical ledger, its digest, preferences, Task Lock protocol, evidence protocol, and instruction to begin immediately.

The hook preserves text; it does not attempt to rewrite the user's prompt. Semantic summarization remains visible and reviewable in Claude's Task Lock. The Task Lock includes the contract version and short request digest so the final audit can be tied to the same input.

#### `PostToolUse` and `PostToolUseFailure`

Command hooks append bounded evidence records for relevant tool activity: tool name, call ID, timestamp, success or failure, exit status when present, affected file paths, source URLs, and a hash of clipped output. A single captured result is limited to 128 KiB and a session ledger to 2 MiB. Secret-like values and unrelated output are not copied into diagnostics. Hyperfocus researchers add structured claims and sources through `state.mjs evidence-add`, with JSON supplied over standard input.

#### `Stop`

The command hook:

1. Exits immediately when no ADHD task is active.
2. Honors cancellation before every other check.
3. If background tasks or scheduled wakeups are still active, allows the pause without advancing repair state.
4. Interprets `stop_hook_active` together with the stored state rather than blindly allowing or blocking.
5. Loads `last_assistant_message`, the transcript when available, and state for the exact session.
6. Runs deterministic checks for state integrity, current audit receipt, declared artifacts, configured commands, Hyperfocus ledger coverage, and repair state.
7. Requires a fresh contract-auditor receipt for semantic alignment.
8. Allows the stop and marks `COMPLETE` only when every required item passes.
9. Otherwise advances the state machine atomically and blocks with a targeted gap list or bounded-report instruction.
10. Allows `BOUNDED_STOP` or `DEGRADED_STOP` with visible non-completion language when verification cannot pass.

Deterministic checks take precedence over model claims. The independent auditor evaluates meaning and scope but cannot override a failed command, missing artifact, absent citation, stale receipt, or other objective failure.

### Agents

- **Source researcher:** Investigates one bounded research question and returns primary sources, dates, key findings, contrary evidence, and open questions.
- **Evidence verifier:** Checks source authority, independence, date, claim support, and contradictions without seeing the intended conclusion.
- **Contract auditor:** Compares the canonical request ledger with the visible Task Lock, result, and evidence. It records a nonce-bound audit receipt containing itemized `PASS`, `PARTIAL`, or `BLOCKED` decisions.

Agents receive only the context required for their role. Hyperfocus runs at most four independent source researchers by default. Researchers and the auditor use a fast configured model, a maximum of 12 turns each, and a 120-second timeout. The contract auditor runs in a separate context from the main worker and has access only to read tools plus the exact state-recording helper command.

## State and Preferences

Durable plugin data lives under `${CLAUDE_PLUGIN_DATA}` and never inside `${CLAUDE_PLUGIN_ROOT}`.

```text
${CLAUDE_PLUGIN_DATA}/
|-- preferences.json
|-- projects/<project-key>/preferences.json
|-- sessions/<session-id>.json
|-- exports/
`-- diagnostics/<session-id>.jsonl
```

The project key is derived from a normalized project path without exposing that path as a filename. Session IDs are validated before use. Paths cannot escape the plugin data directory.

### Session record

The canonical version 1 session schema is:

```json
{
  "schemaVersion": 1,
  "sessionId": "validated-session-id",
  "taskId": "random-task-id",
  "contractVersion": 1,
  "requestDigest": "sha256:...",
  "cwd": "/normalized/project/path",
  "phase": "ACTIVE",
  "mode": "standard",
  "originalRequest": {
    "text": "verbatim user input",
    "receivedAt": "ISO-8601"
  },
  "userTurns": [
    {
      "sequence": 1,
      "text": "verbatim user input",
      "receivedAt": "ISO-8601"
    }
  ],
  "preferencesSnapshot": {},
  "evidence": {
    "artifacts": [],
    "commands": [],
    "toolEvents": [],
    "claims": [],
    "sources": []
  },
  "audit": {
    "nonce": "single-use-random-value",
    "receipt": null,
    "invalidatedAt": null
  },
  "repair": {
    "completed": 0,
    "maximum": 6,
    "gaps": []
  },
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "expiresAt": "ISO-8601"
}
```

Allowed `phase` values are `IDLE`, `ACTIVE`, `REPAIR_1` through `REPAIR_6`, `REPORT_REQUIRED`, `DEGRADED_REPORT_REQUIRED`, `COMPLETE`, `BOUNDED_STOP`, `DEGRADED_STOP`, and `CANCELLED`. Allowed `mode` values are `standard` and `hyperfocus`. The schema rejects unknown security-sensitive fields but permits a versioned `extensions` object for forward-compatible non-executable metadata.

The raw request ledger plus precedence rules is the source of truth. The visible Task Lock, progress summaries, claim ledger, and audit receipt are derived records. `UserPromptSubmit` produces request entries; tool hooks produce objective evidence; research agents produce claims and sources through `evidence-add`; and the contract auditor alone produces audit receipts through `audit-record`.

State writes use a temporary sibling file followed by an atomic rename. A per-session lock directory contains owner PID, process-start fingerprint, hostname, and acquisition time. A lock is stale only when its owner process is provably absent on the same host or it exceeds five minutes with no matching live process; stale recovery is an atomic rename into diagnostics. Separate session files prevent two Claude sessions from overwriting one another.

Each session record is capped at 2 MiB. Oversized tool output is represented by a hash, byte count, and clipped preview. The plugin never truncates raw user turns silently; when the task ledger would exceed the cap, it enters `DEGRADED_REPORT_REQUIRED`, preserves the existing state, and reports the storage limit.

Completed, cancelled, bounded-stop, and degraded-stop session records are retained for 30 days by default, configurable from 0 to 365 days. Diagnostics are retained for 14 days. Cancellation changes state but does not delete data. Deletion occurs only through an explicit data command or retention cleanup at a later session start.

### Preference model

Global preferences apply across repositories. Project preferences override only specified keys. Defaults are:

- Compact Task Lock.
- One current action at a time.
- Milestone progress updates.
- Standard answer detail.
- Standard research mode.
- Source verification enabled.
- Six repair cycles.
- Approval only for material ambiguity, missing authority, or consequential external action.

Editable preferences include output detail, chunk size, progress cadence, research depth, source strictness, and Task Lock detail. `/adhd:prefs` displays effective values and their source. Users can edit, remove project overrides, or reset all preferences. No hidden preferences are stored.

## Commands

- `/adhd:hyperfocus [request]`: Enable Hyperfocus for the supplied request or active task.
- `/adhd:new [request]`: Close the prior task state without calling it complete and begin a replacement task.
- `/adhd:status`: Show `Done / Now / Next / Blocked`, coverage, mode, and repair count.
- `/adhd:contract`: Show the original request, amendments, and current contract.
- `/adhd:prefs`: Inspect, set, reset, or apply project overrides.
- `/adhd:why`: Re-evaluate and precisely explain the most recent restriction or limitation.
- `/adhd:data show|export|delete-session|delete-project|delete-all`: Inspect, export, or explicitly delete stored plugin data. Project-wide and all-data deletion first show the exact targets and require an exact confirmation phrase.
- `/adhd:cancel`: Mark the active task cancelled and stop immediately.

Natural-language equivalents remain valid. Users are not required to memorize commands.

## Error Handling

- **No active state:** Hooks exit successfully without blocking.
- **Corrupted state:** Move the unreadable record to diagnostics, set degraded verification, and require a visible degraded-stop report before allowing the turn to end.
- **Missing transcript:** Audit from the raw ledger, captured evidence, and `last_assistant_message`; if those are insufficient, enter degraded verification rather than claiming completion.
- **Invalid session ID or path:** Reject the state operation, emit a visible diagnostic, and never emit an unqualified completion decision.
- **Auditor failure:** Retry only within the existing repair budget; if unavailable, require a degraded-stop report stating that semantic verification could not be completed.
- **Hook continuation:** Process `stop_hook_active` through the explicit phase and counter. Block no more than seven consecutive times.
- **Cycle exhaustion:** After six repairs, require one bounded report and then stop without claiming completion.
- **Cancellation:** Takes precedence over audits, repairs, and cleanup.
- **Unexpected exception:** Emit a minimal user-facing diagnostic without exposing secrets or full transcript content.

Fail-open means the CLI session is never trapped. It does not mean the task receives a `COMPLETE` state. Every fault path ends as `DEGRADED_STOP` with a visible verification warning or as `CANCELLED`.

## Security and Privacy

- Treat prompts, transcripts, hook input, tool output, and stored state as untrusted data.
- Parse structured input with real JSON parsers.
- Never evaluate user content or place it in shell source.
- Validate session IDs, file names, and resolved paths.
- Use restrictive file permissions where the platform supports them.
- Keep diagnostics concise and redact secrets, credentials, and unrelated transcript content.
- Do not send preference or task state to a third-party backend. Claude subagents used for research and auditing remain part of the user's Claude Code session and are disclosed as model calls.
- Provide inspect, export, reset, and delete controls for stored preferences and session state.
- Keep plugin source immutable at runtime; store durable data only in the documented plugin data directory.

## Compatibility and Resource Bounds

- Minimum Claude Code version: 2.1.271.
- Minimum Node version: 20.11.
- Tested CI matrix: current GitHub-hosted macOS, Ubuntu, and Windows images with Node 20 and 22.
- Hook commands use Claude Code's command-plus-args form and do not depend on Bash, `jq`, `sed`, `perl`, or PowerShell parsing.
- Inactive or control-only command hooks target p95 latency below 50 ms; ordinary prompt-state hooks target p95 below 100 ms on the CI matrix.
- The contract auditor uses at most 12 turns and 120 seconds. Hyperfocus starts at most four source researchers by default, each limited to 12 turns and 120 seconds.
- The plugin reports active researcher count and repair count. It does not invent dollar estimates when model pricing or token totals are unavailable.
- Version 1 does not use experimental agent-based hooks. A future opt-in release may evaluate them separately.

## Testing Strategy

### Unit tests

- Exact preservation of prompts containing quotes, newlines, Unicode, shell syntax, and command substitutions.
- JSON schema versioning, validation, migration, and corruption handling.
- Atomic writes, lock contention, stale-lock recovery, and process termination during every state transition.
- Global preferences and project override resolution.
- Hyperfocus phrase detection and explicit command activation.
- Claim-ledger validation, source-chain independence, confidence rules, and no-evidence behavior.
- State-machine transitions, six repairs, bounded reporting, and immediate cancellation.
- Session-ID and path traversal rejection.
- State-size limits, clipping, hashing, retention, export, and explicit deletion.

### Hook integration tests

- New request capture and visible Task Lock context.
- Amendment ordering and correction precedence.
- Exact cancellation, replacement prefixes, answer turns, status prompts, and non-cancelling uses of words such as "stop".
- Control commands excluded from ordinary capture.
- Stop allowed for fully satisfied contracts.
- Stop blocked with a targeted gap list for missing work.
- Nonce-bound auditor receipts are required, become stale after mutations, and cannot be replayed across tasks.
- Missing transcripts, malformed hook input, and corrupted state end with visible degraded verification rather than a completion claim.
- Two simultaneous sessions remain isolated.
- `SessionStart` on `resume` and `compact` restores the original request, amendments, mode, phase, preferences, and gaps.
- Background tasks and scheduled wakeups do not consume repair cycles.
- The Stop hook issues no more than seven consecutive block decisions.

### Behavioral evaluations

Run realistic prompts repeatedly with and without the plugin. Scenarios include:

- Answering a plausible nearby question instead of the requested one.
- Omitting a required deliverable while claiming completion.
- Ignoring a correction made mid-task.
- Returning shallow research in Hyperfocus mode.
- Treating repeated secondary coverage as independent evidence.
- Missing contrary evidence or an important unresolved claim.
- Giving a vague or unsupported refusal for an allowed request.
- Correctly limiting a genuine platform or authorization restriction.
- Resuming after interruption without making the user restate the task.
- Cancelling immediately without cleanup or further changes.

The release evaluation corpus contains at least 50 runs across the scenarios above, using the Claude Code and model versions recorded with the results. A Task Lock is valid when its goal preserves the user's intent, its deliverables and constraints cover every explicit requirement, its mode is correct, its completion rule is testable, and it invents no adjacent deliverable. Release targets are at least 90% valid Task Locks, at least 90% full contract-item coverage, 100% detection of deliberately seeded required-item omissions, 100% retention of explicit corrections in the fixed correction suite, and zero unqualified completion claims on fault-path fixtures.

Hyperfocus scoring requires 100% citation coverage for core material claims, 100% date checks for unstable claims, explicit handling of every seeded contradiction, correct independence grouping for repeated-source fixtures, and a visible gap whenever the support rules cannot be met. Model-dependent results are reported as measured targets rather than deterministic guarantees.

Additional measures include unsupported-refusal rate, correction turns, abandonment, and perceived effort. Results are exploratory product evidence, not claims about all people with ADHD or learning disabilities.

### Release validation

- Run the Node test suite on macOS, Linux, and Windows.
- Run strict Claude plugin validation.
- Install from a clean local marketplace and execute a smoke task.
- Confirm every public command and natural-language equivalent.
- Confirm the plugin is inert after cancellation, cannot exceed six repairs, and cannot exceed seven Stop-hook blocks including bounded reporting.
- Inspect package contents for secrets, local paths, transcripts, and generated state.
- Measure hook latency and verify the documented state-size and retention bounds.

## Public Distribution

The public repository includes:

- Clear installation and removal instructions.
- A concise explanation of automatic behavior and stored data.
- Standard and Hyperfocus examples.
- Limitations, including the inability to override real platform policy.
- Preference inspection and deletion instructions.
- Apache-2.0 license.
- Contribution and security-reporting guidance.
- Claude marketplace metadata referencing the repository root.

The first release is `0.1.0`. Before producing each subsequent build or release, increment the plugin version. Public publication occurs only after the user reviews the completed local repository and exact release contents.

## Acceptance Criteria

The first release is complete when:

1. A clean installation registers the automatic hooks and captures every ordinary request in the deterministic integration suite. An ordinary request is any submitted user prompt other than an ADHD control command or exact cancellation/replacement control.
2. Task Lock validity meets the measured release target, and documentation states that visible wording remains model-dependent.
3. Raw requests and ordered user turns recover exactly in resume and compaction fixtures.
4. Hyperfocus passes the deterministic ledger rubric and measured behavioral targets.
5. The nonce-bound contract auditor detects every seeded omission and the Stop hook provides the corresponding focused repair instruction.
6. The state machine permits at most six repairs and seven consecutive Stop-hook blocks, while exact cancellation always takes precedence.
7. Boundary-response evaluations meet their rubric and do not suppress unaffected requested work.
8. Global preferences, project overrides, session data, diagnostics, exports, retention, and deletion behave as documented.
9. Concurrent sessions and stale-lock recovery tests show no cross-session mutation or corrupted state.
10. Security, unit, integration, behavioral, strict plugin validation, compatibility-matrix, and clean local-install checks pass.
11. Every fault-path fixture ends in visible `DEGRADED_STOP` or `CANCELLED`, never an unqualified completion claim.
12. Documentation accurately describes behavior, model-dependent limits, resource use, storage, data controls, and removal.
13. The user reviews the complete local package before public publication.

## References

- U.S. Department of Education, *Teaching Children with Attention Deficit Hyperactivity Disorder: Instructional Strategies and Practices* (2006): https://www.ed.gov/media/document/teaching-children-attention-deficit-hyperactivity-disorder-instructional-strategies-and-practices-2006-62756.pdf
- W3C, *Making Content Usable for People with Cognitive and Learning Disabilities*: https://www.w3.org/TR/coga-usable/
- Anthropic, *Claude Code Plugins*: https://code.claude.com/docs/en/plugins
- Anthropic, *Create Plugins*: https://code.claude.com/docs/en/plugins/create
- Anthropic, *Plugin Components*: https://code.claude.com/docs/en/plugins/components
- Anthropic, *Claude Code Hooks*: https://code.claude.com/docs/en/hooks
- Anthropic, *Agent Skills*: https://code.claude.com/docs/en/skills
- Anthropic, *Custom Subagents*: https://code.claude.com/docs/en/sub-agents
- Anthropic, *Plugin Marketplaces*: https://code.claude.com/docs/en/plugin-marketplaces
- Anthropic, *Official Ralph Loop Plugin*: https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop
