'use client';
import { signIn } from 'next-auth/react';
import { useState } from 'react';

export default function LoginScreen() {
  const [signingIn, setSigningIn] = useState(false);

  const handleGithub = () => {
    setSigningIn(true);
    signIn('github').catch(() => setSigningIn(false));
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-2xl p-10 w-full max-w-sm text-center space-y-6">
        {/* Logo */}
        <div>
          <div className="w-16 h-16 rounded-2xl bg-gray-900 flex items-center justify-center text-2xl mx-auto mb-4">
            🤖
          </div>
          <h1 className="text-2xl font-bold text-gray-900">OpenPilot</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to continue</p>
        </div>

        {/* GitHub sign-in */}
        <button
          onClick={handleGithub}
          disabled={signingIn}
          className="w-full flex items-center justify-center gap-2.5 px-4 py-3 bg-gray-900 text-white rounded-lg font-semibold text-sm hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
          {signingIn ? 'Redirecting…' : 'Sign in with GitHub'}
        </button>
      </div>
    </div>
  );
}
