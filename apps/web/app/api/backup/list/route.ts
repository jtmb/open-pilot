// GET /api/backup/list — list available auto-backup files
import { NextResponse } from 'next/server';
import { listBackups } from '@/services/backupService';

export async function GET() {
  try {
    const backups = listBackups();
    return NextResponse.json({ backups });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
