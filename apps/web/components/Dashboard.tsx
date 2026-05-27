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

export default function Dashboard() {
	const [jobs, setJobs] = useState<Job[]>([]);
	useEffect(() => {
		fetch('/api/jobs/history')
			.then(res => res.json())
			.then(data => setJobs(data.jobs || []));
	}, []);
	const activeJobs = jobs.filter(j => j.status === 'pending' || j.status === 'running');
	const completedJobs = jobs.filter(j => j.status === 'completed' || j.status === 'failed');
	return (
		<div className="p-8">
			<h2 className="text-2xl font-bold mb-4">Dashboard</h2>
			<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
				<div className="bg-white rounded shadow p-6">
					<h3 className="font-semibold mb-2">Active Jobs</h3>
					<ul className="text-sm text-gray-700">
						{activeJobs.length === 0 ? (
							<li>No jobs running</li>
						) : (
							activeJobs.map(job => (
								<li key={job.id} className="mb-2">
									<span className="font-mono text-xs">{job.id.slice(0, 8)}</span>: {job.prompt} <span className="italic">({job.status})</span>
								</li>
							))
						)}
					</ul>
				</div>
				<div className="bg-white rounded shadow p-6">
					<h3 className="font-semibold mb-2">Job History</h3>
					<ul className="text-sm text-gray-700">
						{completedJobs.length === 0 ? (
							<li>No job history</li>
						) : (
							completedJobs.map(job => (
								<li key={job.id} className="mb-2">
									<span className="font-mono text-xs">{job.id.slice(0, 8)}</span>: {job.prompt} <span className="italic">({job.status})</span>
									{job.result && <div className="text-green-700">Result: {job.result}</div>}
									{job.error && <div className="text-red-700">Error: {job.error}</div>}
								</li>
							))
						)}
					</ul>
				</div>
				<div className="bg-white rounded shadow p-6 md:col-span-2">
					<h3 className="font-semibold mb-2">Usage Stats</h3>
					<p className="text-sm text-gray-700">Total jobs: {jobs.length}</p>
				</div>
			</div>
		</div>
	);
}
