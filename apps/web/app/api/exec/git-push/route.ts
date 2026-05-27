// POST /api/exec/git-push
// Pushes the workspace git repo to a remote (e.g. GitHub).
// The remote URL must include auth (HTTPS with token or SSH).

import { NextRequest, NextResponse } from 'next/server';
import { runInContainer } from '@/services/dockerExec';

interface PushBody {
  runId:     string;
  remoteUrl: string;
}

const WORKSPACE_ROOT = '/home/coder/workspace';

export async function POST(req: NextRequest) {
  let body: PushBody;
  try {
    body = (await req.json()) as PushBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { runId, remoteUrl } = body;

  if (!runId || !/^[a-zA-Z0-9_\-]+$/.test(runId)) {
    return NextResponse.json({ error: 'invalid runId' }, { status: 400 });
  }
  if (!remoteUrl || typeof remoteUrl !== 'string') {
    return NextResponse.json({ error: 'remoteUrl is required' }, { status: 400 });
  }
  // Basic URL sanity check — must look like a git remote
  if (!/^(https?:\/\/|git@|ssh:\/\/)/.test(remoteUrl)) {
    return NextResponse.json({ error: 'remoteUrl must be an https://, git@, or ssh:// URL' }, { status: 400 });
  }
  if (remoteUrl.length > 2048) {
    return NextResponse.json({ error: 'remoteUrl too long' }, { status: 400 });
  }

  const workspaceDir = `${WORKSPACE_ROOT}/${runId}`;
  // Escape single-quotes in remoteUrl for shell safety (replace ' with '"'"')
  const safeUrl = remoteUrl.replace(/'/g, `'"'"'`);

  const cmd = [
    // Ensure git repo exists (idempotent)
    `git -C '${workspaceDir}' init --quiet 2>/dev/null`,
    `git -C '${workspaceDir}' config user.email "agent@openpilot" 2>/dev/null`,
    `git -C '${workspaceDir}' config user.name "Agent" 2>/dev/null`,
    // Stage and commit any uncommitted changes
    `git -C '${workspaceDir}' add -A`,
    `git -C '${workspaceDir}' commit --allow-empty -m 'Open Pilot: job complete' 2>&1 || true`,
    // Set / update the remote
    `git -C '${workspaceDir}' remote remove origin 2>/dev/null; git -C '${workspaceDir}' remote add origin '${safeUrl}'`,
    // Push — create the branch if it doesn't exist yet
    `git -C '${workspaceDir}' push -u origin HEAD:main --force 2>&1`,
  ].join(' && ');

  try {
    const result = await runInContainer(cmd, '/home/coder', 60_000);
    if (result.exitCode !== 0) {
      return NextResponse.json(
        { ok: false, output: result.output.slice(0, 600) },
        { status: 200 },
      );
    }
    return NextResponse.json({ ok: true, output: result.output.slice(0, 600) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, output: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
