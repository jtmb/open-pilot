# OpenPilot — Elevator Pitch

OpenPilot is a self-hosted web application that turns a single GitHub Copilot subscription into a fully-featured AI platform: a chat interface, an autonomous multi-agent coding engine, and an OpenAI-compatible REST API — all running in two Docker containers on your own machine.

---

## The Core Insight

GitHub Copilot's API (`api.githubcopilot.com`) is a full OpenAI-compatible endpoint that accepts the same chat-completions format as OpenAI, supports streaming, vision, tool calling, and hosts every major model from GPT-5 to Claude Opus to Gemini. OpenPilot bridges the gap between that raw API and a user-friendly interface by handling the authentication dance that the Copilot extension normally hides from you.

---

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser                                                            │
│  Next.js React SPA  (AppShell, ChatBox, AgentWorkspace, Dashboard)  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTP / SSE
┌──────────────────────────────▼──────────────────────────────────────┐
│  Docker container: web  (port 3000)                                 │
│  Next.js App Router (Node.js)                                       │
│  • /api/agents/step   — orchestration bridge                        │
│  • /api/exec/run      — executes shell commands in code-server       │
│  • /v1/chat/completions — OpenAI-compatible public API              │
│  • /v1/models           — model list                                │
│  • Prisma + SQLite    — api keys, jobs, conversations, backups       │
└────────────────┬───────────────────────────┬────────────────────────┘
                 │                           │
    Docker volume: copilot-auth         Docker socket
    (hosts.json)                        (container mgmt)
                 │                           │
┌────────────────▼───────────────────────────▼────────────────────────┐
│  Docker container: code-server  (port 8080)                         │
│  VS Code in the browser (code-server)                               │
│  • GitHub Copilot extension — authenticated via shared volume       │
│  • copilot-bridge extension — HTTP server on :3001 (vscode.lm API)  │
│  • Worker agent workspace — files, builds, test runs land here      │
└─────────────────────────────────────────────────────────────────────┘
                 │
    ┌────────────▼──────────────┐
    │  api.githubcopilot.com    │
    │  Bearer token, ~30 min    │
    └───────────────────────────┘
```

---

## How the VS Code Sign-In Works

This is the most technically interesting piece. GitHub Copilot's VS Code extension stores its OAuth credentials in a file called `hosts.json` inside VS Code's `globalStorage` for the extension — a plain JSON file on disk. OpenPilot exploits this fact entirely.

### The token file format

```json
{ "github.com": { "user": "your-username", "oauth_token": "gho_..." } }
```

The Copilot extension reads this file on startup. Write the right token there, restart the process, and it considers itself signed in.

### Device authorization flow (recommended)

OpenPilot uses GitHub's OAuth Device Flow with the Copilot extension's own public client ID (`Iv1.b507a08c87ecfe98`):

1. **Start** — `POST /api/setup-vscode` calls `startCopilotDeviceFlow()` which hits `https://github.com/login/device/code` with the Copilot client ID and requests the `copilot user:email gist` scopes.
2. **Display** — GitHub returns a `user_code` (e.g. `ABCD-1234`) and a verification URL. The UI shows a modal with this code and a link to `github.com/login/device`.
3. **Poll** — The server calls `POST /api/setup-vscode/poll` on an interval, each time calling `https://github.com/login/oauth/access_token` with the `device_code`. The response is `authorization_pending` until the user approves.
4. **Authorized** — Once approved, GitHub returns a `gho_...` OAuth token. The server calls `injectCopilotToken()`, which:
   - Writes `hosts.json` into the `copilot-auth` Docker named volume
   - Calls the Docker socket (`/var/run/docker.sock`) to restart the `code-server` container
5. **Pickup** — code-server restarts, the Copilot extension finds the populated `hosts.json` in its `globalStorage` directory (the volume is mounted there), and considers itself fully authenticated.

The `copilot-auth` volume is simultaneously mounted into both containers:
- In `web`: at `/copilot-auth/hosts.json` (write path)
- In `code-server`: at `/home/coder/.local/share/code-server/User/globalStorage/github.copilot/` (read path for the extension)

### GitHub OAuth flow (alternative)

Users can also sign in with the GitHub OAuth button on the app's login page. NextAuth.js handles the standard OAuth callback and provides the GitHub access token via `session.accessToken`. This token goes through the same `injectCopilotToken()` path.

---

## How Copilot API Calls Are Made

Once signed in, **no VS Code is involved at runtime** for the actual AI calls. The Copilot token exchange works like this:

1. The `web` container reads `hosts.json` from the shared volume and extracts the `oauth_token`.
2. It POSTs to `https://api.github.com/copilot_internal/v2/token` with that OAuth token to get a short-lived **Copilot Bearer token** (valid ~30 minutes).
3. All subsequent calls to `https://api.githubcopilot.com/chat/completions` use this Bearer token, with VS Code user-agent headers to ensure the API accepts the request.
4. The token is cached in-process and refreshed automatically when it expires.

```
oauth_token (from hosts.json, lives on disk)
   → POST /copilot_internal/v2/token
   → Copilot Bearer token (in-memory cache, ~30 min TTL)
   → POST api.githubcopilot.com/chat/completions
```

This is the same token exchange the official VS Code Copilot extension performs internally — OpenPilot just does it server-side so any HTTP client can use it.

---

## The copilot-bridge Extension

The `copilot-bridge` directory contains a minimal VS Code extension that runs **inside the code-server container** and exposes the `vscode.lm` Language Model API over HTTP on port 3001. This was the original approach before direct API access was established — it's still active and used for workspace-level operations.

```javascript
// code-server container, port 3001
POST /chat  →  vscode.lm.selectChatModels()
              → model.sendRequest(messages)
              → streams response back
```

The extension calls `vscode.lm.selectChatModels({ vendor: 'copilot' })` which returns the models the authenticated Copilot extension has access to. This means the code-server container has a genuine Copilot context, capable of running completions, inline suggestions, and the full VS Code AI API surface inside the worker's workspace.

---

## The Agent Orchestration Loop

The Auto Pilot feature runs a **Worker ↔ Manager** loop where two AI instances collaborate:

- **Manager** reads your specification, breaks it into tasks, reviews output, and assigns corrections
- **Worker** implements tasks, writes files, runs shell commands, and reports back

### How a single step executes

1. The browser holds all run state (conversation histories, log, status) in React component state, persisted to `localStorage`.
2. The user clicks Start or Resume. The client sends `POST /api/agents/step` with the full conversation history for the current agent (worker or manager) plus the model ID.
3. `/api/agents/step` calls `api.githubcopilot.com/chat/completions` and returns the assistant reply as a plain string.
4. The client's `parseTokens()` function scans the reply for structured tokens:
   - `[NEXT_TASK: ...]` — manager assigned a task; feed it into the worker's next turn
   - `[EXEC: command]` — worker wants to run a shell command; POST to `/api/exec/run`
   - `[DONE]` — worker finished the task; trigger manager review
   - `[CORRECTION: ...]` — manager is requesting changes; re-enter worker
   - `[COMPLETE]` — manager confirms everything is done; mark run complete
   - `[SERVE: command]` — worker has a preview server ready; unlock the Preview button
5. `[EXEC:]` commands are sent to `POST /api/exec/run` which runs them inside the code-server container via Docker exec (`docker exec code-server bash -c "..."`). Output streams back and is appended to the worker's next message.
6. If the Monitor is enabled, every N iterations the monitor model analyzes recent log entries and posts findings (errors, warnings, suggestions) in the right-hand panel.
7. Workspace checkpoints are saved automatically after each successful `[EXEC:]` by snapshotting the container filesystem, restorable from the Checkpoints panel.

### Crash recovery

When the server restarts mid-run, all agent runs stored in `localStorage` with `status === 'running'` are automatically transitioned to `status === 'paused'` on next page load with a "Run was interrupted — auto-resuming…" status message. The user can resume from exactly where it stopped.

---

## The Frontend UI Wrapper

The entire frontend is a **Next.js App Router** application, but it behaves like a single-page application:

- `app/layout.tsx` wraps everything in `SessionProvider` (NextAuth) and `ThemeProvider` (dark mode).
- `app/page.tsx` uses `dynamic(() => import('../components/AppShell'), { ssr: false })` to load the shell entirely client-side, avoiding any server-side rendering for the interactive UI.
- **`AppShell.tsx`** is the root component. It owns all top-level state:
  - `activeTab` — which panel is showing (dashboard, chat, autopilot, docs, api-keys)
  - `conversations` — chat history array, persisted to `localStorage`
  - `agentRuns` — agent run array, persisted to `localStorage`
  - `activeId` / `activeRunId` — which conversation or run is selected
- The **Sidebar** renders the navigation tabs and a list of conversations/runs. Clicking a conversation calls `handleSelect(id)` which sets `activeId` and switches to the chat tab — the same handler the Dashboard uses when you click a "Recent Conversations" row.
- **ChatBox** manages a single conversation including streaming AI responses (rendered token-by-token via the ReadableStream from `/api/chat`).
- **AgentWorkspace** is a fully self-contained component that manages a single agent run's UI: the two agent panels (worker left, manager right), the monitor sidebar, the checkpoints sidebar, the inject bar, and all the run control buttons.

---

## The OpenAI-Compatible Public API

OpenPilot exposes `http://localhost:3000/v1` as an OpenAI drop-in replacement. Any client that works with the OpenAI Python SDK, TypeScript SDK, or raw HTTP can point at it.

### Authentication

Each app key is created in the API Keys tab. The raw key (`opk_` + 48 hex chars) is shown once, then SHA-256 hashed and stored in SQLite. Every API request hashes the incoming key and looks it up. Each key has a **configured model** — the `model` field in the request body is ignored, so different keys can be locked to different models.

### Request flow for `POST /v1/chat/completions`

```
Client request (opk_... key)
   → SHA-256 hash → lookup in SQLite → validate enabled
   → Extract messages, stream flag, tools, response_format, etc.
   → getCopilotToken() (cached, auto-refreshed)
   → POST api.githubcopilot.com/chat/completions
   → If stream=true: pipe SSE byte stream directly to client
   → If stream=false: proxy full JSON response (handles tool_calls too)
   → Fire-and-forget: increment usageCount + update lastUsedAt in SQLite
```

Supported parameters forwarded to Copilot: `tools`, `tool_choice`, `response_format` (JSON mode + JSON schema), `temperature`, `top_p`, `max_tokens`, `stop`, `seed`, `n`.

`GET /v1/models` returns the live model list from Copilot in OpenAI's `{"object":"list","data":[...]}` format.

---

## Data Storage

All persistent data lives in a SQLite database at `/data/openpilot.db` (a Docker named volume), managed by Prisma:

| Table | Contents |
|---|---|
| `ApiKey` | Name, SHA-256 key hash, prefix for display, model, enabled flag, usage count, timestamps |
| `Conversation` (future) | Reserved |

Agent runs and chat conversations are stored entirely in the **browser's `localStorage`** — they never touch the server. This is intentional: runs can contain megabytes of code output, and keeping them on the client avoids any server-side storage limits while making the app work even without a database.

The SQLite file can be exported as a `.db` backup from the profile menu (bottom-left) and re-imported — useful when migrating to a new server.

---

## Legacy: Browser Automation (Removed)

Early versions of OpenPilot included a Playwright-based approach to interacting with code-server. That layer has been fully replaced by direct API calls, but artifacts remain in the codebase.

### What existed

`services/codeServerSetup.ts` contains a `triggerCopilotSignIn()` function that used `chromium.launch()` to headlessly open the code-server browser UI, fill the password, navigate to the Extensions panel, and click the "Sign in to GitHub" button in the Copilot extension. This was fragile — it relied on VS Code DOM selectors that changed with each release.

### Why it was replaced

The device authorization flow (`copilotDeviceFlow.ts`) achieves the same result without any browser automation: it exchanges a GitHub device code directly through GitHub's API and writes the resulting token to `hosts.json`. No DOM, no selectors, no Playwright process spawning inside the container.

### Current state of those files

| File | Status | Notes |
|---|---|---|
| `services/codeServerSetup.ts` | **Dead code** | `triggerCopilotSignIn()` is tagged `@deprecated`, nothing calls it. `injectCopilotToken()` in the same file is still active (writes `hosts.json` + restarts container). Playwright is still in `package.json` solely because this file imports `chromium`. |
| `services/codeServerAutomation.ts` | **Misleadingly named** | `sendToCodeServerChatBox()` was once the Playwright function that typed into the chat box. It was refactored in-place to be a plain HTTP call to the Copilot API. The name is legacy; the implementation is a direct `fetch()`. |
| `services/vscodeService.ts` | **Stub** | `sendVSCodeCommand()` returns a hardcoded fake response (`"Executed command: ..."`). It is not connected to code-server. Placeholder for a future VS Code command API integration. |
| `services/codeServerClient.ts` | **Stub** | `sendCopilotRequest()` echoes back the input. `getCodeServerCookie()` is a real login function but is not called by any current flow. |

### What actually runs today

All AI calls go through one of two paths — neither involves browser automation:

1. **Direct Copilot API** (`getCopilotToken()` → `api.githubcopilot.com`) — used by chat, agents, the public `/v1` API, and `sendToCodeServerChatBox()` (despite the name).
2. **copilot-bridge HTTP server** (`:3001` inside code-server container) — uses `vscode.lm` API inside the VS Code process, available after the Copilot extension is authenticated via the shared volume.

---

## Running It

```bash
cd docker
docker compose up -d
```

Then open `http://localhost:3000`. On first boot the app walks you through:
1. Setting up GitHub OAuth credentials for sign-in (or using the Copilot device flow directly)
2. Authorizing Copilot access — the device code modal handles this end-to-end

No external accounts, no cloud services, no telemetry. Everything runs on your machine using your Copilot subscription.
