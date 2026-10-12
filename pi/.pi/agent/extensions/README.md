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

## Native model selection

Model-only presets use Pi's native `enabledModels` setting in `../settings.json` rather than an extension or `presets.json` file.

- `Ctrl+P` / `Ctrl+Shift+P` cycle through the configured shortlist, with `high` thinking selected by each model's `:high` suffix.
- `/scoped-models` manages the shortlist.
- `/model` starts with the shortlist; press `Tab` to switch to all models from configured providers. Selecting a model outside the shortlist does not add it unless it is saved as the default.
- `pi --model provider/model:high` selects a model at startup.

## Codex usage extension

`codex-usage.ts` displays the remaining OpenAI Codex subscription windows in Pi's footer. It refreshes when a session starts, after each completed agent run, and on demand:

```text
/codex-usage
```

The command also shows reset times and any additional model-specific limits reported by OpenAI. It reuses Pi's `openai-codex` OAuth login; it does not read or store credentials itself.

## Git worktree extension

`git-worktree.ts` provides:

- `/wt [--base <ref>] [--no-prompt] [--no-pr] [task]` (alias: `/worktree`) to create a task branch and worktree.
- `/wtdone` (alias: `/worktree-done`) shows one cleanup menu: remove the worktree and keep its branch, delete both, or cancel. The menu includes the path and safety warnings; selecting an action confirms it. `--keep-branch` or `--delete-branch` replaces the menu with one confirmation. Dirty worktrees require `--force`, and the main repository cannot be removed. Deleting an unmerged branch warns about lost commits without forcing worktree removal.
- Conversation-aware task inference. `/wt` can omit `task` when the preceding conversation establishes it. Herdr launches fork persisted sessions so the full context is retained; manual launches include the preceding conversation in their one-shot kickoff prompt.
- GitHub issue links in the explicit or inferred task are fetched **before** naming and kickoff generation. The issue title, description, state, labels, and comments are passed to naming and preserved in the worktree handoff, including forked Herdr sessions. Local fallback names use the fetched title rather than the URL. Repeated links are fetched once; `--no-prompt` still fetches for naming. Fetch failures stop creation instead of proceeding with missing issue context.
- A generated kebab-case `pi/...` branch and matching Human Title for the worktree's Pi session and, when available, its Herdr workspace.
- A default kickoff instruction to commit and push completed changes, open a pull request, watch it for review comments, and address actionable feedback.
- `--no-pr` to omit the pull-request and review-watching instruction while retaining the rest of the kickoff prompt.
- `--no-prompt` to keep the naming/layout behavior while opening Pi idle (no kickoff prompt, including no pull-request instruction). Useful when you only want a named worktree and will drive Pi yourself.
- Inside Herdr, native `herdr worktree create` integration so the checkout opens as a workspace grouped with its parent repository. The workspace keeps the fixed layout: equal-width left/right columns, `nvim .` above a fresh terminal in a 70/30 left-column split, and Pi in the right column.
- `/wtdone` removes Herdr-managed checkouts through `herdr worktree remove`, closing the associated workspace while preserving the existing branch-deletion choices.
- Outside Herdr, the same branch/worktree creation without trying to spawn a multiplexer. The extension stores a one-shot handoff in the worktree's private Git metadata; the next `pi` started anywhere in that worktree restores its name/metadata and submits the kickoff prompt automatically.

Examples:

```text
/wt fix auth cookie refresh
/wt https://github.com/owner/repo/issues/123
/wt --no-pr fix https://github.com/owner/repo/issues/123 (keep the public API unchanged)
/wt --no-pr investigate flaky tests
/wt --base main --no-prompt explore package upgrades
/wt --no-prompt
```

### Dependencies

- Git with worktree support
- Pi
- GitHub CLI (`gh`) installed and authenticated with access to any linked issues
- Optional: [Herdr](https://herdr.dev) 0.8.2 or newer and Neovim (`nvim`) for grouped automatic workspace spawning

The task-name generation uses the active Pi model when credentials are available and falls back to deterministic local naming otherwise.

Run the worktree regression tests (Node.js 24+):

```bash
node --test pi/.pi/agent/extensions/tests/git-worktree.test.mjs
```
