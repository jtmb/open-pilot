import { NextRequest, NextResponse } from 'next/server';
import { listJobs } from '@/services/jobService';

// GET /api/jobs/history
export async function GET() {
  return NextResponse.json({ jobs: listJobs() });
}
