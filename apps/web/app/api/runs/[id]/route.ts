import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { AgentRun } from '@/services/agentOrchestrator';

type Params = { params: Promise<{ id: string }> };

// PATCH /api/runs/[id] — update run state
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const run = await req.json() as AgentRun;
    await prisma.agentRunState.upsert({
      where: { id },
      update: {
        state: JSON.stringify(run),
        updatedAt: BigInt(run.updatedAt),
      },
      create: {
        id,
        state: JSON.stringify(run),
        createdAt: BigInt(run.createdAt),
        updatedAt: BigInt(run.updatedAt),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// DELETE /api/runs/[id] — delete run state
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    await prisma.agentRunState.delete({ where: { id } }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
