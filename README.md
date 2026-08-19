# My Dotfiles

Hello! This is my one-stop shop for getting a new machine up and running with my particular settings and preferences.
The goal here is to be as machine-agnostic as possible, so that I can have a seamless experience across all my devices.

## What's Included
- `init.sh`: Orchestrates OS packages, the portable development toolchain, and common dotfile links.
- `mise/`: Declares pinned, cross-platform development tools and language servers.
- `scripts/`: Contains sub-scripts that are called by `init.sh` to perform specific tasks.
    - `init-macos.sh`: Installs macOS-specific packages and configurations.
    - `init-ubuntu.sh`: Installs Ubuntu/WSL-specific packages and configurations.
    - `install-dev-tools.sh`: Installs mise and the tools declared in `mise/.config/mise/config.toml`.
    - `link-dotfiles.sh`: Links common configuration and restores pinned Neovim plugins.
    - `vopen.sh`: Creates a tmux session with Neovim and terminal windows, includes Claude Code integration.
    - `aws-sso-check.sh`: Automatically manages AWS SSO authentication with support for multiple profiles.
    - `update-dotfiles.sh`: Updates the dotfiles repository from remote (aliased as `refresh`).
- `zsh/`: Contains my `.zshrc` configuration
- `git/`: Contains my `.gitconfig`
- `nvim/`: Contains my Neovim configuration. LSP clients use Neovim's native `vim.lsp` API; their executables are supplied by mise.
- `tmux/`: Contains my Tmux configuration
- `alacritty/`: Contains my Alacritty configuration (terminal emulator)

## Installation
1. Clone this repository to your local machine:
    ```bash
    git clone https://github.com/mattwyskiel/dotfiles.git
    ```
2. Run the `init.sh` script:
    ```bash
    cd dotfiles
    chmod +x init.sh
    ./init.sh
    ```

## Development Toolchain

`~/.config/mise/config.toml` pins Neovim, language runtimes, LSP servers, and formatter/search tools. The accompanying `mise.lock` contains release metadata for macOS and Linux on arm64 and x64.

To add or update a tool, use mise so it updates the declaration rather than editing generated state manually:

```bash
mise use --global --pin <tool>@<version>
mise lock --global --platform macos-arm64,macos-x64,linux-arm64,linux-x64
```

LSP editor settings live separately in `nvim/.config/nvim/lua/mattwyskiel/plugins/lspconfig/servers.lua` and use Neovim's native `vim.lsp.config()` API.

## Key Commands After Setup
- `init` - Alias for `$HOME/dotfiles/init.sh` (re-run full setup)
- `refresh` - Alias for `$HOME/dotfiles/scripts/update-dotfiles.sh` (pull latest changes)
- `vopen [directory] [session_name]` - Creates/attaches to tmux session with Neovim and Claude Code
- `awscheck [-p profile] [--quiet]` - Checks and manages AWS SSO authentication

## Architecture
This repository uses **GNU Stow** for symlink management, organizing configurations by application. Each directory mirrors the target home directory structure. See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation, common modification patterns, and development guidelines including preferred project scaffolding tools.
