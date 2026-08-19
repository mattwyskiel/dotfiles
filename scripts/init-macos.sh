#!/usr/bin/env bash

set -euo pipefail

DOTFILES_DIR="${DOTFILES_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew not found. Installing..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    if [ -x /opt/homebrew/bin/brew ]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [ -x /usr/local/bin/brew ]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi
fi

for formula in stow tmux oh-my-posh; do
    command -v "$formula" >/dev/null 2>&1 || brew install "$formula"
done

[ -d /Applications/Ghostty.app ] || brew install --cask ghostty
[ -f "$HOME/Library/Fonts/HackNerdFont-Regular.ttf" ] || brew install --cask font-hack-nerd-font

stow --restow --dir="$DOTFILES_DIR" --target="$HOME" ghostty
stow --restow --dir="$DOTFILES_DIR/zsh" --target="$HOME" macos
