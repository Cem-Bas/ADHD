---
name: status
description: Show the ADHD task state — Done / Now / Next / Blocked, coverage of contract items, mode, and repair count. The user invokes it as /adhd:status.
disable-model-invocation: true
---

# Task status

The ADHD hook injected the machine state for this session (phase, mode, contract version, repairs, audit receipt, active researchers). Render, in this order and nothing else:

```text
Done: <objectively completed items, or "nothing yet">
Now: <the single current action>
Next: <the next concrete action>
Blocked: <the exact blocker and what resolves it, or "nothing">
Coverage: <passed>/<total> contract items (from the audit receipt; "not audited yet" when none)
Mode: Standard | Hyperfocus
Repairs: <completed>/<maximum> · Active researchers: <n>
```

Use your own knowledge of the work for Done, Now, Next, and Blocked, and the injected state for everything else. Never invent percentages or time estimates. Do not start new work in this turn. If the hook reported no active task, say so in one line.
