#!/usr/bin/env bash

set -euo pipefail

DOTFILES_DIR="${DOTFILES_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export PATH="$HOME/.local/bin:$PATH"

stow --restow --dir="$DOTFILES_DIR" --target="$HOME" --adopt tmux nvim git agents pi mise herdr

# CLAUDE.md is itself an absolute symlink, which GNU Stow intentionally rejects.
mkdir -p "$HOME/.claude"
if [ ! -e "$HOME/.claude/CLAUDE.md" ] && [ ! -L "$HOME/.claude/CLAUDE.md" ]; then
    ln -s "$DOTFILES_DIR/claude/.claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
fi

# Codex and Grok Build read global instructions from their own directories.
# Replace a missing or empty file with a link to the shared AGENTS.md.
for target in "$HOME/.codex/AGENTS.md" "$HOME/.grok/AGENTS.md"; do
    mkdir -p "$(dirname "$target")"
    if [ ! -L "$target" ] && [ ! -s "$target" ]; then
        ln -sf "$HOME/.agents/AGENTS.md" "$target"
    fi
done

# Restore exactly the plugin versions recorded in lazy-lock.json.
(
    cd "$DOTFILES_DIR"
    mise exec -- nvim --headless "+Lazy! restore" "+qa"
)
