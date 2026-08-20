#!/usr/bin/env bash

set -euo pipefail

DOTFILES_DIR="${DOTFILES_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export PATH="$HOME/.local/bin:$PATH"

stow --restow --dir="$DOTFILES_DIR" --target="$HOME" --adopt tmux nvim git agents pi mise

# CLAUDE.md is itself an absolute symlink, which GNU Stow intentionally rejects.
mkdir -p "$HOME/.claude"
if [ ! -e "$HOME/.claude/CLAUDE.md" ] && [ ! -L "$HOME/.claude/CLAUDE.md" ]; then
    ln -s "$DOTFILES_DIR/claude/.claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
fi

# Restore exactly the plugin versions recorded in lazy-lock.json.
(
    cd "$DOTFILES_DIR"
    mise exec -- nvim --headless "+Lazy! restore" "+qa"
)
