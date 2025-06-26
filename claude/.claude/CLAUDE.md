# CLAUDE.md

This file provides general guidance to Claude Code (claude.ai/code) when working with code on this machine.

## Style

### Code
- When scaffolding new projects, use best-practice linting and formatting tools from the start.
    - e.g. for TypeScript projects, include ESLint and Prettier as dependencies and create their config files
- When creating new sub-codebases within a larger codebase (i.e. monorepo), ensure that the style, tooling, etc. fits in with the rest of the project. Similar boilerplate for similar Things being generated, etc.

### Documentation
- Embrace the use of code-docs in whatever language you're working in. Make it so the LSP
- A comprehensive README is essential to a project I can work on in parallel with others, or take a break from and come back to.
  - Include sections for a general description, the tech stack, getting started on your local machine, and any other dependencies.
  - Use your judgment on whether the README length in a given situation could be split into multiple docs in a `docs/` folder. A rule of thumb is if we have more than 200 lines in a section, that could be its own Doc.
- A README is useless if it is outdated. Thus, whenever you make a change, check any relevant READMES up the tree from where you're working, to the root of the repo or your working directory (whichever is higher up) and update them if warranted.

## Tooling

I generally use the following tools in my workflow. If there are optimizations to be made to work with these tools, be sure to use them.

### IDE
- Neovim
  - My Neovim config is located in the ~/.config/nvim/ folder. Expect it to be the same on all machines this code is EDITED on (it's synched to GitHub)

### Languages
> NOTE: I'm not limited to these languages. If the task asks for a different language explicitly, use that instead. If there's a better reason to use a different language (performance, libraries available, etc.) stop and let me know and let me decide before moving forward.

- TypeScript
    - Bun
    - Hono for backend apps
    - Next.js for frontend apps
- Go
- Python
    - Prefer `uv`
- Swift
    - Prefer SwiftUI and The Composable Architecture (TCA)

#### Mobile
Prefer to build mobile apps using Native Platforms instead of cross-platform engines like React Native or Flutter.

### Infrastructure

- Orchestration
    - Infrastructure-as-Code is essential
        - Pulumi preferred
        - SST 3 is a good second choice (some good layers over Pulumi)
        - Some projects still use SST 2 - phasing out
        - Always use the existing solution in the project - don't refactor that piece unless asked.
    - GitHub Actions preferred for CI/CD
        - Prefer utilizing published Actions over shell run steps.
- AWS - Primary Cloud Provider
    - Prefer serverless over servers
    - Prefer Lambda over Fargate over EC2
    - Prefer managed services over direct-server solutions (e.g. DynamoDB over, say, Aurora)
- If explicitly asked to use something else, do that.
- If there's something not available with the above tools, or that works better with another provider, get my feedback before moving forward.

### Referencing Documentation
If you do not know something, do not assume. Look up the documentation.
If there is a tool or MCP server available to you specific to the tooling you're wondering about, use that. If context7 is available, use that. Otherwise, do a web search. I cannot stress this enough, don't assume!!

> IMPORTANT: In anything you do, if context7 is available and would be helpful, use that. 

## Generation

Prefer to use generation tools for general project scaffolding, versus writing the code for them yourself.
For example, if the task calls for a new Pulumi project, use the Pulumi tools or CLI to generate the scaffolding, and THEN go ahead with any further changes.
A non-exhaustive list of frameworks/etc. where this applies
- Pulumi
- CDK
- Bun
- NPM
- SST
- Next.js

But you see the common principle here too!

## Iteration
Follow these principles generally, but especially on a sufficiently complex problem (major feature, new service, etc.).

1. Plan the intent based on the problem. Get my approval before executing.
2. Be Design-First. For example, if I ask you to create or modify an API, create or modify its OpenAPI spec first. Seek my approval before continuing.
3. Follow All Best Practices. See the 'Referencing Documentation' section for more on *how* you can do that.
4. Write extensive unit tests. Make sure they pass before you're done with the task. You can feel free to iterate multiple times in order to make that happen.

## Cost
Be **very** cost-conscious.
If you think something I ask for will cost additional money compared to baseline (defined as what's present before the ask), investigate (using the tools available and the web) and bring it to me for my approval before moving forward.
