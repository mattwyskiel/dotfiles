# AGENTS.md

## Build/Test Commands
- **Lint**: `stylua .` (Lua formatting in nvim/.config/nvim/)
- **Test scripts**: Manual execution of scripts in `scripts/` directory
- **Installation test**: `./init.sh` (detects platform and runs appropriate setup)
- **Single script test**: Run individual scripts directly (e.g., `bash scripts/aws-sso-check.sh --help`)

## Code Style Guidelines

### Lua (Neovim config)
- **Formatting**: 2-space indentation, Unix line endings, single quotes preferred
- **Styling**: No call parentheses where possible, use stylua config in `nvim/.config/nvim/.stylua.toml`
- **Structure**: Plugin configs in separate files under `lua/mattwyskiel/plugins/`
- **Imports**: Use lazy.nvim plugin structure with event-based loading
- **Types**: Use EmmyLua annotations for function parameters and return types
- **Naming**: camelCase for variables/functions, PascalCase for modules/classes
- **Error handling**: Use `vim.notify()` for user-facing errors, `error()` for fatal issues

### Shell Scripts
- **Shebang**: `#!/bin/bash` or `#!/usr/bin/env bash`
- **Error handling**: Use `set -e` for early exit on errors, check command success with `||`
- **Output**: Informative colored output using RED/GREEN/YELLOW variables
- **Idempotency**: Scripts safe to run multiple times, check before install/configure
- **Functions**: Use functions for reusable logic, descriptive names
- **Variables**: UPPERCASE for constants, lowercase for locals

### General
- **Documentation**: Comprehensive READMEs, update when code changes
- **Tooling**: Prefer generation tools (Pulumi, CDK, Next.js, Bun) over manual scaffolding
- **Languages**: TypeScript (Bun/Hono/Next.js), Go, Python (uv), Swift (TCA)
- **Infrastructure**: AWS preferred, serverless > servers, IaC essential (Pulumi > SST)
- **Cost-conscious**: Investigate costs before implementing paid services
