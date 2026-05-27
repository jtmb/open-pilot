'use client';
import { signIn } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { GitHubOAuthBrowserDocs } from './Documentation';

interface Props {
  hasCredentials: boolean;
}

export default function LoginScreen({ hasCredentials }: Props) {
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [showDocs, setShowDocs] = useState(false);
  const [storedUsers, setStoredUsers] = useState<{ id: string; name: string; image: string | null }[]>([]);

  // Credentials can be entered inline — flips to true without restart
  const [configured, setConfigured] = useState(hasCredentials);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Access password gate
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [accessPassword, setAccessPassword] = useState('');
  const [passwordVerified, setPasswordVerified] = useState(false);
  const [checkingPassword, setCheckingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Show/hide password toggles
  const [showSecret, setShowSecret] = useState(false);
  const [showAccessPw, setShowAccessPw] = useState(false);

  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/auth/github-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setConfigured(true);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setCheckingPassword(true);
    setPasswordError(null);
    try {
      const res = await fetch('/api/auth/access-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: accessPassword }),
      });
      if (res.ok) {
        setPasswordVerified(true);
      } else {
        setPasswordError('Incorrect password. Try again.');
        setAccessPassword('');
      }
    } catch {
      setPasswordError('Could not verify password. Check your connection.');
    } finally {
      setCheckingPassword(false);
    }
  };

  // Check stored users for offline fallback + access-password requirement
  useEffect(() => {
    fetch('/api/auth/stored-users')
      .then(r => r.json())
      .then((d: { users?: typeof storedUsers }) => {
        if (d.users?.length) setStoredUsers(d.users);
      })
      .catch(() => {});

    fetch('/api/auth/access-check')
      .then(r => r.json())
      .then((d: { requiresPassword?: boolean }) => {
        setRequiresPassword(!!d.requiresPassword);
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

  // ── Not configured — show inline credential form ────────────────────────
  if (!configured) {
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

        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* Left — step-by-step instructions */}
          <div className="lg:w-80 shrink-0 flex flex-col justify-start px-8 py-10 border-b lg:border-b-0 lg:border-r border-gray-800/60 bg-gray-900/40 overflow-y-auto">
            <div className="space-y-5">
              <div className="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-xl">🔐</div>
              <div>
                <h1 className="text-xl font-bold text-white tracking-tight">Connect GitHub</h1>
                <p className="text-sm text-gray-400 mt-2 leading-relaxed">
                  Create a GitHub OAuth app and paste your credentials — no restart needed.
                </p>
              </div>
              <div className="space-y-4 text-sm">
                {[
                  {
                    n: 1,
                    title: 'Open GitHub OAuth Apps',
                    body: <p className="text-gray-400 text-xs">Go to <span className="text-indigo-400 break-all">github.com/settings/applications/new</span></p>,
                  },
                  {
                    n: 2,
                    title: 'Fill in the app details',
                    body: (
                      <div className="rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 font-mono text-[11px] space-y-1 text-gray-300">
                        <div><span className="text-gray-500">App name:</span> OpenPilot</div>
                        <div><span className="text-gray-500">Homepage:</span> http://localhost:3000</div>
                        <div><span className="text-gray-500">Callback:</span> <span className="text-green-400">http://localhost:3000/api/auth/callback/github</span></div>
                      </div>
                    ),
                  },
                  {
                    n: 3,
                    title: 'Copy Client ID & Secret',
                    body: <p className="text-gray-400 text-xs">After registering, GitHub shows the Client ID and a button to generate the Client Secret.</p>,
                  },
                  {
                    n: 4,
                    title: 'Paste them on the right',
                    body: <p className="text-gray-400 text-xs">Enter both values and click <span className="text-white font-medium">Save & Sign in</span>. No restart required.</p>,
                  },
                ].map(({ n, title, body }) => (
                  <div key={n} className="flex gap-3">
                    <div className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{n}</div>
                    <div className="space-y-1.5">
                      <p className="font-medium text-gray-200">{title}</p>
                      {body}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right — credentials form */}
          <div className="flex-1 flex items-center justify-center p-8 lg:p-10">
            <div className="w-full max-w-sm">
              <h2 className="text-lg font-bold text-white mb-1">Enter your credentials</h2>
              <p className="text-xs text-gray-500 mb-6">Saved inside the container and applied immediately — no restart.</p>

              <form onSubmit={handleSaveCredentials} className="space-y-4">
                {saveError && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-xs text-red-400">
                    <p className="font-semibold">Failed to save</p>
                    <p className="text-red-400/80 mt-0.5">{saveError}</p>
                  </div>
                )}

                <label className="block">
                  <span className="block text-xs font-medium text-gray-300 mb-1.5">GitHub Client ID</span>
                  <input
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
                    value={clientId}
                    onChange={e => setClientId(e.target.value)}
                    placeholder="Ov23li…"
                    required
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>

                <label className="block">
                  <span className="block text-xs font-medium text-gray-300 mb-1.5">GitHub Client Secret</span>
                  <div className="relative">
                    <input
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 pr-10 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
                      value={clientSecret}
                      onChange={e => setClientSecret(e.target.value)}
                      placeholder="••••••••••••••••••••••••••••••••••••••••"
                      required
                      type={showSecret ? 'text' : 'password'}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={showSecret ? 'Hide secret' : 'Show secret'}
                      onClick={() => setShowSecret(s => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 transition-colors"
                    >
                      {showSecret ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      )}
                    </button>
                  </div>
                </label>

                <button
                  type="submit"
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-semibold text-sm transition-colors"
                >
                  {saving ? 'Saving…' : 'Save & Sign in →'}
                </button>
              </form>
            </div>
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

      {/* Sign-in card — always centred, never moves */}
      <div className="relative w-full max-w-xs">
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-2xl mx-auto mb-3">🤖</div>
          <h1 className="text-xl font-bold text-white tracking-tight">OpenPilot</h1>
          <p className="text-sm text-gray-400 mt-0.5">Sign in to continue</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-2xl">
          <div className="px-5 pt-5 pb-4 space-y-3">
            {signInError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-xs text-red-400 space-y-0.5">
                <p className="font-semibold">Sign-in failed</p>
                <p className="text-red-400/80">{signInError}</p>
              </div>
            )}

            {/* Access password gate */}
            {requiresPassword && !passwordVerified ? (
              <form onSubmit={handleVerifyPassword} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1.5">Access password</label>
                  <div className="relative">
                    <input
                      type={showAccessPw ? 'text' : 'password'}
                      value={accessPassword}
                      onChange={e => setAccessPassword(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 pr-10 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
                      placeholder="Enter access password"
                      autoComplete="current-password"
                      autoFocus
                      required
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={showAccessPw ? 'Hide password' : 'Show password'}
                      onClick={() => setShowAccessPw(s => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 transition-colors"
                    >
                      {showAccessPw ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      )}
                    </button>
                  </div>
                  {passwordError && (
                    <p className="mt-1.5 text-xs text-red-400">{passwordError}</p>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={checkingPassword}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-semibold text-sm transition-colors"
                >
                  {checkingPassword ? 'Checking…' : 'Continue →'}
                </button>
              </form>
            ) : (
              <>
                {/* GitHub sign-in */}
                <button
                  onClick={handleGithub}
                  disabled={signingIn}
                  className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 bg-white text-gray-900 rounded-xl font-semibold text-sm hover:bg-gray-100 disabled:opacity-50 transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
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
                        className="w-full flex items-center gap-3 px-4 py-2 border border-gray-700/60 rounded-xl text-sm hover:bg-gray-800/60 disabled:opacity-50 transition-colors"
                      >
                        {u.image
                          ? <img src={u.image} alt="" className="w-6 h-6 rounded-full" />
                          : <span className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-xs">👤</span>
                        }
                        <span className="flex-1 text-left text-gray-300 text-xs">{u.name}</span>
                        <span className="text-[11px] text-gray-500">offline</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Setup guide toggle */}
          <button
            onClick={() => setShowDocs(v => !v)}
            className="w-full flex items-center justify-center gap-1.5 px-5 py-2.5 border-t border-gray-800 text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800/40 transition-colors"
          >
            <svg viewBox="0 0 16 16" className="w-3 h-3 fill-current opacity-60" aria-hidden="true">
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm.75 10.5h-1.5v-1.5h1.5v1.5zm0-3h-1.5C7.25 7.19 9 6.75 9 5.5a1 1 0 00-2 0H5.5a2.5 2.5 0 015 0c0 1.63-1.75 1.88-1.75 3z"/>
            </svg>
            How do I set up GitHub OAuth?
          </button>
        </div>
      </div>

      {/* Setup guide modal overlay — centred, page never moves */}
      {showDocs && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
          onClick={() => setShowDocs(false)}
        >
          <div
            className="relative w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="text-sm font-semibold text-white">GitHub OAuth Setup</h2>
              <button
                onClick={() => setShowDocs(false)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                aria-label="Close"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Scrollable body */}
            <div className="overflow-y-auto px-5 py-5" style={{ maxHeight: 'calc(100vh - 12rem)' }}>
              <GitHubOAuthBrowserDocs />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
