// GET /api/exec/workspace-exists?runId=<id>
// Returns { exists: boolean } — quick check whether the workspace directory
// for a run is present inside the code-server container.

import { NextRequest, NextResponse } from 'next/server';
import { runInContainer } from '@/services/dockerExec';

export async function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get('runId');
  if (!runId || !/^[a-zA-Z0-9_\-]+$/.test(runId)) {
    return NextResponse.json({ error: 'invalid runId' }, { status: 400 });
  }

  try {
    const result = await runInContainer(
      `test -d '/home/coder/workspace/${runId}' && echo exists || echo missing`,
      '/home/coder',
      8_000,
    );
    const exists = result.output.trim() === 'exists';
    return NextResponse.json({ exists });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
