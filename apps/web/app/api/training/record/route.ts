import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { AgentRun } from '@/services/agentOrchestrator';

interface RecordBody {
  run: AgentRun;
  tokenPromptTotal: number;
  tokenCompletionTotal: number;
  monitorFindings: string;
}

/**
 * POST /api/training/record
 * Creates an AgentRunRecord from a completed AgentRun for benchmarking and self-training.
 * Returns { ok, id } with the new record's UUID so the caller can POST to /api/training/score.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json() as RecordBody;
    const { run, tokenPromptTotal, tokenCompletionTotal, monitorFindings } = body;

    if (!run?.id || !run?.config?.category) {
      return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
    }

    // Count corrections from the run log
    const correctionCount = run.log.filter(e => e.type === 'correction').length;

    const record = await prisma.agentRunRecord.create({
      data: {
        personalityId:        run.config.category,
        title:                run.title,
        spec:                 run.spec,
        status:               run.status,
        iterationCount:       run.currentIteration,
        correctionCount,
        tokenPromptTotal:     tokenPromptTotal,
        tokenCompletionTotal: tokenCompletionTotal,
        monitorFindings:      monitorFindings ?? '[]',
        workerHistory:        JSON.stringify(run.workerHistory),
        managerHistory:       JSON.stringify(run.managerHistory),
        createdAt:            BigInt(run.createdAt),
        completedAt:          BigInt(Date.now()),
      },
    });

    return NextResponse.json({ ok: true, id: record.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
