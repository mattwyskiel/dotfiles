# Pi Extensions

Personal [Pi](https://pi.dev) extensions managed by this dotfiles repository.

## Tech stack

- TypeScript extensions loaded directly by Pi
- Pi extension and model APIs (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`)
- Local CLI integrations where noted by each extension

## Setup

The repository's `pi` Stow package links `.pi/agent/extensions` into the home directory. Run the root setup script, or stow only this package:

```bash
stow pi
```

Reload a running Pi session after editing an extension:

```text
/reload
```

## Codex usage extension

`codex-usage.ts` displays the remaining OpenAI Codex subscription windows in Pi's footer. It refreshes when a session starts, after each completed agent run, and on demand:

```text
/codex-usage
```

The command also shows reset times and any additional model-specific limits reported by OpenAI. It reuses Pi's `openai-codex` OAuth login; it does not read or store credentials itself.

## Git worktree extension

`git-worktree.ts` provides:

- `/wt [--base <ref>] [--no-prompt] [task]` (alias: `/worktree`) to create a task branch and worktree.
- `/wtdone` (alias: `/worktree-done`) to safely remove a task worktree.
- Conversation-aware task inference. `/wt` can omit `task` when the preceding conversation establishes it; persisted sessions are forked into the worktree session so the full context is retained.
- A generated kebab-case `pi/...` branch and matching Human Title for the cmux workspace and Pi session.
- `--no-prompt` to keep that naming/layout behavior while launching Pi idle (no kickoff prompt). Useful when you only want a named worktree workspace and will drive Pi yourself.
- A fixed cmux layout: equal-width left/right columns, `nvim .` above a fresh terminal in a 70/30 left-column split, and Pi in the right column.

Examples:

```text
/wt fix auth cookie refresh
/wt --base main --no-prompt explore package upgrades
/wt --no-prompt
```

### Dependencies

- Git with worktree support
- [cmux](https://cmux.com) with `new-workspace --layout` support
- Pi
- Neovim (`nvim`)

The task-name generation uses the active Pi model when credentials are available and falls back to deterministic local naming otherwise.
