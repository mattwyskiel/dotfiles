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

## Provider usage package

[`@narumitw/pi-usage`](https://www.npmjs.com/package/@narumitw/pi-usage) replaces the custom Codex usage extension. It is configured in `../settings.json`. Install it with:

```bash
pi install npm:@narumitw/pi-usage
```

Run `/usage` to check provider usage, limits, reset times, and API balances. The package shows usage for the selected provider in Pi's footer and refreshes every five minutes. Codex usage uses Pi's existing OAuth login.

Codex Fast mode is off by default. Enabling it with `/fast` uses more plan allowance.

## Subagent extension

`subagent.ts` adds a `subagent` tool. The tool runs one task in a child `pi --mode json` process and returns only the child's final message. The child's tool calls and file reads do not go into the parent context.

The main agent does most work itself. The tool description limits subagents to tasks where a separate context helps:

- Noisy exploration, where only a short summary matters.
- Independent investigations in parallel.
- A fresh-eyes review or a second opinion, optionally from another model. A review uses a fresh subagent that gets the requirements and the diff, not the author's reasoning.

Subagents are read-only. Calls to `edit` and `write` fail in a child, also from codemode scripts. The tools stay declared so that the prompt cache still applies. The task message tells the child not to change files with `bash`, but the extension cannot enforce this. Do file changes in the main session, or start a separate task with `/wt`.

Parameters:

- `task`: the instruction. For a fresh subagent, write a self-contained brief.
- `model`: optional `provider/id`, with an optional `:thinking` suffix. The default is the parent's model and thinking level.
- `fork: true`: the child starts from the parent conversation at the current point. Use it for side investigations that need that conversation, not for reviews.
- `resume`: the session path from an earlier result. The child continues with its own context.
- `tools`, `cwd`: fresh subagents only.

The model can make several `subagent` calls in one turn to run them in parallel (at most 4 at a time). Codemode scripts can call `tools.subagent()`, which resolves to `{ output, session, model }` with the full output.

### Token use

- The parent sees at most 12 KB of the final message and the child session path. If the message is longer, the full text goes to a temporary file and the result gives its path.
- A child keeps the parent's system prompt and tools. The subagent rules go in the task message. The child session also uses the parent's session ID, because OpenAI Codex routes its prompt cache by session ID. Thus the first request of a fresh or forked child reads the parent's prompt from the cache. In tests with `gpt-6-luna`, a fresh child sent about 200 uncached input tokens instead of about 7,500.
- These settings prevent cache reuse: a `model` that is not the parent's model, and a `tools` allowlist.
- The tool declaration is about 400 tokens. It lists the models from `enabledModels`.

### Limits

- Subagents cannot start subagents. The tool stays declared in children so that the child's tool list agrees with the parent's, but calls fail. Set `PI_SUBAGENT_MAX_DEPTH` to allow more levels.
- `fork` needs a saved parent session. It is not available with `--no-session`.
- Child sessions are in `<parent session>/subagents/`, so `pi -c` does not open them. Without a parent session file, they are in the system temporary directory.
- Children load the same extensions and MCP servers as the parent. The child environment does not include `PI_WORKTREE_CONFIG`, so a child cannot delete the parent's worktree launch configuration.

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
