---
name: hyperfocus
description: Deep-research mode for the active or supplied request. Decomposes the question, runs parallel source researchers, keeps a claim-to-source ledger, and blocks completion until the support rules or explicit gaps are met. The user invokes it as /adhd:hyperfocus [request].
argument-hint: "[request]"
disable-model-invocation: true
---

# Hyperfocus mode

The ADHD hook has already switched this task to Hyperfocus (or recorded that the next request will use it) and injected the task contract, the exact `state.mjs evidence-add` command, and the auditor invocation for this session. Use those exact commands; never construct paths yourself.

Request: $ARGUMENTS

## Workflow

1. **Decompose.** Write the research questions (Q1, Q2, ...). For each, note whether its answer is current or historical, whether credible sources are likely to disagree, how consequential it is, and whether the obvious evidence is weak.
2. **Assign.** When at least two questions are independent and parallel work saves time, dispatch up to four `adhd:source-researcher` subagents at once with the Agent tool (`subagent_type: "adhd:source-researcher"`), one bounded question each. Give each researcher its question id (the claimId prefix), today's date, and any constraints from the contract. Otherwise research sequentially yourself under the same rules.
3. **Corroborate.** For every core claim that is disputed or unstable, obtain two independent evidence chains (separate authoring institutions or independently collected evidence; republished or citing sources count as one chain). When the second chain cannot be found after a targeted search, set `confidence` to `low` and add an `unresolved` entry naming the missing evidence and its effect on the conclusion.
4. **Verify.** For core, disputed, or unstable claims, run `adhd:evidence-verifier` on the claim texts and sources — without the conclusion — and downgrade or drop anything it marks `no` or unreachable.
5. **Record.** Send every claim and source to the ledger with the injected `evidence-add` command (JSON on stdin). It returns `adequate` and `gaps`; keep recording until `adequate` is true or every remaining gap is represented under `unresolved`.
6. **Coverage pass.** Before synthesis, re-read the research questions and confirm each has recorded claims; list any question that ends without evidence under `unresolved`.
7. **Synthesize** with these sections in this order: Sourced facts (each with source and date), Reasonable inferences (labelled), Recommendations, Unresolved questions (missing evidence and its effect), Sources (url, publisher, date, chain id, confidence).
8. **Finish** by running the contract auditor exactly as the injected protocol says. The Stop hook checks the ledger and blocks when a core claim is unsupported and not listed under unresolved.

## Rules

- A high source count alone never satisfies Hyperfocus; independence does.
- Report the active researcher count and repair count when asked for status; never invent cost estimates.
- Standard-mode rules still apply: separate sourced fact, inference, and recommendation; disclose material uncertainty.
