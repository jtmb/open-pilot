// GET /api/backup/export — download the current live database as JSON snapshot
import { NextResponse } from 'next/server';
import { exportDatabase } from '@/services/backupService';

export async function GET() {
  try {
    const { filename, buffer } = await exportDatabase();

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
