---
name: prefs
description: Inspect, set, unset, or reset ADHD preferences (output detail, chunk size, progress cadence, research depth, source strictness, Task Lock detail, repair cycles, retention) globally or as project overrides. The user invokes it as /adhd:prefs [show | set <key> <value> | unset <key> | reset] [--project].
argument-hint: "[show | set <key> <value> | unset <key> | reset] [--project]"
disable-model-invocation: true
allowed-tools: Bash(node *scripts/state.mjs prefs *)
---

# Preferences

The ADHD hook injected the effective preferences, their sources, the editable keys with their allowed values, and the exact `state.mjs prefs` commands for this machine. Use those commands verbatim; they carry the correct `--data` and `--cwd` arguments.

Arguments: $ARGUMENTS

1. `show` (or no arguments): run the `prefs show` command and present a table with the columns key, effective value, source (default, global, or project).
2. `set <key> <value>`: run `prefs set --key <key> --value <value>`, adding `--scope project` when the arguments include `--project`. The command validates the value; when it returns an error, show the allowed values and do not retry with a different value.
3. `unset <key>`: run `prefs unset --key <key>` with `--scope project` when `--project` is present, otherwise `--scope global`.
4. `reset`: run `prefs reset --scope all` (or `--scope project` / `--scope global` when the arguments say so) and confirm in one line what was reset.

After any change, show the updated table. There are no hidden preferences: the table is everything the plugin stores.
