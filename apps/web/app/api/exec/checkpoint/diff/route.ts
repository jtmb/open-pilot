// GET /api/exec/checkpoint/diff?runId=xxx&commitHash=abc1234
// Returns unified git diff from <commitHash> to HEAD so the UI can show what
// would be lost if the user restored to that checkpoint.

import { NextRequest, NextResponse } from 'next/server';
import { runInContainer } from '@/services/dockerExec';

const WORKSPACE_ROOT = '/home/coder/workspace';
const MAX_DIFF_BYTES = 200_000; // ~200 KB safety cap

export async function GET(req: NextRequest) {
  const runId      = req.nextUrl.searchParams.get('runId');
  const commitHash = req.nextUrl.searchParams.get('commitHash');

  if (!runId || !/^[a-zA-Z0-9_\-]+$/.test(runId)) {
    return NextResponse.json({ error: 'invalid runId' }, { status: 400 });
  }
  if (!commitHash || !/^[0-9a-f]{7,40}$/.test(commitHash)) {
    return NextResponse.json({ error: 'invalid commitHash' }, { status: 400 });
  }

  const workspaceDir = `${WORKSPACE_ROOT}/${runId}`;

  try {
    const result = await runInContainer(
      `git -C '${workspaceDir}' diff ${commitHash} HEAD 2>&1`,
      '/home/coder',
      30_000,
    );
    const diff = result.output ?? '';
    const truncated = diff.length > MAX_DIFF_BYTES;
    return NextResponse.json({
      diff: truncated ? diff.slice(0, MAX_DIFF_BYTES) + '\n\n[... diff truncated ...]' : diff,
      truncated,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
