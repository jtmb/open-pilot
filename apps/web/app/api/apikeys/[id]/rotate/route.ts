// POST /api/apikeys/[id]/rotate — generate a new secret for an existing key
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { randomBytes, createHash } from 'crypto';

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const rawKey = 'opk_' + randomBytes(24).toString('hex');
    const keyHash = hashKey(rawKey);
    const keyPrefix = rawKey.slice(0, 12) + '…';

    const key = await prisma.apiKey.update({
      where: { id: params.id },
      data: { keyHash, keyPrefix },
    });

    return NextResponse.json({
      key: { ...key, createdAt: Number(key.createdAt), lastUsedAt: key.lastUsedAt != null ? Number(key.lastUsedAt) : null },
      rawKey, // shown once only
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
