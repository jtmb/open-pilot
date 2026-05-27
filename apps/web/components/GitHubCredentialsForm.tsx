import { useState } from 'react';

export default function GitHubCredentialsForm({ onSave }: { onSave: (id: string, secret: string) => void }) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [show, setShow] = useState(false);

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
                <input
                  className="border px-2 py-1.5 rounded w-full mt-1 font-mono text-sm"
                  value={clientSecret}
                  onChange={e => setClientSecret(e.target.value)}
                  placeholder="••••••••••••••••••••••••"
                  required
                  type="password"
                  autoComplete="new-password"
                />
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
