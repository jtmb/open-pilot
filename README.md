# OpenPilot for VS Code

OpenPilot is a local AI agent orchestration app with a Next.js web UI, PostgreSQL, and a code-server workspace container. For development, the web app runs on the host with `npm run dev`, while the backend services run in Docker.

## Development Setup

### What runs where

- Web app: Next.js dev server on the host at `http://localhost:3000`
- Database: PostgreSQL in Docker on `localhost:5432`
- code-server: browser IDE in Docker at `http://localhost:8080`
- Copilot bridge: helper service exposed from code-server on `http://localhost:3001`
- Preview apps from agent runs: forwarded from Docker on ports `4000-4019`

### Prerequisites

- Node.js 18+ and npm
- Docker Desktop or Docker Engine with Docker Compose
- A browser that can reach `localhost:3000` and `localhost:8080`

## Quick Start

### 1. Install web dependencies

From the repo root:

```bash
cd apps/web
npm install
```

### 2. Start backend services with Docker

In a separate terminal, from the repo root:

```bash
cd docker
docker compose up -d
```

This starts:

- `postgres`
- `code-server`

To verify both containers are up:

```bash
cd docker
docker compose ps
```

### 3. Start the web app in development mode

In another terminal:

```bash
cd apps/web
npm run dev
```

The app will be available at:

- `http://localhost:3000`

## Local Environment Variables

The web app reads local development settings from `apps/web/.env.local`.

Key variables for local development:

```env
DATABASE_URL=postgresql://openpilot:changeme@localhost:5432/openpilot
CODE_SERVER_URL=http://localhost:8080
CODE_SERVER_BRIDGE_URL=http://localhost:3001
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<your-random-secret>
GITHUB_ID=<your-github-oauth-client-id>
GITHUB_SECRET=<your-github-oauth-client-secret>
ACCESS_PASSWORD=<optional>
```

Notes:

- `DATABASE_URL` points at the Docker PostgreSQL container through the host port mapping.
- `CODE_SERVER_URL` must be `http://localhost:8080` in host-based development.
- `CODE_SERVER_BRIDGE_URL` must be `http://localhost:3001` in host-based development.
- `NEXTAUTH_URL` should stay `http://localhost:3000` for local auth flows.
- `ACCESS_PASSWORD` is optional. If set, the offline sign-in path is gated by this password.

## First Run Checklist

### Open code-server once

Open:

- `http://localhost:8080`

Default password from `docker/docker-compose.yml`:

- `changeme`

This matters because the Copilot bridge on port `3001` is hosted inside code-server. Some features that open files directly in the editor work best after code-server has been opened in the browser at least once.

### Set up GitHub OAuth

Open the web app at `http://localhost:3000` and configure GitHub OAuth credentials if they are not already present.

Your GitHub OAuth app should use this callback URL:

```text
http://localhost:3000/api/auth/callback/github
```

## Day-to-Day Development Workflow

### Start everything

Terminal 1:

```bash
cd docker
docker compose up -d
```

Terminal 2:

```bash
cd apps/web
npm run dev
```

### Stop everything

Stop the Next.js dev server with `Ctrl+C`.

Then stop Docker services:

```bash
cd docker
docker compose down
```

### Restart backend only

```bash
cd docker
docker compose restart postgres code-server
```

### Rebuild code-server container after Docker changes

```bash
cd docker
docker compose build code-server
docker compose up -d code-server
```

## Useful URLs

- Web app: `http://localhost:3000`
- code-server: `http://localhost:8080`
- Copilot bridge health: `http://localhost:3001/health`

## Backend Services

### PostgreSQL

Docker Compose exposes PostgreSQL on:

- Host: `localhost:5432`
- Database: `openpilot`
- Username: `openpilot`

Data is persisted in the Docker volume:

- `postgres-data`

### code-server

code-server mounts the project into the container at:

- `/home/coder/project`

Agent workspaces are stored in the Docker volume mounted at:

- `/home/coder/workspace`

This workspace data persists across container restarts through the `code-server-workspace` volume.

## Common Development Tasks

### Run a production build check

```bash
cd apps/web
npm run build
```

### Run lint

```bash
cd apps/web
npm run lint
```

### Check container logs

```bash
cd docker
docker compose logs -f postgres
docker compose logs -f code-server
```

## Troubleshooting

### The web app loads, but Auto Pilot or file opening features do not work

Check all of the following:

- `docker compose ps` shows `postgres` and `code-server` as running
- code-server has been opened in the browser at least once
- `CODE_SERVER_URL` is `http://localhost:8080`
- `CODE_SERVER_BRIDGE_URL` is `http://localhost:3001`

### Sign-in redirects are broken

Make sure:

- `NEXTAUTH_URL=http://localhost:3000`
- your GitHub OAuth callback URL is `http://localhost:3000/api/auth/callback/github`
- you are accessing the app from `localhost:3000`, not a different hostname

### Database connection errors

Check that PostgreSQL is running:

```bash
cd docker
docker compose ps
```

Then confirm `DATABASE_URL` in `apps/web/.env.local` points to `localhost:5432`.

### Port conflicts

If ports `3000`, `5432`, `8080`, or `3001` are already in use, stop the conflicting process or container before starting the stack.

## Project Structure

```text
apps/web/     Next.js app, API routes, Prisma schema, UI components
docker/       Docker Compose and code-server image setup
```

## Summary

Local development is split intentionally:

- run the web app with `npm run dev` in `apps/web`
- run PostgreSQL and code-server with Docker Compose in `docker`

That is the supported starting development environment for this repo.
