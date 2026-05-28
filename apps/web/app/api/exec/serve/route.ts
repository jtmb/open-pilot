// app/api/exec/serve/route.ts
// POST  — start a preview server in the code-server container
// DELETE — stop the preview server

import { NextRequest, NextResponse } from 'next/server';
import { startPreviewServer, stopPreviewServer, getRunPort } from '@/services/dockerExec';

interface ServeRequestBody {
  command: string;
  runId:   string;
}

export async function POST(req: NextRequest) {
  let body: ServeRequestBody;
  try {
    body = await req.json() as ServeRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { command, runId } = body;

  if (!command || typeof command !== 'string' || command.trim().length === 0) {
    return NextResponse.json({ error: 'command is required' }, { status: 400 });
  }
  if (!runId || typeof runId !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(runId)) {
    return NextResponse.json({ error: 'invalid runId' }, { status: 400 });
  }
  if (command.length > 4096) {
    return NextResponse.json({ error: 'command too long' }, { status: 400 });
  }

  try {
    await startPreviewServer(runId, command.trim());
    // Use the port actually allocated to this run (may differ from 4000 if
    // other runs are already using lower-numbered ports in the pool).
    const allocatedPort = getRunPort(runId) ?? 4000;
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost';
    const protocol = req.headers.get('x-forwarded-proto') ?? 'http';
    const hostname = host.split(':')[0];
    return NextResponse.json({ url: `${protocol}://${hostname}:${allocatedPort}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  let body: { runId: string };
  try {
    body = await req.json() as { runId: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { runId } = body;
  if (!runId || typeof runId !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(runId)) {
    return NextResponse.json({ error: 'invalid runId' }, { status: 400 });
  }

  try {
    await stopPreviewServer(runId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
