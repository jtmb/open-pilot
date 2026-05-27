import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import fs from 'fs/promises';

/** Returns whether an ACCESS_PASSWORD gate is active. */
export async function GET() {
  const configured = !!(process.env.ACCESS_PASSWORD && process.env.ACCESS_PASSWORD.length > 0);
  return NextResponse.json({ requiresPassword: configured });
}

/** Validates the supplied password against ACCESS_PASSWORD using constant-time comparison. */
export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({ password: '' }));
  const expected = process.env.ACCESS_PASSWORD ?? '';

  if (!expected) {
    // No password configured — always allow
    return NextResponse.json({ ok: true });
  }

  if (!password) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Constant-time comparison to prevent timing attacks
  try {
    const a = Buffer.from(password as string, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    const match = a.length === b.length && timingSafeEqual(a, b);
    if (match) {
      return NextResponse.json({ ok: true });
    }
  } catch {
    // Length mismatch fallthrough
  }

  return NextResponse.json({ ok: false }, { status: 401 });
}

/** Set or clear the ACCESS_PASSWORD — takes effect immediately without restart. */
export async function PATCH(req: NextRequest) {
  const { password } = await req.json().catch(() => ({ password: '' }));

  // Update process.env immediately
  if (password && password.length > 0) {
    process.env.ACCESS_PASSWORD = password as string;
  } else {
    delete process.env.ACCESS_PASSWORD;
  }

  // Persist to /.env (mounted from host) so it survives container restarts
  try {
    const newPassword = (password as string | undefined) ?? '';
    const lines: string[] = [
      `NEXTAUTH_SECRET=${process.env.NEXTAUTH_SECRET ?? ''}`,
      `GITHUB_ID=${process.env.GITHUB_ID ?? ''}`,
      `GITHUB_SECRET=${process.env.GITHUB_SECRET ?? ''}`,
      `CODE_SERVER_URL=${process.env.CODE_SERVER_URL ?? 'http://code-server:8080'}`,
      `CODE_SERVER_PASSWORD=${process.env.CODE_SERVER_PASSWORD ?? 'changeme'}`,
    ];
    if (newPassword.length > 0) {
      lines.push(`ACCESS_PASSWORD=${newPassword}`);
    }
    await fs.writeFile('/.env', lines.join('\n') + '\n', 'utf8');
  } catch (e) {
    console.warn('Could not persist ACCESS_PASSWORD to /.env:', (e as Error).message);
  }

  return NextResponse.json({ ok: true });
}
