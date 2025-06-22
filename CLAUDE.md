# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Installation and Setup
- `./init.sh` - Master installation script that detects OS and runs appropriate platform setup
- `init` - Alias for `$HOME/dotfiles/init.sh` (available after shell setup)
- `refresh` - Alias for `$HOME/dotfiles/scripts/update-dotfiles.sh` to pull latest dotfiles changes

### Workflow Commands
- `vopen [directory] [session_name]` - Creates/attaches to tmux session with Neovim and Claude Code
  - Usage: `vopen ~/projects/myapp` or `vopen` (defaults to current directory)
  - Creates tmux session with Neovim in first window, terminal window with Claude Code split
- `awscheck [-p profile] [--quiet]` - Checks and manages AWS SSO authentication
  - Usage: `awscheck --quiet` (ideal for shell startup), `awscheck -p myprofile`

### Platform-Specific Setup
- **macOS**: `scripts/init-macos.sh` - Uses Homebrew for package management
- **Ubuntu/WSL**: `scripts/init-ubuntu.sh` - Uses apt, builds Neovim from source

## Architecture and Structure

### Repository Organization
This dotfiles repository is organized **by application** with GNU Stow for symlink management:

```
dotfiles/
├── alacritty/.config/alacritty/    # Terminal emulator config
├── git/.gitconfig                  # Git configuration  
├── nvim/.config/nvim/             # Neovim configuration
├── tmux/.tmux.conf                # Tmux configuration
├── zsh/macos/                     # macOS-specific shell config
├── zsh/ubuntu/                    # Ubuntu-specific shell config
└── scripts/                       # Installation and utility scripts
```

### Symlink Management with GNU Stow
- Each application directory mirrors the target home directory structure
- Use `stow --dir="$HOME/dotfiles" --target="$HOME" <app>` to create symlinks
- Example: `alacritty/.config/alacritty/alacritty.toml` → `~/.config/alacritty/alacritty.toml`

### Key Configuration Areas

#### Neovim Configuration (`nvim/.config/nvim/`)
- **Plugin management**: Uses lazy.nvim with extensive plugin ecosystem
- **LSP integration**: Full Language Server Protocol setup
- **AI assistance**: Configured with Copilot, CodeCompanion, and MCP
- **Key directories**:
  - `lua/mattwyskiel/plugins/` - Individual plugin configurations
  - `lua/mattwyskiel/plugins/lspconfig/` - LSP server configurations
  - Plugin files are commonly modified and frequently updated

#### Shell Configuration
- **macOS**: `zsh/macos/.zshrc` contains PATH management for development tools
- **Auto-refresh**: macOS shell runs `refresh` on startup to update dotfiles
- **Development paths**: Configured for Node.js (nvm, bun, pnpm), Python (pipx), Google Cloud SDK
- **Aliases**: `init`, `refresh`, `vopen` for common dotfiles operations

#### Cross-Platform Considerations
- Platform detection in `init.sh` handles macOS, Ubuntu, and WSL
- Package managers: Homebrew (macOS) vs apt (Ubuntu)
- Oh My Posh themes: Local themes (macOS) vs remote themes (Ubuntu)
- Shell configs separated by platform in `zsh/` subdirectories

### Development Workflow Integration
- **vopen.sh**: Core workflow script that creates tmux sessions with Neovim and Claude Code integration
- **aws-sso-check.sh**: Seamless AWS authentication with quiet mode for shell startup
- **Auto-updates**: Shell automatically pulls latest dotfiles changes on startup
- **One-command setup**: Fresh machine setup requires only running `./init.sh`
- **Modular installation**: Each component (Alacritty, tmux, Neovim, etc.) installed and configured separately

### Common Modification Patterns
When modifying this repository:
1. **Plugin changes**: Edit files in `nvim/.config/nvim/lua/mattwyskiel/plugins/`
2. **Shell aliases/paths**: Modify appropriate `zsh/[platform]/.zshrc`
3. **New tools**: Add installation logic to platform-specific init scripts
4. **Terminal appearance**: Modify `alacritty/.config/alacritty/alacritty.toml`
5. **After changes**: Use `refresh` to pull updates or re-run `init` for full reinstall

### Documentation Guidelines
When uncertain about implementation details:
- **Prioritize context7**: Use context7 whenever available and relevant for documentation lookup
- **Use available tools**: Leverage MCP servers for accurate documentation lookup
- **Research first**: Always look up official documentation rather than making assumptions
- **Web search as fallback**: Use web search when specific tooling documentation isn't available through MCP
- **Verify accuracy**: Double-check implementation details against official sources

### Project Generation and Scaffolding
Prefer using generation tools for project scaffolding rather than manual code creation:
- **Pulumi**: Use Pulumi CLI for new project scaffolding
- **CDK**: Use CDK CLI for AWS CDK project initialization
- **Next.js**: Use `create-next-app` for new Next.js projects
- **Bun**: Use `bun create` for new Bun projects
- **NPM**: Use `npm init` or package generators for new packages
- **SST**: Use SST CLI for serverless project scaffolding

**Workflow**: Generate scaffolding first, then customize with specific requirements