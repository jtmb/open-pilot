<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
<!-- BEGIN:RULES -->

The user is not a developer, you will not ask the user for feedback you will do the entire job. You will not try to run tool calls with elevated privileges, you will not ask the user to run tools you will run them yourself.

<!-- END:RULES -->

# Project Notes

## Architecture
This repository is an AI agent orchestration platform (open-pilot) built with:
- **Web app**: Next.js 14 (App Router), TypeScript, Tailwind CSS, NextAuth.js v4 (GitHub OAuth)
- **Database**: PostgreSQL 16 via Prisma ORM
- **Infrastructure**: Docker Compose — services: `web` (port 3002:3000), `code-server` (8080/3001), `postgres`
- **AI**: GitHub Copilot integration via a code-server bridge extension (`docker/copilot-bridge/`)

Key directories:
- `apps/web/app/` — Next.js App Router pages and API routes
- `apps/web/components/` — React client components (AgentWorkspace, AppShell, etc.)
- `apps/web/services/` — Business logic (agentOrchestrator, copilotService, jobService, etc.)
- `apps/web/prisma/` — Prisma schema and migrations
- `docker/` — Docker Compose, code-server settings, copilot-bridge extension

## Build & Run
Requirements: Docker + Docker Compose

```bash
cd docker
docker compose build web
docker compose up -d
```

Web app available at http://localhost:3002

## Environment Variables
Defined in `docker/docker-compose.yml`:
- `DATABASE_URL` — PostgreSQL connection string
- `NEXTAUTH_URL` — must match the public URL (http://localhost:3002)
- `NEXTAUTH_SECRET` — NextAuth signing secret
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — GitHub OAuth app credentials

## Testing
No automated tests yet. The build pipeline (`npm run build`) acts as a type/compile check.

## CI
No CI pipeline configured yet.