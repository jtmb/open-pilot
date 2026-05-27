'use client';
import { signIn } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { GitHubOAuthDocs } from './Documentation';

interface Props {
  hasCredentials: boolean;
}

export default function LoginScreen({ hasCredentials }: Props) {
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [showDocs, setShowDocs] = useState(!hasCredentials);
  const [storedUsers, setStoredUsers] = useState<{ id: string; name: string; image: string | null }[]>([]);
  const [offlineMode, setOfflineMode] = useState(false);

  // Check if there are stored users for offline fallback
  useEffect(() => {
    fetch('/api/auth/stored-users')
      .then(r => r.json())
      .then((d: { users?: typeof storedUsers }) => {
        if (d.users?.length) setStoredUsers(d.users);
      })
      .catch(() => {});
  }, []);

  const handleGithub = () => {
    setSigningIn(true);
    setSignInError(null);
    signIn('github').catch(() => {
      setSigningIn(false);
      setSignInError('Could not reach GitHub. Check your connection and try again.');
    });
  };

  const handleOfflineSignIn = async (userId: string) => {
    setSigningIn(true);
    setSignInError(null);
    try {
      const result = await signIn('stored-session', { userId, redirect: false });
      if (result?.error) {
        setSignInError('Offline sign-in failed. Your session data may be unavailable.');
        setSigningIn(false);
      }
    } catch {
      setSignInError('Could not complete offline sign-in.');
      setSigningIn(false);
    }
  };

  // ── Not configured — show setup guide ───────────────────────────────────
  if (!hasCredentials) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800/60">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-sm">🤖</div>
            <span className="text-white font-semibold tracking-tight">OpenPilot</span>
          </div>
          <span className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 px-3 py-1 rounded-full">Setup required</span>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* Left — call to action */}
          <div className="lg:w-72 shrink-0 flex flex-col justify-center px-8 py-10 border-b lg:border-b-0 lg:border-r border-gray-800/60 bg-gray-900/40">
            <div className="space-y-5">
              <div className="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-xl">🔐</div>
              <div>
                <h1 className="text-xl font-bold text-white tracking-tight">GitHub OAuth setup</h1>
                <p className="text-sm text-gray-400 mt-2 leading-relaxed">
                  OpenPilot needs a GitHub OAuth app to sign users in and access GitHub Copilot.
                </p>
              </div>
              <div className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-4 text-xs space-y-2">
                <p className="font-medium text-gray-300">Once configured:</p>
                <ul className="space-y-1.5 text-gray-400">
                  <li className="flex items-center gap-2"><span className="text-indigo-400">→</span> Sign in with your GitHub account</li>
                  <li className="flex items-center gap-2"><span className="text-indigo-400">→</span> Use GitHub Copilot from a browser</li>
                  <li className="flex items-center gap-2"><span className="text-indigo-400">→</span> Run autonomous coding agents</li>
                </ul>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">
                After configuration, restart the container and this page will show a sign-in button.
              </p>
            </div>
          </div>

          {/* Right — docs */}
          <div className="flex-1 overflow-y-auto p-8 lg:p-10">
            <GitHubOAuthDocs />
          </div>
        </div>
      </div>
    );
  }

  // ── Configured — show sign-in ────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      {/* Subtle background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-indigo-600/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-2xl mx-auto mb-4">🤖</div>
          <h1 className="text-2xl font-bold text-white tracking-tight">OpenPilot</h1>
          <p className="text-sm text-gray-400 mt-1">Sign in to continue</p>
        </div>

        {/* Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-2xl">
          <div className="p-6 space-y-3">
            {signInError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-xs text-red-400 space-y-0.5">
                <p className="font-semibold">Sign-in failed</p>
                <p className="text-red-400/80">{signInError}</p>
              </div>
            )}

            {/* GitHub sign-in */}
            <button
              onClick={handleGithub}
              disabled={signingIn}
              className="w-full flex items-center justify-center gap-2.5 px-4 py-3 bg-white text-gray-900 rounded-xl font-semibold text-sm hover:bg-gray-100 disabled:opacity-50 transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              {signingIn ? 'Redirecting…' : 'Sign in with GitHub'}
            </button>

            {/* Offline fallback — only shown if stored users exist */}
            {storedUsers.length > 0 && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-gray-800" />
                  <span className="text-xs text-gray-600">offline access</span>
                  <div className="flex-1 h-px bg-gray-800" />
                </div>
                {storedUsers.map(u => (
                  <button
                    key={u.id}
                    onClick={() => handleOfflineSignIn(u.id)}
                    disabled={signingIn}
                    className="w-full flex items-center gap-3 px-4 py-2.5 border border-gray-700/60 rounded-xl text-sm hover:bg-gray-800/60 disabled:opacity-50 transition-colors"
                  >
                    {u.image
                      ? <img src={u.image} alt="" className="w-7 h-7 rounded-full" />
                      : <span className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs">👤</span>
                    }
                    <span className="flex-1 text-left text-gray-300">{u.name}</span>
                    <span className="text-xs text-gray-500">offline</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Setup guide toggle */}
          <button
            onClick={() => setShowDocs(v => !v)}
            className="w-full flex items-center justify-center gap-1.5 px-6 py-3 border-t border-gray-800 text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800/40 transition-colors"
          >
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-current opacity-60" aria-hidden="true">
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm.75 10.5h-1.5v-1.5h1.5v1.5zm0-3h-1.5C7.25 7.19 9 6.75 9 5.5a1 1 0 00-2 0H5.5a2.5 2.5 0 015 0c0 1.63-1.75 1.88-1.75 3z"/>
            </svg>
            {showDocs ? 'Hide setup guide' : 'How do I set up GitHub OAuth?'}
          </button>
        </div>

        {/* Inline docs when expanded */}
        {showDocs && (
          <div className="mt-3 bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5 max-h-96 overflow-y-auto shadow-2xl">
            <GitHubOAuthDocs />
          </div>
        )}
      </div>
    </div>
  );
}
