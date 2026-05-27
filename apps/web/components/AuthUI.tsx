"use client";
import { signIn, signOut, useSession } from 'next-auth/react';
import { useState } from 'react';
import GitHubCredentialsForm from './GitHubCredentialsForm';

export default function AuthUI() {
	const { data: session, status } = useSession();
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [credentialsSaved, setCredentialsSaved] = useState(false);

	async function saveCredentials(id: string, secret: string) {
		setSaving(true);
		setError(null);
		try {
			const res = await fetch('/api/auth/github-credentials', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ clientId: id, clientSecret: secret })
			});
			if (!res.ok) throw new Error('Failed to save credentials');
			setCredentialsSaved(true);
		} catch (e: any) {
			setError(e.message || 'Unknown error');
		} finally {
			setSaving(false);
		}
	}

	if (status === 'loading') {
		return <div className="text-sm text-gray-500">Loading...</div>;
	}

	return (
		<div className="flex items-center gap-2 relative">
			{session ? (
				<>
					<span className="text-sm text-gray-700">{session.user?.name || session.user?.email}</span>
					<button
						className="bg-gray-200 text-gray-900 px-3 py-1 rounded text-sm"
						onClick={() => signOut()}
					>
						Sign out
					</button>
				</>
			) : (
				<>
					<GitHubCredentialsForm onSave={saveCredentials} />
					{credentialsSaved && (
						<button
							className="bg-gray-900 text-white px-4 py-1.5 rounded text-sm font-medium"
							onClick={() => signIn('github')}
						>
							Sign in with GitHub
						</button>
					)}
					{!credentialsSaved && (
						<button
							className="bg-gray-400 text-white px-4 py-1.5 rounded text-sm font-medium"
							onClick={() => signIn('github')}
							title="Set GitHub credentials first"
						>
							Sign in with GitHub
						</button>
					)}
				</>
			)}
			{saving && <span className="text-xs text-blue-600">Saving...</span>}
			{error && <span className="text-xs text-red-600">{error}</span>}
			{credentialsSaved && !saving && <span className="text-xs text-green-600">✓ Credentials set</span>}
		</div>
	);
}
