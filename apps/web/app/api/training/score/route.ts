import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/training/score
 *
 * Computes a quality score for a single AgentRunRecord and writes it back.
 * Also triggers auto-promotion of new PersonalityVersions when sufficient data exists.
 *
 * Body: { runId: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { runId } = await req.json() as { runId: string };
    if (!runId) return NextResponse.json({ error: 'runId required' }, { status: 400 });

    const run = await prisma.agentRunRecord.findUnique({ where: { id: runId } });
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

    // ── Compute quality metrics ─────────────────────────────────────────────
    const correctionRate  = run.iterationCount > 0
      ? run.correctionCount / run.iterationCount
      : 0;

    const completionScore = run.status === 'complete' ? 1.0
                          : run.status === 'blocked'  ? 0.3
                          :                             0.0;

    const ratingBoost = run.userRating === 1 ? 0.15
                      : run.userRating === -1 ? -0.15
                      : 0;

    // Simple composite: penalise high correction rates, reward completion and user rating
    const qualityScore = Math.max(0, Math.min(1,
      completionScore * 0.6 +
      (1 - Math.min(correctionRate, 1)) * 0.25 +
      ratingBoost +
      0.15,
    ));

    // Store the summary for later meta-prompt use
    const summary = JSON.stringify({
      status:        run.status,
      iterations:    run.iterationCount,
      corrections:   run.correctionCount,
      correctionRate: correctionRate.toFixed(3),
      qualityScore:  qualityScore.toFixed(3),
      userRating:    run.userRating,
    });

    await prisma.agentRunRecord.update({
      where: { id: runId },
      data:  { summary },
    });

    // ── Check if active personality version should be promoted ──────────────
    await maybeAutoPromote(run.personalityId);

    return NextResponse.json({ ok: true, qualityScore });
  } catch (err) {
    console.error('[training/score]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * GET /api/training/score?personalityId=...
 * Returns aggregate quality stats for a personality.
 */
export async function GET(req: NextRequest) {
  try {
    const personalityId = req.nextUrl.searchParams.get('personalityId');
    if (!personalityId) {
      return NextResponse.json({ error: 'personalityId query param required' }, { status: 400 });
    }

    const runs = await prisma.agentRunRecord.findMany({
      where:   { personalityId },
      orderBy: { createdAt: 'desc' },
      take:    100,
      select: {
        id:            true,
        status:        true,
        iterationCount: true,
        correctionCount: true,
        userRating:    true,
        summary:       true,
        createdAt:     true,
        personalityVersionId: true,
      },
    });

    const total      = runs.length;
    const complete   = runs.filter(r => r.status === 'complete').length;
    const blocked    = runs.filter(r => r.status === 'blocked').length;
    const rated      = runs.filter(r => r.userRating !== null);
    const thumbsUp   = rated.filter(r => r.userRating === 1).length;
    const thumbsDown = rated.filter(r => r.userRating === -1).length;

    const avgCorrections = total > 0
      ? runs.reduce((s, r) => s + r.correctionCount, 0) / total
      : 0;

    return NextResponse.json({
      personalityId,
      total,
      complete,
      blocked,
      completionRate: total > 0 ? complete / total : 0,
      thumbsUp,
      thumbsDown,
      avgCorrections: avgCorrections.toFixed(2),
    });
  } catch (err) {
    console.error('[training/score GET]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// ── Auto-promote helper ────────────────────────────────────────────────────────
const MIN_RUNS_FOR_PROMOTION = 30;
const MIN_QUALITY_IMPROVEMENT = 0.05;

async function maybeAutoPromote(personalityId: string) {
  try {
    // Get active version
    const activeVersion = await prisma.personalityVersion.findFirst({
      where: { personalityId, isActive: true },
    });
    if (!activeVersion) return;

    // Get the next (candidate) version
    const candidateVersion = await prisma.personalityVersion.findFirst({
      where:   { personalityId, version: activeVersion.version + 1, isActive: false },
      include: { runs: { select: { summary: true, status: true } } },
    });
    if (!candidateVersion) return;
    if (candidateVersion.runs.length < MIN_RUNS_FOR_PROMOTION) return;

    // Compare quality scores between candidate and active
    const candidateRuns = await prisma.agentRunRecord.findMany({
      where:  { personalityId, personalityVersionId: candidateVersion.id },
      select: { summary: true, status: true },
      take:   MIN_RUNS_FOR_PROMOTION,
    });

    const activeRuns = await prisma.agentRunRecord.findMany({
      where:  { personalityId, personalityVersionId: activeVersion.id },
      select: { summary: true, status: true },
      take:   MIN_RUNS_FOR_PROMOTION,
      orderBy: { createdAt: 'desc' },
    });

    const avgQuality = (records: typeof candidateRuns) => {
      const scored = records
        .map(r => { try { return JSON.parse(r.summary ?? '{}').qualityScore ?? null; } catch { return null; } })
        .filter((v): v is number => v !== null);
      return scored.length > 0 ? scored.reduce((a, b) => a + b, 0) / scored.length : 0;
    };

    const candidateQuality = avgQuality(candidateRuns);
    const activeQuality    = avgQuality(activeRuns);

    if (candidateQuality - activeQuality >= MIN_QUALITY_IMPROVEMENT) {
      await prisma.$transaction([
        prisma.personalityVersion.update({
          where: { id: activeVersion.id },
          data:  { isActive: false },
        }),
        prisma.personalityVersion.update({
          where: { id: candidateVersion.id },
          data:  { isActive: true, promotedAt: BigInt(Date.now()) },
        }),
      ]);
    }
  } catch {
    // Non-critical — ignore promotion errors
  }
}
