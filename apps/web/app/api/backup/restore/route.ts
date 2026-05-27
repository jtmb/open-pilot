// POST /api/backup/restore — restore the live database from a named auto-backup
import { NextRequest, NextResponse } from 'next/server';
import { getBackupPath, restoreBackup } from '@/services/backupService';
import fs from 'fs';

export async function POST(req: NextRequest) {
  try {
    const { filename } = await req.json() as { filename?: string };
    if (!filename || typeof filename !== 'string') {
      return NextResponse.json({ error: 'filename is required' }, { status: 400 });
    }

    // Validate the file exists and is a legitimate backup (path traversal is handled inside getBackupPath)
    const backupPath = getBackupPath(filename);
    if (!fs.existsSync(backupPath)) {
      return NextResponse.json({ error: 'Backup file not found' }, { status: 404 });
    }

    await restoreBackup(filename);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
