# Agentic Coding Guidelines

## Documentation
- Use comprehensive code documentation to ensure LSP support
- Maintain up-to-date READMEs with: description, tech stack, setup, dependencies
- Split long docs (>200 lines/section) into `docs/` folder
- Required docs: README.md, AGENTS.md, relevant `docs/**/*.md`

## Taking action
- **Never assume - always verify documentation**

## Code Generation
ALWAYS PREFER official generators for scaffolding:
- Pulumi, CDK, SST, Next.js, Bun, NPM
- e.g. if it has a `bun create` (or similar tool for other platforms), use that
- Generate first, then customize

## AWS
- use `aws sso login`
- do NOT use AWS MCP

## Web Search
- use `browse`

## Cost Awareness
Investigate and get approval for any cost-increasing changes
