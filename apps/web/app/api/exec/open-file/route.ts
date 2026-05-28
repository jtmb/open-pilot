import { NextRequest, NextResponse } from 'next/server';

const BRIDGE_URL = process.env.CODE_SERVER_BRIDGE_URL ?? 'http://localhost:3001';

// POST /api/exec/open-file
// Body: { runId: string; filePath: string }
// Calls the copilot-bridge /open-file endpoint to open the file in the running
// code-server instance. Returns { ok: true } on success.
export async function POST(req: NextRequest) {
  try {
    const { runId, filePath } = await req.json() as { runId?: string; filePath?: string };
    if (!runId || !filePath) {
      return NextResponse.json({ error: 'runId and filePath are required' }, { status: 400 });
    }

    // Prevent path traversal
    if (filePath.includes('..') || filePath.startsWith('/')) {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }

    const absolutePath = `/home/coder/workspace/${runId}/${filePath}`;

    const res = await fetch(`${BRIDGE_URL}/open-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: absolutePath }),
      signal: AbortSignal.timeout(1_500),
    });

    const data = await res.json() as { ok?: boolean; error?: string };
    if (!res.ok) {
      return NextResponse.json({ error: data.error ?? 'bridge error' }, { status: res.status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
