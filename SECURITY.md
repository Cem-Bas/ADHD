# Security

## Reporting a vulnerability

Please do not open a public issue for security problems. Use the repository's private vulnerability reporting (GitHub → Security → Report a vulnerability) or contact the maintainer named in `.claude-plugin/plugin.json` through GitHub, with a description, reproduction steps, and the affected version. You will receive an acknowledgement within seven days.

## Threat model in one paragraph

The plugin treats prompts, transcripts, hook input, tool output, and its own stored state as untrusted data. All structured input is parsed with `JSON.parse`; user content is never evaluated and never placed in shell source (hooks use exec form). Session IDs must match a strict pattern and every data path is verified to stay inside the plugin data directory. State files are written atomically with mode 0600 where the platform supports it, and a per-session lock prevents concurrent writers. Diagnostics and output previews are clipped and pass through a secret redactor (tokens, API keys, private keys, bearer headers, password assignments). No data leaves the machine; the researcher and auditor subagents are ordinary Claude Code subagents in the user's own session.

## What the plugin cannot protect against

- A malicious or compromised model output that lies in a receipt: deterministic checks (artifacts exist, referenced commands succeeded, nonce and digest binding) reduce but do not eliminate this.
- The main agent recording the receipt itself: the receipt is bound to the task, contract version, request digest, and nonce, but nothing cryptographic proves that the `adhd:contract-auditor` subagent, rather than the main agent that sees the same nonce, ran `state.mjs audit-record`. The auditor's independence is a separate context with read-focused tools (Read, Grep, Glob) plus Bash for the single audit-record command; the deterministic checks are the part that cannot be talked around.
- Other plugins or hooks with access to the same data directory.
- Users who paste secrets into their prompts: the raw request is stored verbatim by design; use `/adhd:data delete-session` to remove it.

## Supported versions

Only the latest released version receives fixes.
