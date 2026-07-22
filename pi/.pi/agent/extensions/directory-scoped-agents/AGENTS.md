# Development guidelines

- Keep filesystem discovery in `scoping.ts` so it remains independently testable.
- Match Pi's native context filename precedence: `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, then `CLAUDE.MD`.
- Do not recursively preload instruction contents; preserve on-demand loading as paths are accessed.
- The session root and its ancestors belong to Pi's native context loader and must not be duplicated.
- Preserve the parallel-tool preflight guarantee: pending instructions become active only after `turn_end`, so sibling tool calls made without seeing new instructions are also paused.
- Reading `SKILL.md` must bypass scoped-instruction activation; editing or writing one remains gated.
- Clearly document that arbitrary Bash commands and custom tools cannot be scoped reliably.
- Run `bun test agent/extensions/directory-scoped-agents/scoping.test.ts` after changes.
