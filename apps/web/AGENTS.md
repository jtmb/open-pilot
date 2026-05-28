<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# apps/web — Next.js Application Notes

## Quick Reference

- **Framework**: Next.js 14.2.0, App Router, TypeScript strict mode
- **Styling**: Tailwind CSS v3
- **Auth**: NextAuth.js v4 — JWT strategy, GitHub + CredentialsProvider
- **ORM**: Prisma 5 + PostgreSQL 16
- **Container**: Runs as `next start` (production) on port 3000 inside Docker

## File Conventions

- API routes live in `app/api/<path>/route.ts` — use `NextRequest`/`NextResponse`
- All client components must have `'use client'` at top
- Server components: default (no directive needed)
- Prisma client is a singleton in `lib/prisma.ts` — always import from there
- BigInt dates: Prisma schema uses `BigInt` for timestamps; always `Number(bigint)` before JSON serialization

## Component Map

| Component | Role |
|---|---|
| `AppShell.tsx` | Root layout: sidebar + main area, session gating, run list management |
| `LoginScreen.tsx` | Full sign-in page: GitHub OAuth, offline fallback, credentials form, access gate |
| `AgentWorkspace.tsx` | Main run view: log panels, controls, monitor, checkpoints, inject, preview |
| `NewRunModal.tsx` | Create-run dialog: personality carousel, spec, model pickers, GitHub options |
| `Sidebar.tsx` | Left nav: run list, tab switching, status badges |
| `ModelSelector.tsx` | Header model/mode/effort picker; exports `bestFreeModel`, `multiplierLabel` |
| `ChatBox.tsx` | General AI chat with conversation persistence |
| `MonitorPanel.tsx` | AI quality monitor findings display |
| `CheckpointsPanel.tsx` | Workspace checkpoint list with diff/restore |
| `FilesModal.tsx` | Parsed workspace files from worker output |
| `GitHubPushModal.tsx` | Push-to-GitHub dialog |
| `BackupPanel.tsx` | DB backup/restore UI |
| `ApiKeysManager.tsx` | API key CRUD UI |
| `NotificationPanel.tsx` | Notification config UI |
| `SecurityPanel.tsx` | Security info panel |
| `Dashboard.tsx` | Run stats/overview |
| `Documentation.tsx` | In-app docs including `GitHubOAuthBrowserDocs` |
| `AuthUI.tsx` | Compact header auth widget (sign in/out) |
| `SetupCopilot.tsx` | Copilot authorization flow |
| `AssistantBot.tsx` | Floating quick-query AI widget |
| `ProfileMenu.tsx` | User avatar menu |
| `AgentPanel.tsx` | Single agent log panel (worker or manager) |
| `AgentDefaults.tsx` | Default config form for agents |

## Service Map

| Service | Role |
|---|---|
| `agentOrchestrator.ts` | Types, system prompts, token parser, `createAgentRun`, `trimToContextBudget` |
| `copilotAuth.ts` | Reads Copilot OAuth token from code-server; exchanges for API token |
| `codeServerAutomation.ts` | Direct Copilot API calls (used by `/api/copilot`) |
| `dockerExec.ts` | `docker exec` wrapper: `runInContainer`, `writeFilesToContainer`, preview server management |
| `copilotService.ts` | `sendCopilotPrompt` — used by `/api/jobs` and `/api/copilot` |
| `jobService.ts` | In-memory job queue (legacy) |
| `backupService.ts` | DB export/import/auto-backup |
| `notificationService.ts` | Notification config + send |
| `codeServerClient.ts` | HTTP client for code-server API |
| `codeServerSetup.ts` | Automated code-server setup helpers |
| `vscodeService.ts` | VS Code command execution via code-server |

## API Route Summary

### Auth
- `GET/POST /api/auth/github-credentials` — check/save GitHub OAuth client ID+secret (hot-reloads without restart)
- `GET/POST /api/auth/access-check` — check if ACCESS_PASSWORD is set; validate submitted password
- `GET /api/auth/stored-users` — list DB users for offline sign-in
- `GET /api/auth/stored-user` — most-recently-updated user (offline fallback)
- `/api/auth/[...nextauth]` — NextAuth handler (CSRF-safe cached handler)

### Agent Execution
- `POST /api/agents/step` — single LLM step for Worker or Manager; handles token overflow retry
- `POST /api/agents/monitor` — quality monitor analysis of recent log entries

### Workspace (exec)
- `POST /api/exec` — write files + run shell command in code-server container
- `DELETE /api/exec` — stop preview + delete workspace dir
- `POST /api/exec/serve` — start preview server on allocated port
- `DELETE /api/exec/serve` — stop preview server
- `POST /api/exec/workspace-init` — initialize workspace (blank or clone existing repo)
- `POST /api/exec/checkpoint` — create git commit snapshot
- `GET /api/exec/checkpoint/diff` — diff checkpoint to HEAD
- `POST /api/exec/restore` — restore workspace to checkpoint
- `POST /api/exec/git-push` — push workspace to remote

### Runs (persistence)
- `GET /api/runs` — list all runs from DB
- `POST /api/runs` — create run in DB
- `GET/PUT/DELETE /api/runs/[id]` — get/update/delete a run
- `POST /api/runs/save` — upsert run state (called after every step)
- `POST /api/runs/[id]/rate` — thumbs up/down rating

### GitHub
- `POST /api/github/create-and-push` — create GitHub repo + push workspace
- `DELETE /api/github/delete-repo` — delete a GitHub repo

### Models / Copilot
- `GET /api/models` — list available Copilot models with display names + multipliers
- `POST /api/copilot` — single-shot Copilot prompt (chat, plan, agent modes)
- `GET /api/jobs`, `POST /api/jobs` — legacy job queue for Copilot prompts
- `GET /api/jobs/[id]` — get job by ID
- `GET /api/jobs/history` — job history

### Conversations
- `GET /api/conversations` — list all conversations
- `POST /api/conversations` — create conversation
- `GET/PUT/DELETE /api/conversations/[id]` — single conversation

### API Keys
- `GET /api/apikeys` — list keys (hashes never exposed)
- `POST /api/apikeys` — create key
- `PATCH/DELETE /api/apikeys/[id]` — update/delete key
- `POST /api/apikeys/[id]/rotate` — rotate secret

### Backup
- `GET /api/backup/export` — download DB as JSON
- `POST /api/backup/import` — replace DB from uploaded JSON
- `GET /api/backup/list` — list backup files
- `POST /api/backup/restore` — restore from named backup
- `POST /api/backup/trigger` — create on-demand backup
- `GET/POST /api/backup/config` — auto-backup config

### Notifications
- `GET/POST /api/notifications/config`
- `POST /api/notifications/send`
- `POST /api/notifications/test`

### Training
- `POST /api/training/score` — record completed run + rating to DB
- `POST /api/training/refine/[personalityId]` — evolve personality system prompts from scored runs

### Setup / VS Code
- `GET/POST /api/setup-vscode` — check/trigger Copilot authorization in code-server
- `GET /api/setup-vscode/poll` — poll for Copilot auth status
- `POST /api/vscode/command` — execute a VS Code command in code-server
- `GET /api/health` — container health check

## Patterns & Gotchas

- **BigInt serialization**: `BigInt` values from Prisma must be cast to `Number` before `JSON.stringify`. Failing to do this causes silent 500 errors.
- **Prisma client caching**: The singleton in `lib/prisma.ts` avoids exhausting DB connections in hot-reload dev mode.
- **NextAuth handler caching**: `buildAuthOptions()` is re-used across requests; the handler is only rebuilt when `GITHUB_ID`/`GITHUB_SECRET` change — prevents CSRF token churn.
- **docker exec path**: `dockerExec.ts` hardcodes the container name `code-server`. The container must exist with this exact name.
- **Workspace path**: Each run gets `/home/coder/workspace/<runId>/` inside code-server. `runId` is validated against `^[a-zA-Z0-9_\-]+$` before use in shell commands.
- **Copilot token refresh**: `getCopilotToken()` fetches a fresh short-lived token on every call — tokens expire in ~30 minutes.
- **Context trimming**: `trimToContextBudget` keeps the system message + trims oldest non-system messages when the history exceeds 360k chars.
