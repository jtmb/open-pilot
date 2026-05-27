import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

interface RatePayload {
  rating: 1 | -1;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { rating } = await req.json() as RatePayload;

    if (rating !== 1 && rating !== -1) {
      return NextResponse.json({ error: 'rating must be 1 or -1' }, { status: 400 });
    }

    const record = await prisma.agentRunRecord.update({
      where: { id },
      data: { userRating: rating },
    });

    return NextResponse.json({ ok: true, id: record.id, rating: record.userRating });
  } catch (err) {
    console.error('[runs/rate]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
