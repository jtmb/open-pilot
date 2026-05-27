// instrumentation.ts — runs once when the Next.js server starts
// Used to kick off background services (auto-backup timer, training sweep).

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Only run in the Node.js runtime, not in the edge runtime
    const { startAutoBackup }    = await import('./services/backupService');
    const { startTrainingSweep } = await import('./services/trainingService');
    startAutoBackup();
    startTrainingSweep();
  }
}
