// POST /api/exec/restore
// Restores the run's workspace to a specific git commit via `git reset --hard`.

import { NextRequest, NextResponse } from 'next/server';
import { runInContainer } from '@/services/dockerExec';

interface RestoreBody {
  runId: string;
  commitHash: string;
}

export async function POST(req: NextRequest) {
  let body: RestoreBody;
  try {
    body = (await req.json()) as RestoreBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { runId, commitHash } = body;

  if (!runId || typeof runId !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(runId)) {
    return NextResponse.json({ error: 'invalid runId' }, { status: 400 });
  }
  // Accept 7-40 char hex SHA only — no other git refs to prevent injection
  if (!commitHash || typeof commitHash !== 'string' || !/^[0-9a-f]{7,40}$/.test(commitHash)) {
    return NextResponse.json({ error: 'invalid commitHash' }, { status: 400 });
  }

  const workspaceDir = `/home/coder/workspace/${runId}`;

  try {
    const result = await runInContainer(
      `git -C '${workspaceDir}' reset --hard '${commitHash}' 2>&1`,
      '/home/coder',
      30_000,
    );

    if (result.exitCode !== 0) {
      return NextResponse.json(
        { error: `git reset failed: ${result.output.slice(0, 300)}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
