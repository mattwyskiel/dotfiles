# Agentic Coding Guidelines

## Taking action
- **Never assume - always verify documentation**

## Tracking changes
- Eagerly commit changes made by both myself and you. For big diffs, use your judgment on splitting.

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
