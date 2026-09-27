---
name: data
description: Inspect, export, or explicitly delete the data the ADHD plugin stores (preferences, session task records, diagnostics, exports). Project-wide and all-data deletion show the exact targets and require an exact confirmation phrase. The user invokes it as /adhd:data show|export|delete-session|delete-project|delete-all.
argument-hint: "show | export | delete-session | delete-project | delete-all"
disable-model-invocation: true
allowed-tools: Bash(node *scripts/state.mjs data *)
---

# Plugin data

The ADHD hook injected the exact `state.mjs data` commands for this machine. Use them verbatim.

Action: $ARGUMENTS

- `show`: run the `data show` command and summarise the data directory, preference files, each session record (session, task, phase, mode, updated, expires, bytes), diagnostics, exports, total bytes, and the retention rules.
- `export`: run the `data export` command and report the written file path.
- `delete-session`: run the `data delete-session` command for this session and list the deleted files.
- `delete-project`: run `data delete-project` without `--confirm`. Show the user the exact targets and the required phrase. Wait. Only when the user types that exact phrase in their next message, run the command again with `--confirm "<phrase>"` and list what was deleted.
- `delete-all`: run `data delete-all` without `--confirm`. Show the targets and the required phrase `delete all adhd data`. Wait. Only when the user types that exact phrase, run the command again with `--confirm "delete all adhd data"` and list what was deleted.

Never pass `--confirm` on your own initiative, never treat "yes" or "go ahead" as the phrase, and never delete anything the user did not name. Cancelling a task never deletes data; only these commands and retention cleanup do.
