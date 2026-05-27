// GET /api/backup/export — download the current live database as a .db file
import { NextResponse } from 'next/server';
import fs from 'fs';

const DB_PATH = process.env.DATABASE_URL?.replace(/^file:/, '') ?? '/data/openpilot.db';

export async function GET() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return NextResponse.json({ error: 'Database file not found' }, { status: 404 });
    }

    const buffer = fs.readFileSync(DB_PATH);
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const filename = `openpilot_${ts}.db`;

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
