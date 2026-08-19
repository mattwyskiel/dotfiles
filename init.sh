#!/usr/bin/env bash

set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DOTFILES_DIR

chmod +x "$DOTFILES_DIR"/scripts/*.sh

if [ "$(uname)" = "Darwin" ]; then
    echo "Detected macOS..."
    "$DOTFILES_DIR/scripts/init-macos.sh"
elif grep -qi microsoft /proc/version 2>/dev/null; then
    echo "Detected WSL..."
    "$DOTFILES_DIR/scripts/init-ubuntu.sh"
elif [ -f /etc/os-release ] && grep -qi ubuntu /etc/os-release; then
    echo "Detected Ubuntu..."
    "$DOTFILES_DIR/scripts/init-ubuntu.sh"
else
    echo "Unsupported operating system." >&2
    exit 1
fi

"$DOTFILES_DIR/scripts/install-dev-tools.sh"
"$DOTFILES_DIR/scripts/link-dotfiles.sh"

echo "Dotfiles setup complete. Start a new shell to activate the environment."
