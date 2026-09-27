---
name: contract
description: Show the original request verbatim, every later user turn in order, the mode, and the current Task Lock for the active ADHD task. The user invokes it as /adhd:contract.
disable-model-invocation: true
---

# Task contract

The ADHD hook injected the canonical request ledger for this session. Show the user:

1. The original request, verbatim, in a fenced block.
2. Each later user turn, verbatim, numbered in order with its timestamp; mark a turn that corrected an earlier instruction with `Changed: <previous requirement> -> <corrected requirement>`.
3. The mode (Standard or Hyperfocus), the contract version, and the repair count.
4. The current TASK LOCK block, restated from the ledger (Goal, Deliverable, Must include, Constraints, Mode, Done when).

Do not start new work in this turn. If the hook reported no active task, say so in one line.
