import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Message } from '@/components/ChatBox';

// GET /api/conversations — list all (metadata only, no messages)
export async function GET() {
  try {
    const rows = await prisma.conversation.findMany({
      select: { id: true, title: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    // Convert BigInt to number for JSON serialisation
    const conversations = rows.map(r => ({
      id: r.id,
      title: r.title,
      createdAt: Number(r.createdAt),
      messages: [] as Message[],
    }));
    return NextResponse.json({ conversations });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/conversations — create
export async function POST(req: NextRequest) {
  try {
    const { id, title, createdAt, messages = [] } = await req.json() as {
      id: string;
      title: string;
      createdAt: number;
      messages?: Message[];
    };

    const row = await prisma.conversation.create({
      data: {
        id,
        title,
        createdAt: BigInt(createdAt),
        updatedAt: BigInt(Date.now()),
        messages: JSON.stringify(messages),
      },
    });

    return NextResponse.json({
      conversation: {
        id: row.id,
        title: row.title,
        createdAt: Number(row.createdAt),
        messages,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
