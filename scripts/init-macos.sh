#!/usr/bin/env bash

# This script is meant set up a fresh computer.
# Goal is for this to work on macOS, Linux, and WSL.

# Check if homebrew is installed
# If not, install it
if ! command -v brew &> /dev/null; then
    echo "Homebrew not found. Installing..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
    echo "Homebrew is already installed."
fi

# Check if GNU Stow is installed
# If not, install it
if ! command -v stow &> /dev/null; then
    echo "GNU Stow not found. Installing..."
    brew install stow
else
    echo "GNU Stow is already installed."
fi


# Check if Ghostty is installed
# If not, install it
if ! [ -d "/Applications/Ghostty.app" ]; then
    echo "Ghostty not found. Installing..."
    brew install --cask ghostty
else
    echo "Ghostty is already installed."

fi
# Check if Hack Nerd Font is installed
# If not, install it
if ! [ -f "$HOME/Library/Fonts/HackNerdFont-Regular.ttf" ]; then
    echo "Hack Nerd Font not found. Installing..."
    brew install font-hack-nerd-font
else
    echo "Hack Nerd Font is already installed."
fi

echo "Symlinking Ghostty config..."
stow --dir="$HOME/dotfiles" --target="$HOME" ghostty
echo "...done."

# Install oh-my-posh
if ! command -v oh-my-posh &> /dev/null; then
    echo "Oh My Posh not found. Installing..."
    brew install jandedobbeleer/oh-my-posh/oh-my-posh
else
    echo "Oh My Posh is already installed."
fi

# Install tmux
if ! command -v tmux &> /dev/null; then
    echo "Tmux not found. Installing..."
    brew install tmux
else
    echo "Tmux is already installed."
fi

echo "Symlinking tmux config..."
stow --dir="$HOME/dotfiles" --target="$HOME" tmux
echo "...done."

# Install neovim
if ! command -v nvim &> /dev/null; then
    echo "Neovim not found. Installing..."
    brew install neovim
else
    echo "Neovim is already installed."
fi
# Install ripgrep
if ! command -v rg &> /dev/null; then
    echo "Ripgrep not found. Installing..."
    brew install ripgrep
else
    echo "Ripgrep is already installed."
fi

if ! command -v fd &> /dev/null; then
    echo "fd-find not found. Installing..."
    brew install fd
else
    echo "fd-find is already installed."
fi

echo "Symlinking neovim config..."
stow --dir="$HOME/dotfiles" --target="$HOME" nvim
echo "...done."

echo "Symlinking zsh config..."
cd zsh
stow --target="$HOME" macos
cd ..
echo "...done."

echo "Symlinking git config..."
stow --dir="$HOME/dotfiles" --target="$HOME" git
echo "...done."

echo "Symlinking claude config..."
stow --dir="$HOME/dotfiles" --target="$HOME" claude
echo "...done."

