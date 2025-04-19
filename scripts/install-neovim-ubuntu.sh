#!/usr/bin/env bash

# Install prerequisites for Neovim
sudo apt-get install ninja-build gettext cmake curl build-essential

# Install Neovim
git clone https://github.com/neovim/neovim
cd neovim
git checkout stable
make CMAKE_BUILD_TYPE=Release
sudo make install
cd ..
rm -rf neovim
