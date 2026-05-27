'use client';
import { useState } from 'react';
import { useSession } from 'next-auth/react';

interface Props {
  runId: string;
  runTitle: string;
  onClose: () => void;
  onSuccess: (repoUrl: string) => void;
}

/** Derive a valid GitHub repo name slug from a title */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'my-project';
}

export default function GitHubPushModal({ runId, runTitle, onClose, onSuccess }: Props) {
  const { data: session } = useSession();
  const suggestedName = slugify(runTitle);

  const [aiChoose, setAiChoose] = useState(false);
  const [repoName, setRepoName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveName = aiChoose ? suggestedName : (repoName.trim() || suggestedName);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const accessToken = (session as any)?.accessToken as string | undefined;
      const res = await fetch('/api/github/create-and-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId,
          repoName: effectiveName,
          accessToken,
        }),
      });
      const data = await res.json() as { ok: boolean; repoUrl?: string; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Push failed');
      } else {
        onSuccess(data.repoUrl ?? '');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-5">
          <span className="text-2xl">⬆</span>
          <div>
            <h2 className="text-base font-bold dark:text-white">Push to GitHub</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">A new repository will be created and the workspace pushed.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Repo name field */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide mb-1.5">
              Repository name
            </label>
            <input
              type="text"
              className="w-full border dark:border-gray-700 rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              placeholder={suggestedName}
              value={aiChoose ? suggestedName : repoName}
              onChange={e => setRepoName(e.target.value)}
              disabled={aiChoose || submitting}
              aria-label="Repository name"
            />
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
              Leave blank to use the suggested name above.
            </p>
          </div>

          {/* AI choose toggle */}
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={aiChoose}
              onChange={e => setAiChoose(e.target.checked)}
              disabled={submitting}
              className="rounded"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Let AI choose a name based on the specification
            </span>
          </label>
          {aiChoose && (
            <p className="text-xs text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 rounded px-3 py-2">
              Will create: <span className="font-mono font-semibold">{suggestedName}</span>
            </p>
          )}

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 rounded px-3 py-2">
              ❌ {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 px-4 py-2 text-sm rounded-lg border dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-gray-300 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2 text-sm rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-semibold hover:bg-gray-700 dark:hover:bg-gray-200 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Pushing…' : 'Push to GitHub'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
