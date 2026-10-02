# Visual Check ("visualize") — Design

Date: 2026-10-02 · Target version: 0.1.3 · Status: approved in conversation, awaiting written-spec review

## Purpose

When Claude builds or changes a web UI, a task must not be marked COMPLETE on code alone. Claude decides whether a visual check is needed; when it is, Claude writes and runs a Playwright script that exercises the UI and saves screenshots, and the independent contract auditor looks at those screenshots before the task can pass.

Success: a UI task ends with screenshot evidence that the page renders and does what was asked, graded by the auditor, and the Stop hook cannot be talked past a missing, failed, or stale check.

## Decisions (from the user)

| Question | Decision |
|---|---|
| Who judges the UI | Script assertions **and** the auditor, which opens the screenshots and grades them against the request |
| Check cannot run | Mark the UI item BLOCKED with the exact reason and pause for the user; never install anything automatically |
| Reaching the app | Reuse a running dev server (never kill or restart it); if none runs, start one in the background and leave it running; static `.html` via `file://` |
| Approach | Claude writes a per-task Playwright script and runs it with the project's Playwright (approach A) |
| Who decides "needed" | Claude, recorded with a reason; a deterministic safety net blocks if UI files changed and no decision exists |
| Off switch | Preference `visualCheck`: `auto` (default) or `off` |

## 1. Decision and recorded data

**Decision rule (protocol text).** Before finishing, Claude asks: did this task create or change something a person sees or operates in a browser (pages, components, styles, templates, a route's UI)? Backend-only code, tests, docs, CLI, and config with no visible effect do not need a check.

Claude records the decision:

```
state.mjs visual-decide --data <data> --session <id> <<< {"needed": true, "reason": "added the signup form at /signup"}
```

`reason` is required, 1–300 characters. A later decision replaces the earlier one (amendments may change UI scope).

**UI-file detection.** `scripts/common/visual.mjs` exports `isUiPath(path)`, true for extensions `.html .htm .css .scss .sass .less .jsx .tsx .vue .svelte .astro` and for `.js`/`.ts` files under a path segment named `components`, `pages`, `app`, `views`, `layouts`, or `routes`. Excluded: paths under `node_modules`, `dist`, `build`, `.next`, `coverage`, and test files (`*.test.*`, `*.spec.*`, `__tests__`).

Because `evidence.toolEvents` is capped and drops old entries, UI edits are tracked in their own field at capture time rather than by scanning tool events.

**Schema.** `emptyEvidence()` gains:

```js
visual: {
  decision: null,            // { needed: boolean, reason: string, at: iso } | null
  uiTouched: [],             // [{ path, toolUseId, at }] — successful Edit/Write/MultiEdit/NotebookEdit on a UI path; deduplicated by path keeping the latest; capped at 200
  checks: [],                // [{ toolUseId, url, screenshots: [path], ok: boolean, at }] ; capped at 50
}
```

Schema validation covers every field; `SCHEMA_VERSION` is bumped with a migration that adds an empty `visual` block to existing records.

The `visual` block is included in `computeEvidenceDigest` so a new decision or check makes an existing receipt stale.

## 2. Running the check

**Location.** Scripts and screenshots live in the plugin data directory: `<data>/visual/<sessionId>/<taskId>/`. Nothing is written to the user's repository. `state.mjs visual-dir` prints this directory (creating it) so the protocol never hard-codes it. Retention removes a session's visual directory together with its session record.

**Playwright.** The script resolves Playwright from the project with `createRequire(path.join(projectDir, 'package.json'))`, trying `playwright` then `@playwright/test`. If neither resolves it prints `PLAYWRIGHT_MISSING: install with npm i -D playwright && npx playwright install chromium` and exits 3. A browser launch failure prints `BROWSER_LAUNCH_FAILED: <message>` and exits 4. Unreachable URL: `APP_UNREACHABLE: <url>` and exit 5. These map to the BLOCKED path (section 3).

**Reaching the app.** Reuse a running dev server; never kill or restart one. If none runs, start the project's dev script in the background and leave it running. Static HTML opens via `file://`.

**Script requirements (protocol text).** Each script must:
1. Visit every page or state the task changed.
2. Perform the user actions the request names and assert their visible outcome.
3. Fail on any uncaught page error or `console.error`.
4. Save a screenshot at 1280×800 and at 390×844 for each page or state, into the visual directory.
5. Exit 0 only when every assertion passed.

**Recording.**

```
state.mjs visual-record --data <data> --session <id> <<< {"toolUseId": "<Bash tool use id>", "url": "http://localhost:5173/signup", "screenshots": ["<abs path>", ...]}
```

`visual-record` rejects the entry when: `toolUseId` matches no recorded command; any screenshot path does not exist or is not a `.png`/`.jpg`; `screenshots` is empty or longer than 40. The stored `ok` is copied from the recorded command's `ok`, never taken from input.

## 3. Completion gate and auditor

**Stop-hook gaps** (added to `evaluateStop`, only when `visualCheck` is `auto`):

| Code | Condition |
|---|---|
| `VISUAL_UNDECIDED` | `uiTouched` is non-empty and `decision` is null |
| `VISUAL_MISSING` | `decision.needed` and no check with `ok: true` |
| `VISUAL_STALE` | `decision.needed` and the latest `uiTouched` entry is newer than the latest passing check |
| `VISUAL_SCREENSHOT_MISSING` | a screenshot of the latest passing check no longer exists |

Each gap produces a normal repair cycle with a targeted instruction (for example "re-run the visual check: src/Signup.tsx changed after the last passing run").

**Cannot run.** When the script exits 3, 4, or 5, Claude reports the exact reason and fix, the auditor marks the UI item BLOCKED, and the existing all-BLOCKED pause applies. The task is never marked COMPLETE without a passing check.

**Auditor step** (added to `agents/contract-auditor.md` and the auditor invocation text). When `visual.decision.needed` is true:
1. Read every screenshot of the latest passing check (the Read tool displays images).
2. Grade them against the request: requested elements present, nothing visibly broken (overlap, clipped text, blank page), phone layout usable.
3. Add requirement item "UI verified visually": PASS, or PARTIAL with a concrete gap.

When `decision.needed` is false but `uiTouched` is non-empty, the auditor judges the recorded reason and marks a weak reason PARTIAL.

**Completion line.** With a passing visual check, the COMPLETE system message appends `· UI verified (<n> screenshots)`.

## 4. Preference, tests, docs, release

**Preference.** `visualCheck`: enum `auto` | `off`, default `auto`, description "Whether Claude decides and runs visual UI checks". `off` disables the protocol text and all four gaps.

**Tests (written first).**
- Unit: `isUiPath` cases; `visual-decide` and `visual-record` validation (unknown command id, missing screenshot, `ok` copied from the command); schema migration; each of the four gaps; `visualCheck=off` disables gaps; digest changes on new decision/check.
- Integration: stop-check scenarios — UI edit without decision blocks; needed + passing check completes with the UI line; edit after check is stale; script exit 3 leading to an all-BLOCKED pause.
- No real browser in tests; screenshots are fixture files.
- Bench: hooks remain within existing targets.
- Eval: `evals/adhd-visual-check/` — a small UI task that must end with a passing check and screenshots.

**Docs.** README: "Visual check" section, preference row, Stop-hook table row, limitation notes (Chromium only, needs project Playwright). Auditor agent file and protocol text.

**Release.** Version 0.1.3 in `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`. Developed on `feat/visual-check`, merged to `main` when tests and validation pass.

## Out of scope

Pixel-diff regression against earlier runs; a `/adhd:visualize` command; browsers other than Chromium; installing Playwright automatically.

## Known interaction

Recorded command `exitStatus` is currently `null` (observed 2026-10-02); `ok` is populated and is what `visual-record` and the gaps use. Fixing `exitStatus` capture is a separate task.

## Implementation refinements (2026-10-02, from code inspection)

- **Pass/fail source.** Claude Code's Bash results carry no exit code, so a recorded command's `ok` is not a reliable pass signal. The script writes `<check dir>/result.json` as `{"passed": bool, "url": string, "screenshots": [abs paths], "failures": [string]}`; a blocked run writes `{"passed": false, "blocked": "PLAYWRIGHT_MISSING: …" | "BROWSER_LAUNCH_FAILED: …" | "APP_UNREACHABLE: …"}`. A check is ok only when `result.passed === true` and the command is recorded ok.
- **Finding the run.** Claude cannot see tool-use ids, so `visual-record` takes `{"resultFile": "<path>"}` and links the latest recorded Bash command whose text contains `<check dir>/check.mjs`. The script must be saved as `check.mjs` in the check directory and run with `node "<check dir>/check.mjs"`.
- **Blocked gap.** A latest check with `blocked` set yields `VISUAL_BLOCKED`, which pauses the task like `ITEM_BLOCKED`.
- **Browser fallback (user decision 2026-10-02).** When the project has no Playwright but Claude Code's own browser tools are available (Claude in Chrome, Playwright MCP), Claude drives the browser itself, saves the PNG screenshots into the check directory, and writes `result.json` with `"method": "browser"`. Such a check needs no script run (`toolUseId: null`); its pass/fail is the worker's own statement, so the auditor's screenshot review is the deciding evidence. The task pauses only when neither the script nor the browser tools can run.
- **Recorded answers (loop-bug fix).** A reply written just before a tool call can be stored in the transcript only as a short summary, so the auditor missed answers that were given. Claude records each complete answer with `state.mjs answer-record` (`{"answer": "<text>"}`), stored in `evidence.answers` (20 entries, 20 000 characters each), and the auditor reads it before the transcript. The protocol also tells Claude to put content the user must read or approve in the final message of the turn or in question option previews.
