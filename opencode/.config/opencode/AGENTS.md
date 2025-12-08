# AGENTS.md

## Code Style
- Apply standards: DRY, TDD, dependency injection, composability
- Avoid comments unless solution is non-obvious
- Match existing project style, tooling, and patterns in monorepos

## Documentation
- Use comprehensive code documentation to ensure LSP support
- Maintain up-to-date READMEs with: description, tech stack, setup, dependencies
- Split long docs (>200 lines/section) into `docs/` folder
- Required docs: README.md, AGENTS.md, relevant `docs/*.md`

## Tooling

### IDE
- Neovim (config: ~/.config/nvim/, synced across dev machines via GitHub)

### Languages
- **TypeScript**: Bun runtime, Hono backends, Next.js frontends
- **Go**: Performance-critical backends
- **Python**: uv package manager
- **Swift**: Apple platforms with SwiftUI + TCA
- **Kotlin**: Android platforms

**Mobile**: Prefer native platforms over cross-platform (React Native, Flutter)

### Infrastructure
- **IaC**: Pulumi (preferred), SST 3, SST 2 (phasing out)
- **CI/CD**: GitHub Actions with published actions
- **Cloud**: AWS with serverless-first approach (Lambda > Fargate > EC2, managed services)

## Documentation Priority
0. (if available) specialized tools
1. context7
2. Web search

**Never assume - always verify documentation**

## Code Generation
Use official generators for scaffolding:
- Pulumi, CDK, SST, Next.js, Bun, NPM
- Generate first, then customize

## Shell Usage
- Prefer specific tools over shell commands
- If specialized tool fails, stop and report error

## Development Workflow
For complex features/services:

1. Plan and get approval
2. Design-first (e.g., OpenAPI specs for APIs)
3. Follow best practices (see Documentation Priority)
4. Write comprehensive tests, iterate until passing

## Cost Awareness
Investigate and get approval for any cost-increasing changes
