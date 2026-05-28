<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
<!-- BEGIN:RULES -->

The user is not a developer, you will not ask the user for feedback you will do the entire job. You will not try to run tool calls with elevated privileges, you will not ask the user to run tools you will run them yourself.

<!-- END:RULES -->

# Project Notes

## Architecture
OpenPilot is an AI agent orchestration platform built with:
- **Web app**: Next.js 14 (App Router), TypeScript, Tailwind CSS, NextAuth.js v4 (GitHub OAuth)
- **Database**: PostgreSQL 16 via Prisma ORM
- **Infrastructure**: Docker Compose — services: `web` (port 3000:3000), `code-server` (8080/3001), `postgres`
- **AI backend**: GitHub Copilot API (`https://api.githubcopilot.com/chat/completions`) accessed via a service account token read from `code-server`'s OAuth hosts file
- **Workspace execution**: `docker exec` into the `code-server` container — code files written and commands run inside `/home/coder/workspace/<runId>/`

Key directories:
```
apps/web/
  app/              — Next.js App Router (pages + all API routes)
  components/       — React client components
  services/         — Server-side business logic
  utils/            — Shared utilities (fileParser, modelMultipliers, etc.)
  types/            — TypeScript type definitions
  data/             — Static data (personalities.json)
  prisma/           — Schema + migrations
docker/
  docker-compose.yml
  copilot-bridge/   — VS Code extension exposing Copilot on HTTP :3001 (legacy path)
```

## Build & Run
Requirements: Docker + Docker Compose

```bash
cd docker
docker compose build web
docker compose up -d
```

Web app: `http://localhost:3000`  
The `web` container runs `next start` in production (`NODE_ENV=production`).

To rebuild after code changes:
```bash
cd docker
docker compose build web && docker compose up -d web
```

## Environment Variables
Defined in `docker/docker-compose.yml` (override `apps/web/.env`):

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXTAUTH_URL` | Must match public URL — `http://localhost:3000` |
| `NEXTAUTH_SECRET` | NextAuth JWT signing secret |
| `GITHUB_ID` | GitHub OAuth App client ID |
| `GITHUB_SECRET` | GitHub OAuth App client secret |
| `CODE_SERVER_URL` | Internal URL to code-server — `http://code-server:8080` |
| `CODE_SERVER_PASSWORD` | code-server login password |
| `ACCESS_PASSWORD` | Optional — gates the offline sign-in path with a password |

`GITHUB_ID` / `GITHUB_SECRET` can also be set at runtime via the UI (`POST /api/auth/github-credentials`), which writes to `/.env` and hot-reloads them into `process.env` without a container restart.

## Authentication System

### Sign-in flow
1. **GitHub OAuth** (primary) — NextAuth.js GitHub provider. Requires a GitHub OAuth App with callback `http://localhost:3000/api/auth/callback/github`. After sign-in the GitHub access token is persisted in the JWT and exposed on `session.accessToken`.
2. **Offline stored-session** (fallback) — CredentialsProvider that looks up a previously-authenticated user from the local Postgres DB. Shown as avatar buttons on the login screen when the user has signed in before.
3. **Access password gate** — Optional `ACCESS_PASSWORD` env var. When set, the login screen requires the password before the offline sign-in buttons become active. The GitHub OAuth button is always visible and bypasses the gate.

### WSL2 / cross-origin note
`NEXTAUTH_URL` is fixed to `localhost:3000`. If the browser reaches the app via `172.x.x.x:3000` (WSL2 IP), clicking "Sign in with GitHub" redirects to `localhost:3000/?autoSignIn=github` first, so the OAuth state cookie and the GitHub callback are both on `localhost`. This is handled client-side in `components/LoginScreen.tsx → handleGithub()`.

### Cookie config (`[...nextauth]/route.ts`)
All NextAuth cookies are set with `secure: false`, `sameSite: lax` — compatible with HTTP localhost. The handler is cached per-request and only rebuilt when `GITHUB_ID`/`GITHUB_SECRET` change (avoids CSRF token regeneration on every request).

## Features

### 1. Auto Pilot — Worker ↔ Manager Agent Loop
The core feature. Two AI agents collaborate to build software autonomously from a specification.

**How it works:**
- **Manager** reads the spec, breaks it into tasks, and reviews worker output. Emits structured tokens: `[NEXT_TASK: ...]`, `[CORRECTION: ...]`, `[ANSWER: ...]`, `[COMPLETE]`.
- **Worker** implements tasks, writes files in fenced code blocks, runs shell commands via `[EXEC: command]`, and emits `[SERVE: command]` when a preview server is ready, `[DONE]` when complete.
- Files in worker output are automatically parsed and written to the code-server container workspace before each `[EXEC:]` runs.
- Commands execute inside `docker exec code-server bash -c "..."` in `/home/coder/workspace/<runId>/`.
- The loop runs client-side (`AgentWorkspace.tsx`) — each step calls `POST /api/agents/step`.

**Run lifecycle:**  
`idle → running → paused / complete / error`

**Controls:** Start, Step (single iteration), Pause, Resume, Stop, Restart (with confirmation), Delete.

**Message injection:** User can inject text into either the Worker or Manager conversation mid-run.

**Continue:** After completion, user can add a new spec and resume the run with the same or a different personality.

**Persistence:** Full run state (histories, log, config, checkpoints) is saved to `AgentRunState` in Postgres on every step via `POST /api/runs/save`. Runs are reloaded from DB on page load.

### 2. Agent Personalities
8 built-in personalities loaded from `data/personalities.json`, each providing tailored Worker + Manager system prompts:

| ID | Focus |
|---|---|
| `developer` | Full-stack software development |
| `designer` | UI/UX design and frontend |
| `gamedev` | Game development |
| `devops` | Infrastructure, CI/CD, containers |
| `qa` | Testing, QA automation |
| `datascientist` | Data analysis, ML pipelines |
| `secops` | Security, hardening, auditing |
| `writer` | Technical writing, docs, content |

Selectable via an animated carousel in `NewRunModal`. Preference is saved to `localStorage`.

### 3. New Run Modal (`NewRunModal.tsx`)
Configuration form for creating a run:
- **Agent type** carousel
- **Run title** and **Specification** textarea
- **Fill with AI** — calls `POST /api/copilot` in `plan` mode to expand a title into a detailed spec
- **Expand spec** — fullscreen spec editor
- **Worker model + effort** / **Manager model + effort** — independent model pickers per agent
- **Max iterations** limit
- **Approval mode**: Approvals (pause before each action) / Bypass / Autopilot (fully autonomous)
- **Create GitHub repo when complete** — auto-pushes to a new GitHub repo after `[COMPLETE]`
- **Continue from existing repo** — clones a repo and creates a feature branch before starting
- All preferences are persisted to `localStorage` (`openpilot_run_prefs`)

### 4. Workspace Execution (`/api/exec/*`)
All execution happens inside the `code-server` Docker container:

| Endpoint | Purpose |
|---|---|
| `POST /api/exec` | Run a shell command + optionally write files first |
| `DELETE /api/exec` | Stop preview server + delete workspace directory |
| `POST /api/exec/serve` | Start a preview server process inside the container |
| `DELETE /api/exec/serve` | Stop the preview server |
| `POST /api/exec/workspace-init` | Create workspace dir, seed AGENTS.md/CLAUDE.md; or clone existing repo + create branch |
| `POST /api/exec/checkpoint` | Create a git commit snapshot in the workspace |
| `GET /api/exec/checkpoint/diff` | Show diff from a checkpoint commit to HEAD |
| `POST /api/exec/restore` | `git reset --hard <commitHash>` to restore a checkpoint |
| `POST /api/exec/git-push` | Push workspace repo to a remote URL |

### 5. Workspace Checkpoints (`CheckpointsPanel.tsx`)
After each successful `[EXEC:]`, a git commit is auto-created in the workspace via `POST /api/exec/checkpoint`. Stored in `AgentRun.checkpoints[]`.

- **View diff** — shows what would be lost by restoring to a checkpoint
- **Restore** — resets workspace to the checkpoint; informs both agents via system message

### 6. Live Preview
When the worker emits `[SERVE: command]`, the preview server is started via `POST /api/exec/serve` on a per-run port (allocated from a pool). An **Open Preview** button appears in the toolbar that opens the preview URL in a new tab. Preview server is stopped on run delete or restart.

### 7. Monitor Panel (`MonitorPanel.tsx`)
An AI quality monitor that observes the agent loop and reports findings.
- Runs every N iterations (configurable)
- Calls `POST /api/agents/monitor` with recent log entries
- Returns structured JSON findings: `{severity: "error"|"warning"|"info", category, message}`
- Findings displayed in a collapsible right-hand panel
- Model is independently selectable
- Findings are exported with the run JSON

### 8. Files Modal (`FilesModal.tsx`)
Parses worker output for fenced code blocks and displays all files written to the workspace in the current run. Uses `utils/fileParser.ts`.

### 9. GitHub Integration
- **Create & Push** (`/api/github/create-and-push`) — creates a new GitHub repo via the GitHub API using the session `accessToken`, then pushes the workspace via HTTPS with token auth
- **Delete Repo** (`/api/github/delete-repo`) — deletes a GitHub repo
- `GitHubPushModal.tsx` — triggered by the "Push to GitHub" toolbar button; lets user name the repo or auto-generate from run title

### 10. Chat / Conversations (`ChatBox.tsx`)
General-purpose AI chat backed by `POST /api/copilot`. Conversations are saved to `Conversation` records in Postgres (`/api/conversations`). Supports model selection and mode (ask / plan / agent).

### 11. Model Selector (`ModelSelector.tsx`)
Fetches available models from `GET /api/models` (which queries `https://api.githubcopilot.com/models`). Displays friendly names, filters hidden/routing models, shows cost multipliers. Supports reasoning effort selection for o-series and Claude models.

### 12. API Keys (`ApiKeysManager.tsx`, `/api/apikeys/*`)
Manage named API keys stored in the `ApiKey` Postgres table. Keys are SHA-256 hashed; only a short prefix is stored in plain text. Features: list, create, update (name/enabled/model), rotate (new secret), delete.

### 13. Backup & Restore (`BackupPanel.tsx`, `/api/backup/*`)
- **Export** — downloads full DB as JSON
- **Import** — replaces live DB from uploaded JSON file
- **List** — list auto-backup files
- **Restore** — restore from a named backup
- **Trigger** — create an on-demand backup
- **Config** — enable/disable auto-backup and set interval in hours

### 14. Notifications (`NotificationPanel.tsx`, `/api/notifications/*`)
Configurable notifications (e.g. when a run completes). Config stored in memory via `notificationService`. Routes: `GET/POST /api/notifications/config`, `POST /api/notifications/send`, `POST /api/notifications/test`.

### 15. Self-Training / Personality Refinement (`/api/training/*`)
After a run completes, the system can record it to `AgentRunRecord` with per-step token counts, correction count, and monitor findings.

- `POST /api/training/score` — record a completed run + thumbs-up/down rating
- `POST /api/training/refine/[personalityId]` — uses scored runs to generate an improved system prompt via Copilot; stores as a new `PersonalityVersion`

DB models: `AgentRunRecord`, `AgentRunStep`, `PersonalityVersion`.

### 16. Dashboard (`Dashboard.tsx`)
Usage overview — shows recent runs, model usage stats, and other metrics.

### 17. Security Panel (`SecurityPanel.tsx`)
Displays security-related configuration (e.g. access password status, session info).

### 18. Setup Copilot (`SetupCopilot.tsx`, `/api/setup-vscode/*`)
Guides the user through authorizing VS Code / Copilot in the code-server container. Polls `/api/setup-vscode/poll` for authorization status. Checks for OAuth token in the Copilot hosts file at `/home/coder/.config/github-copilot/hosts.json`.

### 19. Sidebar (`Sidebar.tsx`)
Left-hand navigation with tabs: Autopilot (run list), Chat, Dashboard, Documentation, and settings panels. Displays all agent runs with status badges.

### 20. Assistant Bot (`AssistantBot.tsx`)
Floating AI assistant widget for quick queries without leaving the current run view.

## Database Models (Prisma)

| Model | Purpose |
|---|---|
| `User` | GitHub users persisted on OAuth sign-in; used for offline sign-in fallback |
| `Conversation` | Chat conversations (title + JSON messages array) |
| `ApiKey` | Named API keys (hashed, with prefix, model binding, usage count) |
| `AgentRunState` | Full serialized `AgentRun` state — survives page reload and server restart |
| `AgentRunRecord` | Completed run metrics for self-training (tokens, corrections, rating) |
| `AgentRunStep` | Per-step token usage for a training record |
| `PersonalityVersion` | Versioned system prompts evolved from training data |

## Copilot Token Flow
1. `copilotAuth.ts → getOAuthToken()` reads the GitHub OAuth token from `/home/coder/.config/github-copilot/hosts.json` inside the `code-server` container (mounted/accessible from the web container).
2. `getCopilotToken()` exchanges that token for a short-lived Copilot API token via `https://api.github.com/copilot_internal/v2/token`.
3. All AI calls (`/api/agents/step`, `/api/agents/monitor`, `/api/copilot`, `/api/models`) use this token.

## Context Window Management
`agentOrchestrator.ts → trimToContextBudget()` trims conversation history to fit within `120,000 * 3 = 360,000 chars` (~120k tokens). The `/api/agents/step` route also reactively retries with trimmed history when the API returns a `model_max_prompt_tokens_exceeded` error.

## Known Quirks & Constraints
- `NEXTAUTH_URL` must be `http://localhost:3000`. Accessing from a different host (WSL2 IP, remote IP) requires the browser to be able to reach `localhost:3000` for OAuth callbacks to work.
- GitHub OAuth App callback URL must be `http://localhost:3000/api/auth/callback/github`.
- The `code-server` container must be named `code-server` in Docker (hardcoded in `dockerExec.ts`).
- Preview servers inside code-server use port 4000 by convention (`[SERVE: command]` should always use port 4000).
- `apps/web/.env` is mounted into the container at `/.env`; credentials written by the UI persist across restarts.

## Testing
No automated tests yet. The build pipeline (`npm run build`) acts as a type/compile check.

## CI
No CI pipeline configured yet.