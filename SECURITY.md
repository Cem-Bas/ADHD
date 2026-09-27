# Security

## Reporting a vulnerability

Please do not open a public issue for security problems. Email the maintainer listed in `.claude-plugin/plugin.json` (or use the repository's private vulnerability reporting if enabled) with a description, reproduction steps, and the affected version. You will receive an acknowledgement within seven days.

## Threat model in one paragraph

The plugin treats prompts, transcripts, hook input, tool output, and its own stored state as untrusted data. All structured input is parsed with `JSON.parse`; user content is never evaluated and never placed in shell source (hooks use exec form). Session IDs must match a strict pattern and every data path is verified to stay inside the plugin data directory. State files are written atomically with mode 0600 where the platform supports it, and a per-session lock prevents concurrent writers. Diagnostics and output previews are clipped and pass through a secret redactor (tokens, API keys, private keys, bearer headers, password assignments). No data leaves the machine; the researcher and auditor subagents are ordinary Claude Code subagents in the user's own session.

## What the plugin cannot protect against

- A malicious or compromised model output that lies in a receipt: deterministic checks (artifacts exist, referenced commands succeeded, nonce and digest binding) reduce but do not eliminate this.
- Other plugins or hooks with access to the same data directory.
- Users who paste secrets into their prompts: the raw request is stored verbatim by design; use `/adhd:data delete-session` to remove it.

## Supported versions

Only the latest released version receives fixes.
