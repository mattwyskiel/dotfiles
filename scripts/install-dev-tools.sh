#!/usr/bin/env bash

set -euo pipefail

DOTFILES_DIR="${DOTFILES_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export PATH="$HOME/.local/bin:$PATH"

if ! command -v mise >/dev/null 2>&1; then
    echo "mise not found. Installing..."
    curl -fsSL https://mise.run | sh
fi

mkdir -p "$HOME/.config"
stow --restow --dir="$DOTFILES_DIR" --target="$HOME" mise

(
    cd "$DOTFILES_DIR"
    mise install
    mise exec -- nvim --version | head -n 1
)
