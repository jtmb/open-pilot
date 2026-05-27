import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Message } from '@/components/ChatBox';

type Params = { params: Promise<{ id: string }> };

// GET /api/conversations/[id] — full conversation including messages
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const row = await prisma.conversation.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({
      conversation: {
        id: row.id,
        title: row.title,
        createdAt: Number(row.createdAt),
        messages: JSON.parse(row.messages) as Message[],
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// PATCH /api/conversations/[id] — update title and/or messages
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = await req.json() as { title?: string; messages?: Message[] };

    const data: { title?: string; messages?: string; updatedAt: bigint } = {
      updatedAt: BigInt(Date.now()),
    };
    if (body.title !== undefined) data.title = body.title;
    if (body.messages !== undefined) data.messages = JSON.stringify(body.messages);

    const row = await prisma.conversation.update({ where: { id }, data });

    return NextResponse.json({
      conversation: {
        id: row.id,
        title: row.title,
        createdAt: Number(row.createdAt),
        messages: JSON.parse(row.messages) as Message[],
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// DELETE /api/conversations/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    await prisma.conversation.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
