// POST /api/backup/trigger — immediately create a backup on demand
import { NextResponse } from 'next/server';
import { backupDatabase } from '@/services/backupService';

export async function POST() {
  try {
    const info = backupDatabase();
    return NextResponse.json({ ok: true, backup: info });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
