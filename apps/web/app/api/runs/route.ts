import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { AgentRun } from '@/services/agentOrchestrator';

// GET /api/runs — list all runs (full state)
export async function GET() {
  try {
    const rows = await prisma.agentRunState.findMany({
      orderBy: { createdAt: 'desc' },
    });
    const runs: AgentRun[] = rows.map(r => JSON.parse(r.state) as AgentRun);
    return NextResponse.json({ runs });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/runs — create a new run
export async function POST(req: NextRequest) {
  try {
    const run = await req.json() as AgentRun;
    await prisma.agentRunState.create({
      data: {
        id: run.id,
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
