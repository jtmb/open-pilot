/**
 * Training Service
 *
 * Runs periodic quality scoring across AgentRunRecords that lack a summary.
 * Imported by instrumentation.ts so it starts automatically on the Node.js
 * runtime alongside the backup auto-timer.
 */

let sweepTimer: ReturnType<typeof setInterval> | null = null;

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

export function startTrainingSweep() {
  if (sweepTimer) return;
  // Initial sweep 5 min after startup (gives DB time to be ready)
  const initial = setTimeout(() => void runSweep(), 5 * 60 * 1000);
  sweepTimer = setInterval(() => void runSweep(), SWEEP_INTERVAL_MS);
  // Allow process to exit without waiting for these timers
  if (typeof initial?.unref === 'function') initial.unref();
  if (typeof sweepTimer?.unref === 'function') sweepTimer.unref();
}

async function runSweep() {
  try {
    const { prisma } = await import('@/lib/prisma');

    // Find all completed/blocked runs without a quality summary
    const unscored = await prisma.agentRunRecord.findMany({
      where: {
        summary:     null,
        status:      { in: ['complete', 'blocked', 'error'] },
        completedAt: { not: null },
      },
      select: { id: true },
      take: 50,
    });

    if (unscored.length === 0) return;

    for (const { id } of unscored) {
      await scoreRun(id);
    }
  } catch (err) {
    console.error('[trainingService] sweep error:', err);
  }
}

async function scoreRun(runId: string) {
  try {
    const { prisma } = await import('@/lib/prisma');

    const run = await prisma.agentRunRecord.findUnique({ where: { id: runId } });
    if (!run) return;

    const correctionRate  = run.iterationCount > 0
      ? run.correctionCount / run.iterationCount
      : 0;

    const completionScore = run.status === 'complete' ? 1.0
                          : run.status === 'blocked'  ? 0.3
                          :                             0.0;

    const ratingBoost = run.userRating === 1 ? 0.15
                      : run.userRating === -1 ? -0.15
                      : 0;

    const qualityScore = Math.max(0, Math.min(1,
      completionScore * 0.6 +
      (1 - Math.min(correctionRate, 1)) * 0.25 +
      ratingBoost +
      0.15,
    ));

    const summary = JSON.stringify({
      status:         run.status,
      iterations:     run.iterationCount,
      corrections:    run.correctionCount,
      correctionRate: correctionRate.toFixed(3),
      qualityScore:   qualityScore.toFixed(3),
      userRating:     run.userRating,
    });

    await prisma.agentRunRecord.update({
      where: { id: runId },
      data:  { summary },
    });
  } catch (err) {
    console.error(`[trainingService] scoreRun(${runId}) error:`, err);
  }
}
