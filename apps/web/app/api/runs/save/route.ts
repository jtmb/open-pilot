import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { type AgentRun } from '@/services/agentOrchestrator';

interface SavePayload {
  run: AgentRun;
  tokenPromptTotal: number;
  tokenCompletionTotal: number;
  monitorFindings: string;
}

export async function POST(req: NextRequest) {
  try {
    const { run, tokenPromptTotal, tokenCompletionTotal, monitorFindings } =
      await req.json() as SavePayload;

    if (!run?.id || !run?.title) {
      return NextResponse.json({ error: 'Invalid run payload' }, { status: 400 });
    }

    const correctionCount = run.log.filter(e => e.type === 'correction').length;

    const record = await prisma.agentRunRecord.upsert({
      where: { id: run.id },
      update: {
        status:               run.status,
        iterationCount:       run.currentIteration,
        correctionCount,
        tokenPromptTotal,
        tokenCompletionTotal,
        monitorFindings:      typeof monitorFindings === 'string' ? monitorFindings : JSON.stringify(monitorFindings ?? []),
        workerHistory:        JSON.stringify(run.workerHistory),
        managerHistory:       JSON.stringify(run.managerHistory),
        completedAt:          BigInt(Date.now()),
      },
      create: {
        id:                   run.id,
        personalityId:        run.config.category ?? 'developer',
        title:                run.title,
        spec:                 run.spec,
        status:               run.status,
        iterationCount:       run.currentIteration,
        correctionCount,
        tokenPromptTotal,
        tokenCompletionTotal,
        monitorFindings:      typeof monitorFindings === 'string' ? monitorFindings : JSON.stringify(monitorFindings ?? []),
        workerHistory:        JSON.stringify(run.workerHistory),
        managerHistory:       JSON.stringify(run.managerHistory),
        createdAt:            BigInt(run.createdAt),
        completedAt:          BigInt(Date.now()),
      },
    });

    return NextResponse.json({ ok: true, id: record.id });
  } catch (err) {
    console.error('[runs/save]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
