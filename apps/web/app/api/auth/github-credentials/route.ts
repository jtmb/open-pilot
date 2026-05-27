import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';

// GET: check if credentials are already configured
export async function GET() {
  const hasCredentials = !!(process.env.GITHUB_ID && process.env.GITHUB_ID !== 'replace_with_your_github_client_id');
  return NextResponse.json({ hasCredentials });
}

// POST: save GitHub OAuth credentials
export async function POST(req: NextRequest) {
  const { clientId, clientSecret } = await req.json();
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
  }

  // Update process.env immediately so NextAuth picks up new creds without restart
  process.env.GITHUB_ID = clientId;
  process.env.GITHUB_SECRET = clientSecret;

  // Persist to /.env (mounted from host) so they survive container restarts
  try {
    const envLines = [
      `NEXTAUTH_SECRET=${process.env.NEXTAUTH_SECRET || 'changeme-replace-with-random-secret'}`,
      `GITHUB_ID=${clientId}`,
      `GITHUB_SECRET=${clientSecret}`,
      `CODE_SERVER_URL=${process.env.CODE_SERVER_URL || 'http://code-server:8080'}`,
      `CODE_SERVER_PASSWORD=${process.env.CODE_SERVER_PASSWORD || 'changeme'}`,
    ];
    await fs.writeFile('/.env', envLines.join('\n') + '\n', 'utf8');
  } catch (e) {
    // Non-fatal: credentials are already updated in process.env
    console.warn('Could not persist credentials to /.env:', (e as Error).message);
  }

  return NextResponse.json({ ok: true });
}
