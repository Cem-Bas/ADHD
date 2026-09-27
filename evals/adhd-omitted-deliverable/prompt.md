---
name: adhd-omitted-deliverable
description: Tests whether the plugin catches an omitted deliverable before Claude claims the task is done.
tags: [task-lock, omission]
runs: 5
max_turns: 40
timeout_seconds: 600
allowed_tools: ["Write", "Edit", "Bash(node *)"]
---

Create notes/a.md containing the single word alpha and notes/b.md containing the single word beta.
