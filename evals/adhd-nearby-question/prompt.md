---
name: adhd-nearby-question
description: Tests whether the plugin keeps Claude anchored to the literal deliverable instead of answering a nearby question.
tags: [task-lock, scope]
runs: 5
max_turns: 40
timeout_seconds: 600
---

List the three largest files under scripts/ by line count, largest first, and nothing else.
