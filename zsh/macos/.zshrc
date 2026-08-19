# pnpm
export PNPM_HOME="/Users/matthewwyskiel/Library/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac
# pnpm end
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

# sst
export PATH=/Users/matthewwyskiel/.sst/bin:$PATH

# claude
export CLAUDE_HOME="$HOME/.claude"
export PATH="$CLAUDE_HOME/local:$PATH"

# User-installed binaries, including mise.
export PATH="$HOME/.local/bin:$PATH"

# The next line updates PATH for the Google Cloud SDK.
if [ -f '/Users/matthewwyskiel/Downloads/google-cloud-sdk/path.zsh.inc' ]; then . '/Users/matthewwyskiel/Downloads/google-cloud-sdk/path.zsh.inc'; fi

# The next line enables shell command completion for gcloud.
if [ -f '/Users/matthewwyskiel/Downloads/google-cloud-sdk/completion.zsh.inc' ]; then . '/Users/matthewwyskiel/Downloads/google-cloud-sdk/completion.zsh.inc'; fi
# The following lines have been added by Docker Desktop to enable Docker CLI completions.
fpath=(/Users/matthewwyskiel/.docker/completions $fpath)
autoload -Uz compinit
compinit
# End of Docker CLI completions

alias init="$HOME/dotfiles/init.sh"
alias refresh="$HOME/dotfiles/scripts/update-dotfiles.sh"
alias vopen="$HOME/dotfiles/scripts/vopen.sh"
alias awscheck="$HOME/dotfiles/scripts/aws-sso-check.sh"

export TURBO_UI=true

# bun completions
[ -s "/Users/matthewwyskiel/.bun/_bun" ] && source "/Users/matthewwyskiel/.bun/_bun"

# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# if .config/vars.sh exists, run it such that its environment variables are exported and available in the current shell
if [ -f "$HOME/.config/vars.sh" ]; then
  . "$HOME/.config/vars.sh"
fi

eval "$(oh-my-posh init zsh --config $(brew --prefix oh-my-posh)/themes/catppuccin_mocha.omp.json)"

# opencode
export PATH=/Users/matthewwyskiel/.opencode/bin:$PATH

# rust
. "$HOME/.cargo/env"

export DYLD_FALLBACK_LIBRARY_PATH="$(brew --prefix)/lib:$DYLD_FALLBACK_LIBRARY_PATH"

export DOCUMENTS="/Users/matthewwyskiel/Library/CloudStorage/OneDrive-Personal/Documents"
export EDITOR="nvim"
export PATH="/opt/homebrew/opt/ffmpeg-full/bin:$PATH"
export PATH="/opt/homebrew/opt/curl/bin:$PATH"

# Activate the globally declared toolchain from ~/.config/mise/config.toml.
if command -v mise >/dev/null 2>&1; then
  eval "$(mise activate zsh)"
fi
