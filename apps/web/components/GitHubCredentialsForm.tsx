import { useState } from 'react';

export default function GitHubCredentialsForm({ onSave }: { onSave: (id: string, secret: string) => void }) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [show, setShow] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(clientId, clientSecret);
    setShow(false);
  };

  return (
    <>
      <button
        className="bg-blue-600 text-white px-3 py-1 rounded mr-2 text-sm"
        onClick={() => setShow((s) => !s)}
      >
        {show ? 'Cancel' : 'Set GitHub Credentials'}
      </button>
      {show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-bold mb-1">GitHub OAuth App Setup</h2>
            <ol className="text-xs text-gray-600 mb-4 list-decimal ml-4 space-y-1">
              <li>Go to <strong>github.com/settings/developers</strong> → &quot;OAuth Apps&quot; → &quot;New OAuth App&quot;</li>
              <li>Set <strong>Homepage URL</strong> to <code className="bg-gray-100 px-1">http://localhost:3000</code></li>
              <li>Set <strong>Callback URL</strong> to <code className="bg-gray-100 px-1">http://localhost:3000/api/auth/callback/github</code></li>
              <li>Click &quot;Register application&quot; and copy the Client ID and Secret below</li>
            </ol>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <label className="text-sm font-medium">
                GitHub Client ID
                <input
                  className="border px-2 py-1.5 rounded w-full mt-1 font-mono text-sm"
                  value={clientId}
                  onChange={e => setClientId(e.target.value)}
                  placeholder="Ov23li..."
                  required
                  autoComplete="off"
                />
              </label>
              <label className="text-sm font-medium">
                GitHub Client Secret
                <div className="relative mt-1">
                  <input
                    className="border px-2 py-1.5 pr-9 rounded w-full font-mono text-sm"
                    value={clientSecret}
                    onChange={e => setClientSecret(e.target.value)}
                    placeholder="••••••••••••••••••••••••"
                    required
                    type={showSecret ? 'text' : 'password'}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={showSecret ? 'Hide secret' : 'Show secret'}
                    onClick={() => setShowSecret(s => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 transition-colors"
                  >
                    {showSecret ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    )}
                  </button>
                </div>
              </label>
              <div className="flex gap-2 mt-1">
                <button type="submit" className="flex-1 bg-green-600 text-white px-3 py-2 rounded text-sm font-medium">
                  Save &amp; Enable Sign-In
                </button>
                <button type="button" className="px-3 py-2 rounded text-sm border" onClick={() => setShow(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
