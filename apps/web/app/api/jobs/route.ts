import { NextRequest, NextResponse } from 'next/server';
import { createJob, updateJob, getJob, listJobs } from '@/services/jobService';
import { sendCopilotPrompt } from '@/services/copilotService';

// POST /api/jobs
// Body: { prompt: string }
export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();
    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }
    const job = createJob(prompt);
    updateJob(job.id, { status: 'running' });
    try {
      const result = await sendCopilotPrompt(prompt);
      updateJob(job.id, { status: 'completed', result });
    } catch (err: any) {
      updateJob(job.id, { status: 'failed', error: err.message });
    }
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// GET /api/jobs
export async function GET() {
  return NextResponse.json({ jobs: listJobs() });
}
