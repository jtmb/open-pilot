// POST /api/github/create-and-push
// Creates a GitHub repo (if it doesn't exist) and pushes the workspace to it.
// Requires the caller to pass their GitHub OAuth access token.

import { NextRequest, NextResponse } from 'next/server';
import { runInContainer } from '@/services/dockerExec';

const WORKSPACE_ROOT = '/home/coder/workspace';

interface Body {
  runId: string;
  repoName: string;
  accessToken: string;
}

/** Derive a safe repo slug from arbitrary input */
function toSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'my-project';
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { runId, repoName, accessToken } = body;

  if (!runId || !/^[a-zA-Z0-9_-]+$/.test(runId)) {
    return NextResponse.json({ error: 'Invalid runId' }, { status: 400 });
  }
  if (!accessToken || typeof accessToken !== 'string') {
    return NextResponse.json({ error: 'accessToken is required — sign in with GitHub' }, { status: 401 });
  }

  const slug = toSlug(repoName || 'my-project');

  // 1. Get the authenticated GitHub user's login
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'OpenPilot',
    },
  });
  if (!userRes.ok) {
    const txt = await userRes.text();
    return NextResponse.json({ error: `GitHub auth failed: ${txt.slice(0, 200)}` }, { status: 401 });
  }
  const ghUser = (await userRes.json()) as { login: string };
  const login = ghUser.login;

  // 2. Create the repo (ignore 422 = already exists)
  const createRes = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'OpenPilot',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: slug,
      private: false,
      auto_init: false,
      description: 'Created by OpenPilot',
    }),
  });
  if (!createRes.ok && createRes.status !== 422) {
    const txt = await createRes.text();
    return NextResponse.json({ error: `Failed to create repo: ${txt.slice(0, 300)}` }, { status: 502 });
  }

  const repoUrl = `https://github.com/${login}/${slug}`;
  // Build push URL with embedded token (never logged)
  const pushUrl = `https://${accessToken}@github.com/${login}/${slug}.git`;
  const workspaceDir = `${WORKSPACE_ROOT}/${runId}`;
  // Escape single-quotes in pushUrl for shell safety
  const safePushUrl = pushUrl.replace(/'/g, `'"'"'`);

  const cmd = [
    `git -C '${workspaceDir}' init --quiet 2>/dev/null`,
    `git -C '${workspaceDir}' config user.email "agent@openpilot" 2>/dev/null`,
    `git -C '${workspaceDir}' config user.name "OpenPilot" 2>/dev/null`,
    `git -C '${workspaceDir}' add -A`,
    `git -C '${workspaceDir}' commit --allow-empty -m 'OpenPilot: project complete' 2>&1 || true`,
    `git -C '${workspaceDir}' remote remove origin 2>/dev/null; git -C '${workspaceDir}' remote add origin '${safePushUrl}'`,
    `git -C '${workspaceDir}' push -u origin HEAD:main --force 2>&1`,
  ].join(' && ');

  try {
    const result = await runInContainer(cmd, '/home/coder', 60_000);
    if (result.exitCode !== 0) {
      // Scrub token from output before returning
      const safeOutput = result.output.replace(new RegExp(accessToken, 'g'), '***').slice(0, 600);
      return NextResponse.json({ ok: false, error: safeOutput });
    }
    return NextResponse.json({ ok: true, repoUrl });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
