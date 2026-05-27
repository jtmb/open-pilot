import { useEffect, useState } from 'react';

interface Job {
	id: string;
	prompt: string;
	status: 'pending' | 'running' | 'completed' | 'failed';
	result?: string;
	error?: string;
	createdAt: number;
	updatedAt: number;
}

export default function JobStatus() {
	const [jobs, setJobs] = useState<Job[]>([]);
	useEffect(() => {
		const interval = setInterval(() => {
			fetch('/api/jobs/history')
				.then(res => res.json())
				.then(data => setJobs(data.jobs || []));
		}, 2000);
		return () => clearInterval(interval);
	}, []);
	const activeJobs = jobs.filter(j => j.status === 'pending' || j.status === 'running');
	return (
		<span className="text-xs text-gray-500">
			{activeJobs.length === 0 ? 'No jobs running' : (
				<ul>
					{activeJobs.map(job => (
						<li key={job.id}>
							<span className="font-mono text-xs">{job.id.slice(0, 8)}</span>: {job.prompt} <span className="italic">({job.status})</span>
						</li>
					))}
				</ul>
			)}
		</span>
	);
}
