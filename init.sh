#!/usr/bin/env bash

chmod +x ~/dotfiles/scripts/*.sh

if [ "$(uname)" = "Darwin" ]; then
    echo "Detected macOS..."
    $HOME/dotfiles/scripts/init-macos.sh
elif grep -qi microsoft /proc/version 2>/dev/null; then
    echo "Detected WSL...using ubuntu init script"
    $HOME/dotfiles/scripts/init-ubuntu.sh
elif [ -f /etc/os-release ] && grep -qi ubuntu /etc/os-release; then
    echo "Detected Ubuntu..."
    $HOME/dotfiles/scripts/init-ubuntu.sh
else
    echo "Other/Unknown"
fi
