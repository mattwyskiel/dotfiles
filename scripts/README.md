# Scripts Directory

This directory contains utility scripts for setting up and managing the dotfiles environment across different platforms.

## Scripts Overview

### System Setup Scripts

`init.sh` orchestrates setup in three stages: operating-system packages, the portable mise toolchain, and common dotfile links.

#### `init-macos.sh`

Installs macOS-only dependencies with Homebrew and links the Ghostty and macOS Zsh configurations.

#### `init-ubuntu.sh`

Installs Ubuntu/WSL system dependencies in one apt transaction, configures Zsh, and links the Ubuntu Zsh configuration.

#### `install-dev-tools.sh`

Installs mise when needed, links its global configuration, and installs the pinned Neovim toolchain and language servers.

#### `link-dotfiles.sh`

Links common Tmux, Neovim, Git, and Claude configuration, then restores the Neovim plugins pinned in `lazy-lock.json`.

Run the complete setup through `./init.sh`; the individual scripts are implementation stages.

### Development Workflow Scripts

#### `vopen.sh`
Creates or attaches to a tmux session with Neovim for project development.

**What it does:**
- Creates a new tmux session in the specified directory (or current directory)
- Opens Neovim in the first window
- Creates a second "terminal" window with a horizontal split
- Automatically starts Claude Code in the right split of the terminal window
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

#### `aws-sso-check.sh` and `aws-shell.zsh`

The macOS and Ubuntu Zsh configurations load three functions:

```bash
aws sts get-caller-identity          # Check credentials, then run the command once
awscheck                            # Check credentials without running an operation
awscheck -p barnaba --check-only     # Never open a browser
awsrun pulumi preview               # Check credentials before an SDK-based tool
awsrun -p barnaba -- pulumi preview  # Select a profile for the check and the tool
```

The helper uses the AWS CLI credential provider to refresh temporary credentials. It does not print credentials, export keys, or copy token caches. It does not call STS on each check. Non-SSO profiles keep their existing credential provider.

An interactive Zsh session can open browser sign-in when the SSO token is missing or expired. Shell startup does not contact AWS. Non-interactive shells, agents with PTYs, and CI do not open a browser. Network errors and permission errors do not start a login. Commands run once, after a successful check; the wrapper never retries an operation.

For scripts, use `scripts/aws-sso-check.sh --quiet --check-only` before the tool. The script permits browser login only with `--login` and terminal input and error output. Shell functions do not affect tools launched directly by an IDE or agent. Such tools must use a current AWS SDK with SSO token-provider support, or invoke `awsrun` from Zsh.

Use `command aws ...` to bypass the shell wrapper. Help, configuration, explicit sign-in/sign-out, unsigned requests, and CLI skeleton generation bypass checks automatically. `awsrun -p` removes inherited AWS access-key environment variables in its child process so they cannot override the selected profile.

**One-time AWS settings:**

1. In IAM Identity Center, open **Settings → Authentication → Session duration → Configure**.
2. Set **User interactive sessions** to **3 days** (4,320 minutes). This is an instance-wide setting, not a per-device or per-permission-set setting. Leave background-session settings unchanged.
3. Start a new SSO sign-in after saving. Existing sessions keep their original duration.

Keep the shared AWS config in the refreshable form:

```ini
[profile development]
sso_session = personal
sso_account_id = YOUR_ACCOUNT_ID
sso_role_name = YOUR_ROLE
region = us-east-1

[sso-session personal]
sso_start_url = YOUR_ACCESS_PORTAL_URL
sso_region = us-east-1
sso_registration_scopes = sso:account:access
```

The default profile uses `[default]`; other profiles require `[profile NAME]`. Each device must authenticate separately. Do not sync `~/.aws/sso/cache`, `~/.aws/cli/cache`, or credentials files. A longer sign-in session does not make temporary AWS credentials permanent. Automatic refresh works within the sign-in window; human sign-in is still required after that window expires. External identity-provider policy can shorten the window.

**Tests:** `python3 -B scripts/tests/test_aws_auth.py` uses a fake AWS CLI, including terminal and non-terminal cases. It makes no AWS requests.

References: [AWS CLI SSO token provider](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html), [Identity Center session duration](https://docs.aws.amazon.com/singlesignon/latest/userguide/user-interactive-sessions.html).

## Installation and Usage

### Fresh System Setup
1. Clone the dotfiles repository.
2. Run `./init.sh`; it selects and runs the appropriate platform stage automatically.

### Daily Workflow
- **Start development session:** `vopen ~/path/to/project`
- **Update dotfiles:** `refresh`
- **Check AWS credentials:** `awscheck`

### Script Architecture
- `init.sh` owns orchestration; platform scripts only manage OS-specific concerns.
- Shared mise and Stow work lives in dedicated cross-platform stages.
- Scripts use strict Bash error handling and are safe to rerun.

### Dependencies
- **macOS:** Homebrew is installed automatically when missing.
- **Ubuntu/WSL:** Required apt packages are installed automatically.
- **All platforms:** mise installs the pinned editor toolchain from the checked-in declaration.

## Contributing
When adding new scripts:
1. Make them executable with `chmod +x`
2. Include appropriate shebang line
3. Add error checking and informative output
4. Update this README with script description
5. Consider adding shell aliases in platform-specific zsh configs