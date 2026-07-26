# Directory-Scoped AGENTS.md for Pi

A global Pi extension that applies nested `AGENTS.md` files as directory-scoped project instructions. Pi natively loads instruction files only from the current working directory and its ancestors; this extension adds on-demand loading for instruction files below the session root.

## Behavior

Given this repository:

```text
repo/
├── AGENTS.md
└── packages/
    ├── AGENTS.md
    └── web/
        ├── AGENTS.md
        └── src/app.ts
```

When Pi starts in `repo/`:

1. Pi's native loader includes `repo/AGENTS.md`.
2. The first built-in path operation under `packages/` is paused before filesystem access and loads `packages/AGENTS.md` into model context.
3. The TUI shows a compact informational notification naming the loaded file instead of rendering its full contents as an error.
4. The first operation under `packages/web/` similarly loads `packages/web/AGENTS.md`.
5. The model retries the paused operation after seeing the instructions.
6. Nested instructions remain active for later turns, but their explicit scope prevents them from applying to unrelated directories.

Pi represents every blocked tool call as an error internally, so the paused tool row still has a short one-line retry marker. The complete instruction payload is delivered as a hidden custom message; it is not shown in the transcript or duplicated in the error-styled row.

Applicable files are ordered from the broadest scope to the most specific scope. More deeply nested instructions are considered more specific when scoped instructions conflict.

The extension recognizes the same per-directory filename precedence as Pi:

1. `AGENTS.md`
2. `AGENTS.MD`
3. `CLAUDE.md`
4. `CLAUDE.MD`

Only the first readable matching file in each directory is used.

## Supported tools

The automatic gate covers Pi's built-in path-oriented tools:

- `read` (except `SKILL.md` files)
- `edit`
- `write`
- `ls`
- `find`
- `grep`

Reading a `SKILL.md` file never activates directory-scoped project instructions. Skills use Pi's separate, explicit skill-loading workflow; editing or writing a `SKILL.md` remains gated like any other file.

The extension cannot reliably infer every filesystem path embedded in arbitrary `bash` commands or custom tool inputs. Before using those tools on a nested path, first access that path with a supported built-in tool so its scoped instructions are activated.

Search tools are scoped to their starting path. A repository-root search may discover files below a deeper instruction scope; a subsequent `read`, `edit`, or `write` of those files activates that deeper scope.

## Setup

This extension is installed globally at:

```text
~/.pi/agent/extensions/directory-scoped-agents/index.ts
```

Pi auto-discovers it for all projects. Run `/reload` in an existing session or restart Pi after changing the extension.

Use the diagnostic command to list nested instruction files for a path:

```text
/scoped-agents packages/web/src/app.ts
```

## Tech stack

- TypeScript loaded directly by Pi through jiti
- Node.js filesystem, path, and crypto APIs
- Pi extension lifecycle hooks (`before_agent_start`, `tool_call`, and `turn_end`)
- Pi custom messages and informational UI notifications
- Bun's built-in test runner for unit tests

## Dependencies

Runtime dependencies are provided by Pi and Node.js:

- `@earendil-works/pi-coding-agent`
- Node.js built-ins

No separate package installation is required.

## Development

Run unit tests from `~/.pi`:

```bash
bun test ./agent/extensions/directory-scoped-agents/scoping.test.ts
```

Smoke-test extension loading without starting a model request:

```bash
PI_OFFLINE=1 pi --no-extensions \
  -e ./agent/extensions/directory-scoped-agents/index.ts \
  --list-models
```

## Security

Like Pi's native context files, nested instruction files are prompt input and may contain malicious or misleading instructions. The extension loads them regardless of project trust. Do not use this as a sandbox or as a security boundary for untrusted repositories.
