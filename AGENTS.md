# AGENTS.md

## Build/Test Commands
- **Test scripts**: Manual execution of scripts in `scripts/` directory
- **Installation test**: `./init.sh` (detects platform and runs appropriate setup)
- **Single script test**: Run individual scripts directly (e.g., `bash scripts/aws-sso-check.sh --help`)

### General
- **Documentation**: Comprehensive READMEs, update when code changes
- **Tooling**: Prefer generation tools (Pulumi, CDK, Next.js, Bun) over manual scaffolding
- **Languages**: TypeScript (Bun/Hono/Next.js), Go, Python (uv), Swift (TCA)
- **Infrastructure**: AWS preferred, serverless > servers, IaC essential (Pulumi > SST)
- **Cost-conscious**: Investigate costs before implementing paid services
