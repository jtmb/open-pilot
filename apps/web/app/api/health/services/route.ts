// GET /api/health/services?runId=<id>
// Returns { ok, db, codeServer, workspace } for pre-flight checks before
// resuming an agent run.
//   db         — DB reachable (Prisma SELECT 1)
//   codeServer — code-server container findable + exec works
//   workspace  — workspace dir exists for the given runId (null if no runId given)

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { runInContainer } from '@/services/dockerExec';

const TIMEOUT_MS = 4_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms),
    ),
  ]);
}

export async function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get('runId') ?? null;

  // ── DB check ──────────────────────────────────────────────────────────────
  let db = false;
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, TIMEOUT_MS);
    db = true;
  } catch { /* unreachable or timed out */ }

  // ── code-server check ─────────────────────────────────────────────────────
  // Run a trivial command — if the container is gone or Docker socket is
  // unavailable this will throw.
  let codeServer = false;
  try {
    const result = await withTimeout(
      runInContainer('echo ok', '/home/coder', TIMEOUT_MS),
      TIMEOUT_MS + 500,
    );
    codeServer = result.output.trim() === 'ok';
  } catch { /* container not found or exec failed */ }

  // ── Workspace check ───────────────────────────────────────────────────────
  let workspace: boolean | null = null;
  if (runId && /^[a-zA-Z0-9_\-]+$/.test(runId) && codeServer) {
    try {
      const result = await withTimeout(
        runInContainer(
          `test -d '/home/coder/workspace/${runId}' && echo exists || echo missing`,
          '/home/coder',
          TIMEOUT_MS,
        ),
        TIMEOUT_MS + 500,
      );
      workspace = result.output.trim() === 'exists';
    } catch { workspace = false; }
  }

  const ok = db && codeServer && workspace !== false;
  return NextResponse.json({ ok, db, codeServer, workspace });
}
