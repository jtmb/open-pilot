// GET /api/apikeys — list all API keys (hashes not exposed)
// POST /api/apikeys — create a new API key
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { randomBytes, createHash } from 'crypto';

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export async function GET() {
  try {
    const keys = await prisma.apiKey.findMany({
      select: { id: true, name: true, keyPrefix: true, model: true, enabled: true, createdAt: true, lastUsedAt: true, usageCount: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({
      keys: keys.map(k => ({
        ...k,
        createdAt: Number(k.createdAt),
        lastUsedAt: k.lastUsedAt != null ? Number(k.lastUsedAt) : null,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name, model = 'gpt-4o' } = await req.json() as { name?: string; model?: string };
    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    // Validate model is a simple alphanumeric/dash/dot string
    if (!/^[\w.\-]+$/.test(model)) {
      return NextResponse.json({ error: 'Invalid model identifier' }, { status: 400 });
    }

    const rawKey = 'opk_' + randomBytes(24).toString('hex');
    const keyHash = hashKey(rawKey);
    const keyPrefix = rawKey.slice(0, 12) + '…';

    const key = await prisma.apiKey.create({
      data: {
        id: randomBytes(8).toString('hex'),
        name: name.trim().slice(0, 80),
        keyHash,
        keyPrefix,
        model,
        enabled: true,
        createdAt: BigInt(Date.now()),
      },
    });

    return NextResponse.json({
      key: {
        id: key.id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        model: key.model,
        enabled: key.enabled,
        createdAt: Number(key.createdAt),
        lastUsedAt: null,
      },
      rawKey, // shown once only
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
