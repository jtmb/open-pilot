import { NextRequest, NextResponse } from 'next/server';
import { getJob } from '@/services/jobService';

// GET /api/jobs/[id]
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const job = getJob(params.id);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }
  return NextResponse.json({ job });
}
