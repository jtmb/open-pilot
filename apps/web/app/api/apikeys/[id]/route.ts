// DELETE /api/apikeys/[id] — delete a key
// PATCH  /api/apikeys/[id] — update name / enabled / model
// POST   /api/apikeys/[id]/rotate — rotate secret
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { randomBytes, createHash } from 'crypto';

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await prisma.apiKey.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json() as { name?: string; enabled?: boolean; model?: string };
    const data: Record<string, unknown> = {};
    if (typeof body.name    === 'string')  data.name    = body.name.trim().slice(0, 80);
    if (typeof body.enabled === 'boolean') data.enabled = body.enabled;
    if (typeof body.model   === 'string') {
      if (!/^[\w.\-]+$/.test(body.model)) {
        return NextResponse.json({ error: 'Invalid model identifier' }, { status: 400 });
      }
      data.model = body.model;
    }
    const key = await prisma.apiKey.update({ where: { id: params.id }, data });
    return NextResponse.json({
      key: { ...key, createdAt: Number(key.createdAt), lastUsedAt: key.lastUsedAt != null ? Number(key.lastUsedAt) : null },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
