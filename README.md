# My Dotfiles

Hello! This is my one-stop shop for getting a new machine up and running with my particular settings and preferences.
The goal here is to be as machine-agnostic as possible, so that I can have a seamless experience across all my devices.

## What's Included
- `init.sh`: The main script that installs all the necessary packages and sets up the environment.
- `zsh/`: Contains my `.zshrc` configuration
- `git/`: Contains my `.gitconfig`
- `nvim/`: Contains my Neovim configuration
- `tmux/`: Contains my Tmux configuration
- `alacritty/`: Contains my Alacritty configuration (terminal emulator)

## Installation
### Pre-requisites
- The `init.sh` script will install homebrew, from which all other packages will be installed. Thus, you need to have the system requirements for Homebrew:
    - [macOS](https://docs.brew.sh/Installation#macos-requirements)
        - An Apple Silicon CPU or 64-bit Intel CPU
        - macOS Ventura (13) (or higher) installed on officially supported hardware
        - Command Line Tools (CLT) for Xcode (from xcode-select --install or https://developer.apple.com/download/all/) or Xcode
        - The Bourne-again shell for installation (i.e. bash)
    - [Linux or WSL](https://docs.brew.sh/Homebrew-on-Linux#requirements)
        - Debian or Ubuntu
            `sudo apt-get install build-essential procps curl file git`
        - Fedora, CentOS, or Red Hat
            `sudo yum groupinstall 'Development Tools'`
            `sudo yum install procps-ng curl file git`
        - Arch Linux
            `sudo pacman -S base-devel procps-ng curl file git`

### Steps
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
