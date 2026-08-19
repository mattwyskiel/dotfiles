export PATH="$HOME/.local/bin:$PATH"

alias init="$HOME/dotfiles/init.sh"
alias refresh="$HOME/dotfiles/scripts/update-dotfiles.sh"
alias vopen="$HOME/dotfiles/scripts/vopen.sh"

eval "$(oh-my-posh init zsh --config 'https://raw.githubusercontent.com/JanDeDobbeleer/oh-my-posh/main/themes/catppuccin_mocha.omp.json')"

export EDITOR="nvim"

# Activate the globally declared toolchain from ~/.config/mise/config.toml.
if command -v mise >/dev/null 2>&1; then
  eval "$(mise activate zsh)"
fi
