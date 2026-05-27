// app/api/exec/route.ts
// POST /api/exec
// Runs a shell command in the code-server container and optionally writes
// files to the run's workspace directory first.

import { NextRequest, NextResponse } from 'next/server';
import { runInContainer, writeFilesToContainer } from '@/services/dockerExec';

interface ExecRequestBody {
  command: string;
  runId:   string;
  files?:  Array<{ path: string; content: string }>;
}

export async function POST(req: NextRequest) {
  let body: ExecRequestBody;
  try {
    body = await req.json() as ExecRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { command, runId, files } = body;

  // Input validation
  if (!command || typeof command !== 'string' || command.trim().length === 0) {
    return NextResponse.json({ error: 'command is required' }, { status: 400 });
  }
  if (!runId || typeof runId !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(runId)) {
    return NextResponse.json({ error: 'invalid runId' }, { status: 400 });
  }
  if (command.length > 4096) {
    return NextResponse.json({ error: 'command too long' }, { status: 400 });
  }

  const workspaceDir = `/home/coder/workspace/${runId}`;

  try {
    // Write files to workspace first
    if (files && files.length > 0) {
      await writeFilesToContainer(runId, files);
    } else {
      // Ensure workspace directory exists even with no files
      await runInContainer(`mkdir -p '${workspaceDir}'`, '/home/coder', 10_000);
    }

    // Run the command in the workspace
    const result = await runInContainer(command, workspaceDir, 60_000);
    return NextResponse.json({ output: result.output, exitCode: result.exitCode });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
