// DELETE /api/github/delete-repo
// Deletes a GitHub repository on behalf of the authenticated user.

import { NextRequest, NextResponse } from 'next/server';

interface Body {
  repoUrl: string;
  accessToken: string;
}

/** Parse "owner/repo" from a github.com URL */
function parseOwnerRepo(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    if (u.hostname !== 'github.com') return null;
    const parts = u.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}

export async function DELETE(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { repoUrl, accessToken } = body;

  if (!accessToken || typeof accessToken !== 'string') {
    return NextResponse.json({ error: 'accessToken is required' }, { status: 401 });
  }

  const parsed = parseOwnerRepo(repoUrl ?? '');
  if (!parsed) {
    return NextResponse.json({ error: 'Invalid GitHub repo URL' }, { status: 400 });
  }

  const { owner, repo } = parsed;

  const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'OpenPilot',
    },
  });

  if (res.status === 204) {
    return NextResponse.json({ ok: true });
  }
  if (res.status === 404) {
    // Already gone — treat as success
    return NextResponse.json({ ok: true });
  }

  const txt = await res.text();
  return NextResponse.json({ error: `GitHub API error ${res.status}: ${txt.slice(0, 300)}` }, { status: 502 });
}
