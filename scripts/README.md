# Scripts Directory

This directory contains utility scripts for setting up and managing the dotfiles environment across different platforms.

## Scripts Overview

### System Setup Scripts

#### `init-macos.sh`
Platform-specific setup script for macOS systems.

**What it does:**
- Installs Homebrew package manager if not present
- Installs essential development tools:
  - GNU Stow (for symlink management)
  - Alacritty (terminal emulator)
  - Hack Nerd Font
  - Oh My Posh (shell prompt)
  - Tmux (terminal multiplexer)
  - Neovim (text editor)
  - Ripgrep (search tool)
  - fd (file finder)
- Creates symlinks for all configuration files using GNU Stow
- Sets up shell environment (zsh configuration)

**Usage:** `./scripts/init-macos.sh`

#### `init-ubuntu.sh`
Platform-specific setup script for Ubuntu/Linux systems.

**What it does:**
- Installs packages using apt package manager
- Installs essential development tools:
  - GNU Stow
  - Oh My Posh (via curl installation)
  - Tmux
  - Neovim (via custom build script)
  - Ripgrep
  - Zsh shell
- Changes default shell to zsh if needed
- Creates symlinks for all configuration files
- Sets up Ubuntu-specific shell environment

**Usage:** `./scripts/init-ubuntu.sh`

#### `install-neovim-ubuntu.sh`
Specialized script for building Neovim from source on Ubuntu systems.

**What it does:**
- Installs build dependencies (ninja-build, gettext, cmake, curl, build-essential)
- Clones Neovim repository from GitHub
- Builds and installs the stable release
- Cleans up build artifacts

**Usage:** Called automatically by `init-ubuntu.sh` or can be run standalone

### Development Workflow Scripts

#### `vopen.sh`
Creates or attaches to a tmux session with Neovim for project development.

**What it does:**
- Creates a new tmux session in the specified directory (or current directory)
- Opens a terminal window and an editor window with Neovim
- Attaches to existing session if one already exists with the same name
- Session names default to the directory basename

**Usage:** 
```bash
vopen [directory] [session_name]
vopen ~/projects/myapp          # Creates session named 'myapp'
vopen                           # Uses current directory
vopen ~/code/project mywork     # Creates session named 'mywork'
```

**Shell Alias:** `vopen` (available after shell setup)

#### `update-dotfiles.sh`
Updates the dotfiles repository with the latest changes from the remote.

**What it does:**
- Runs `git pull` on the dotfiles repository
- Clears the terminal screen after update
- Provides feedback about the update process

**Usage:** `./scripts/update-dotfiles.sh`
**Shell Alias:** `refresh`

### AWS Utilities

#### `aws-sso-check.sh`
Automatically detects and handles AWS SSO authentication.

**What it does:**
- Checks if current AWS SSO credentials are valid
- Automatically runs `aws sso login` if credentials are expired
- Supports multiple AWS profiles
- Shows current AWS identity after successful authentication
- Provides colored output for better visibility

**Usage:**
```bash
aws-sso-check.sh                    # Use default profile
aws-sso-check.sh -p profile-name    # Use specific profile
aws-sso-check.sh --help             # Show help
```

**Shell Alias:** `awscheck`

## Installation and Usage

### Fresh System Setup
1. Clone the dotfiles repository
2. Run the appropriate platform script:
   - macOS: `./scripts/init-macos.sh`
   - Ubuntu/Linux: `./scripts/init-ubuntu.sh`

### Daily Workflow
- **Start development session:** `vopen ~/path/to/project`
- **Update dotfiles:** `refresh`
- **Check AWS credentials:** `awscheck`

### Script Architecture
- All scripts use `#!/bin/bash` or `#!/usr/bin/env bash` shebangs
- Include error checking with conditional command execution
- Provide informative output during execution
- Support idempotent execution (safe to run multiple times)
- Follow the principle of "check before install/configure"

### Dependencies
- **macOS:** Requires Homebrew for package management
- **Ubuntu:** Uses apt package manager and builds some tools from source
- **All platforms:** Requires Git for repository management and GNU Stow for symlink management

## Contributing
When adding new scripts:
1. Make them executable with `chmod +x`
2. Include appropriate shebang line
3. Add error checking and informative output
4. Update this README with script description
5. Consider adding shell aliases in platform-specific zsh configs