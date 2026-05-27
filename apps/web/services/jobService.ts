import { v4 as uuidv4 } from 'uuid';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Job {
  id: string;
  prompt: string;
  status: JobStatus;
  result?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const jobs: Record<string, Job> = {};

export function createJob(prompt: string): Job {
  const id = uuidv4();
  const now = Date.now();
  const job: Job = {
    id,
    prompt,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  jobs[id] = job;
  return job;
}

export function updateJob(id: string, updates: Partial<Job>): Job | undefined {
  const job = jobs[id];
  if (!job) return undefined;
  Object.assign(job, updates, { updatedAt: Date.now() });
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs[id];
}

export function listJobs(): Job[] {
  return Object.values(jobs).sort((a, b) => b.createdAt - a.createdAt);
}
