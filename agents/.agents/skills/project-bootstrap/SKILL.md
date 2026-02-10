---
name: project-bootstrap
description: Preferred technology stack, tooling, and architecture decisions for bootstrapping new projects, services, apps, and infrastructure. Use when creating a new project from scratch, scaffolding a new service or app, setting up new infrastructure (Pulumi stacks, Lambda functions, etc.), or making technology selection decisions for new work. Triggers on tasks like "create a new API", "bootstrap a new app", "start a new project", "set up a new Pulumi stack", "create a new Lambda function", or "initialize a new service".
---

# Project Bootstrap

Apply these preferences when scaffolding new projects, services, or infrastructure.

## Language & Runtime Selection

| Domain | Stack |
|---|---|
| Backend (general) | TypeScript on Bun with Hono |
| Backend (performance-critical) | Go |
| Frontend (web) | TypeScript with Next.js |
| Apple platforms (iOS/macOS/etc.) | Swift with SwiftUI + TCA |
| Android | Kotlin |
| Scripting / ML | Python with uv |

Prefer native platforms over cross-platform frameworks (avoid React Native, Flutter).

## Infrastructure

- **Cloud**: AWS, serverless-first (Lambda > Fargate > EC2, prefer managed services)
- **IaC**: Pulumi (preferred), SST 3, SST 2 (phasing out)
- **CI/CD**: GitHub Actions with published actions

## Scaffolding

Always prefer official generators over manual setup:
- Pulumi, CDK, SST, Next.js, Bun, NPM
- Generate first, then customize
