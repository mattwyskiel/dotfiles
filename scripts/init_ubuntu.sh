#!/usr/bin/env bash

# This script is meant set up a fresh computer.
# Goal is for this to work on macOS, Linux, and WSL.

# Check if GNU Stow is installed
# If not, install it
if ! command -v stow &> /dev/null; then
    echo "GNU Stow not found. Installing..."
    sudo apt install stow
else
    echo "GNU Stow is already installed."
fi

# Install oh-my-posh
if ! command -v oh-my-posh &> /dev/null; then
    echo "Oh My Posh not found. Installing..."
    curl -s https://ohmyposh.dev/install.sh | bash -s
else
    echo "Oh My Posh is already installed."
fi

# Install tmux
if ! command -v tmux &> /dev/null; then
    echo "Tmux not found. Installing..."
    sudo apt install tmux
else
    echo "Tmux is already installed."
fi

echo "Symlinking tmux config..."
stow --dir="$HOME/dotfiles" --target="$HOME" tmux
echo "...done."

# Install neovim
if ! command -v nvim &> /dev/null; then
    echo "Neovim not found. Installing..."
    sudo apt install neovim
else
    echo "Neovim is already installed."
fi

# Install ripgrep
if ! command -v rg &> /dev/null; then
    echo "Ripgrep not found. Installing..."
    sudo apt-get install ripgrep
else
    echo "Ripgrep is already installed."
fi

echo "Symlinking neovim config..."
stow --dir="$HOME/dotfiles" --target="$HOME" nvim
echo "...done."

# Check if ZSH is installed
if ! command -v zsh &> /dev/null; then
    echo "ZSH not found. Installing..."
    sudo apt install zsh
else
    echo "ZSH is already installed."
fi

# If ZSH is not the default shell, change it
if [ "$SHELL" != "$(which zsh)" ]; then
    echo "Changing default shell to ZSH..."
    chsh -s "$(which zsh)"
    echo "Please log out and log back in for the changes to take effect."
else
    echo "ZSH is already the default shell."
fi

echo "Symlinking zsh config..."
stow --dir="$HOME/dotfiles" --target="$HOME" zsh
# if it's not already a symlink, create a symlink to the macOS zshrc
if [ ! -L "$HOME/.zshrc" ]; then
    echo "Removing existing .zshrc..."
    rm -f "$HOME/.zshrc"
fi
ln -s "$HOME/.zshrc.macos" "$HOME/.zshrc"
echo "...done."

echo "Symlinking git config..."
stow --dir="$HOME/dotfiles" --target="$HOME" git
echo "...done."

