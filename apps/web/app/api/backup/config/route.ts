// GET/POST /api/backup/config — read or update the auto-backup configuration
import { NextRequest, NextResponse } from 'next/server';
import { getAutoBackupConfig, setAutoBackupConfig } from '@/services/backupService';

export async function GET() {
  return NextResponse.json(getAutoBackupConfig());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { enabled?: boolean; intervalHours?: number };
    const updated = setAutoBackupConfig(body);
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
