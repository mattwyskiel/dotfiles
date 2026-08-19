#!/usr/bin/env bash

set -euo pipefail

DOTFILES_DIR="${DOTFILES_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export PATH="$HOME/.local/bin:$PATH"

sudo apt-get update
sudo apt-get install -y \
    build-essential \
    ca-certificates \
    curl \
    git \
    gzip \
    stow \
    tar \
    tmux \
    unzip \
    xz-utils \
    zsh

if ! command -v oh-my-posh >/dev/null 2>&1; then
    curl -fsSL https://ohmyposh.dev/install.sh | bash -s
fi

zsh_path="$(command -v zsh)"
if [ "${SHELL:-}" != "$zsh_path" ]; then
    chsh -s "$zsh_path"
    echo "The default shell will change to Zsh after the next login."
fi

stow --restow --dir="$DOTFILES_DIR/zsh" --target="$HOME" ubuntu
