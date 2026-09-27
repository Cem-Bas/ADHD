# Contributing

Thank you for helping keep ADHD small, honest, and fast.

## Ground rules

- Runtime code stays dependency-free ESM JavaScript using only the Node standard library, and must run on Node 20.11+.
- Hooks stay in exec form (`command: "node"` plus `args`); never put prompt text or paths into a shell string.
- Durable data lives only in the plugin data directory; the plugin never writes to its own source tree at runtime.
- Every fault path must end as a visible `DEGRADED_STOP` or `CANCELLED`, never as an unqualified completion. The Stop hook must never issue more than seven consecutive blocks.
- Before producing a new build or release, increment the version in `package.json`, `.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json` together.

## Workflow

1. Fork and branch from `main`.
2. Write the failing test first (`tests/unit/` for modules, `tests/integration/` for hook scripts spawned as real processes), then the change.
3. Run `npm test`, `npm run bench`, and `claude plugin validate . --strict`.
4. Update `README.md` or `docs/architecture.md` when behaviour, stored data, or commands change.
5. Open a pull request that says what changed, why, and how you tested it on your platform. CI runs the suite on macOS, Ubuntu, and Windows with Node 20 and 22.

## Design references

- `docs/superpowers/specs/2026-09-27-adhd-claude-code-plugin-design.md` — the specification.
- `docs/architecture.md` — the implemented architecture and every deliberate deviation from the specification.
