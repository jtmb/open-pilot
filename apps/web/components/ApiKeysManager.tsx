'use client';
import { useCallback, useEffect, useState } from 'react';
import { type CopilotModel, bestFreeModel, multiplierLabel } from './ModelSelector';

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  model: string;
  enabled: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

function fmtDate(ms: number | null) {
  if (!ms) return 'Never';
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function CopyButton({ text, dark }: { text: string; dark?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={copy}
      className={`px-2 py-0.5 text-xs rounded transition-colors ${
        dark
          ? 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300'
      }`}
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

export default function ApiKeysManager() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [models, setModels] = useState<CopilotModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New key form
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newModel, setNewModel] = useState('gpt-4o');
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<{ id: string; raw: string } | null>(null);
  // Persists the last revealed raw key for the curl snippet (cleared only on unmount/navigate away)
  const [lastRawKey, setLastRawKey] = useState<string | null>(null);
  const [lastKeyId, setLastKeyId] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      const r = await fetch('/api/apikeys');
      const d = await r.json() as { keys?: ApiKey[]; error?: string };
      if (d.error) throw new Error(d.error);
      setKeys(d.keys ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
    // Load available models for the selector
    fetch('/api/models')
      .then(r => r.json())
      .then((d: { models?: CopilotModel[] }) => {
        if (d.models) {
          setModels(d.models);
          const best = bestFreeModel(d.models);
          if (best) setNewModel(best.id);
        }
      })
      .catch(() => {});
  }, [fetchKeys]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch('/api/apikeys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), model: newModel }),
      });
      const d = await r.json() as { key?: ApiKey; rawKey?: string; error?: string };
      if (d.error) throw new Error(d.error);
      setKeys(prev => [d.key!, ...prev]);
      setRevealedKey({ id: d.key!.id, raw: d.rawKey! });
      setLastRawKey(d.rawKey!);
      setLastKeyId(d.key!.id);
      setNewName('');
      setShowForm(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this API key? This cannot be undone.')) return;
    setKeys(prev => prev.filter(k => k.id !== id));
    if (revealedKey?.id === id) setRevealedKey(null);
    await fetch(`/api/apikeys/${id}`, { method: 'DELETE' }).catch(() => {});
  };

  const handleToggle = async (key: ApiKey) => {
    const updated = { ...key, enabled: !key.enabled };
    setKeys(prev => prev.map(k => k.id === key.id ? updated : k));
    await fetch(`/api/apikeys/${key.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: updated.enabled }),
    }).catch(() => {});
  };

  const handleRotate = async (key: ApiKey) => {
    if (!confirm(`Rotate key for "${key.name}"? The current key will stop working immediately.`)) return;
    try {
      const r = await fetch(`/api/apikeys/${key.id}/rotate`, { method: 'POST' });
      const d = await r.json() as { key?: ApiKey; rawKey?: string; error?: string };
      if (d.error) throw new Error(d.error);
      setKeys(prev => prev.map(k => k.id === key.id ? { ...k, keyPrefix: d.key!.keyPrefix } : k));
      setRevealedKey({ id: key.id, raw: d.rawKey! });
      setLastRawKey(d.rawKey!);
      setLastKeyId(key.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleModelChange = async (key: ApiKey, model: string) => {
    setKeys(prev => prev.map(k => k.id === key.id ? { ...k, model } : k));
    await fetch(`/api/apikeys/${key.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    }).catch(() => {});
  };

  return (
    <div className="overflow-y-auto h-full bg-gray-50 dark:bg-gray-900 p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">API Keys</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Create keys to access the OpenAI-compatible API from external apps.
          </p>
        </div>
        <button
          onClick={() => { setShowForm(true); setRevealedKey(null); setError(null); }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          + New App Key
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {/* New key form */}
      {showForm && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm">New App Key</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">App Name</label>
              <input
                type="text"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. My VSCode Extension"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Model</label>
              <select
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={newModel}
                onChange={e => setNewModel(e.target.value)}
              >
                {models.length > 0
                  ? models.map(m => <option key={m.id} value={m.id}>{m.name} ({multiplierLabel(m.multiplier)})</option>)
                  : <option value={newModel}>{newModel}</option>}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowForm(false); setError(null); }}
              className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold disabled:opacity-50 transition-colors"
            >
              {creating ? 'Creating…' : 'Create Key'}
            </button>
          </div>
        </div>
      )}

      {/* Revealed key banner */}
      {revealedKey && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-green-800 dark:text-green-300">
            🔑 Copy your key now — it won't be shown again
          </p>
          <div className="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-lg border border-green-200 dark:border-green-700 px-3 py-2">
            <code className="flex-1 text-xs font-mono text-gray-800 dark:text-gray-200 break-all select-all">
              {revealedKey.raw}
            </code>
            <CopyButton text={revealedKey.raw} />
          </div>
          <button
            onClick={() => setRevealedKey(null)}
            className="text-xs text-green-700 dark:text-green-400 hover:underline"
          >
            I've saved it, dismiss
          </button>
        </div>
      )}

      {/* Keys table */}
      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : keys.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-10 text-center">
          <p className="text-4xl mb-3">🔑</p>
          <p className="text-gray-500 dark:text-gray-400 text-sm">No API keys yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map(key => (
            <div
              key={key.id}
              className={`bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 transition-opacity ${
                key.enabled ? 'border-gray-200 opacity-100' : 'border-gray-200 opacity-60'
              }`}
            >
              <div className="flex flex-wrap items-start gap-3">
                {/* Left — name + meta */}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 dark:text-white text-sm">{key.name}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      key.enabled
                        ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500'
                    }`}>
                      {key.enabled ? 'active' : 'disabled'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
                    <span className="font-mono">{key.keyPrefix}</span>
                    <span>Created {fmtDate(key.createdAt)}</span>
                    <span>Last used {fmtDate(key.lastUsedAt)}</span>
                  </div>
                </div>

                {/* Right — model selector + actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    className="rounded border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={key.model}
                    onChange={e => handleModelChange(key, e.target.value)}
                    title="Model used for this key"
                  >
                    {models.length > 0
                      ? models.map(m => <option key={m.id} value={m.id}>{m.name} ({multiplierLabel(m.multiplier)})</option>)
                      : <option value={key.model}>{key.model}</option>}
                  </select>
                  <button
                    onClick={() => handleToggle(key)}
                    title={key.enabled ? 'Disable key' : 'Enable key'}
                    className="text-xs px-2.5 py-1 rounded border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
                  >
                    {key.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() => handleRotate(key)}
                    title="Generate new secret"
                    className="text-xs px-2.5 py-1 rounded border border-amber-200 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/30 text-amber-700 dark:text-amber-400 transition-colors"
                  >
                    ↻ Rotate
                  </button>
                  <button
                    onClick={() => handleDelete(key.id)}
                    title="Delete key"
                    className="text-xs px-2.5 py-1 rounded border border-red-200 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 transition-colors"
                  >
                    🗑
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Usage snippet */}
      {keys.length > 0 && (() => {
        const snippetKey = lastKeyId ? keys.find(k => k.id === lastKeyId) : keys[0];
        const snippetModel = snippetKey?.model ?? 'gpt-4o';
        const snippetAuth = lastRawKey ?? (keys[0]?.keyPrefix ? keys[0].keyPrefix + '…' : '<your-key>');
        const curlCmd = `curl http://localhost:3000/v1/chat/completions \\
  -H "Authorization: Bearer ${snippetAuth}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${snippetModel}","messages":[{"role":"user","content":"Hello!"}]}'`;
        return (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Quick Usage</h3>
              {lastRawKey && (
                <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
                  Using last created key
                </span>
              )}
            </div>
            <div className="relative group">
              <pre className="bg-gray-900 text-green-300 rounded-lg p-4 text-xs font-mono overflow-x-auto whitespace-pre pr-16">
{curlCmd}
              </pre>
              <div className="absolute top-3 right-3">
                <CopyButton text={curlCmd} dark />
              </div>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Compatible with any OpenAI SDK. Set <code className="text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">base_url</code> to <code className="text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">http://localhost:3000/v1</code>.
              See the <span className="text-blue-500">Docs → API Usage</span> tab for examples.
            </p>
          </div>
        );
      })()}
    </div>
  );
}
