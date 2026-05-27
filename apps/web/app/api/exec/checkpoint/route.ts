// POST /api/exec/checkpoint
// Creates a git commit in the run's workspace and returns the commit SHA.
// The workspace must already exist. Git is initialised if not already done.

import { NextRequest, NextResponse } from 'next/server';
import { runInContainer } from '@/services/dockerExec';

interface CheckpointBody {
  runId: string;
  label: string;
}

export async function POST(req: NextRequest) {
  let body: CheckpointBody;
  try {
    body = (await req.json()) as CheckpointBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { runId, label } = body;

  if (!runId || typeof runId !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(runId)) {
    return NextResponse.json({ error: 'invalid runId' }, { status: 400 });
  }
  if (!label || typeof label !== 'string') {
    return NextResponse.json({ error: 'label is required' }, { status: 400 });
  }

  // Sanitise label for use in a git commit message
  const safeLabel = label.replace(/'/g, '').slice(0, 120);
  const workspaceDir = `/home/coder/workspace/${runId}`;

  try {
    // Idempotent git init, configure identity, stage all, commit.
    // || true on commit so an empty tree (nothing changed) doesn't fail the request.
    const cmd = [
      `git -C '${workspaceDir}' init --quiet 2>/dev/null`,
      `git -C '${workspaceDir}' config user.email "agent@openpilot" 2>/dev/null`,
      `git -C '${workspaceDir}' config user.name "Agent" 2>/dev/null`,
      `git -C '${workspaceDir}' add -A`,
      `git -C '${workspaceDir}' commit --allow-empty -m '${safeLabel}' 2>&1`,
    ].join(' && ');

    const result = await runInContainer(cmd, '/home/coder', 30_000);

    if (result.exitCode !== 0) {
      return NextResponse.json(
        { error: `git commit failed: ${result.output.slice(0, 300)}` },
        { status: 500 },
      );
    }

    // Extract the short SHA from git output ("main (root-commit) abc1234]" or "[main abc1234]")
    const shaMatch = result.output.match(/\[(?:[^\]]*)\s([0-9a-f]{7,40})\]/);
    if (shaMatch) {
      return NextResponse.json({ commitHash: shaMatch[1] });
    }

    // Fallback: ask git directly for HEAD
    const headRes = await runInContainer(
      `git -C '${workspaceDir}' rev-parse HEAD`,
      '/home/coder',
      5_000,
    );
    const commitHash = headRes.output.trim();
    if (!/^[0-9a-f]{7,40}$/.test(commitHash)) {
      return NextResponse.json({ error: 'could not resolve HEAD sha' }, { status: 500 });
    }

    return NextResponse.json({ commitHash });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
