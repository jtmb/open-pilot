'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

interface BackupInfo {
  filename: string;
  createdAt: number;
  size: number;
}

interface BackupConfig {
  enabled: boolean;
  intervalHours: number;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const INTERVAL_OPTIONS = [
  { value: 1,  label: 'Every hour' },
  { value: 3,  label: 'Every 3 hours' },
  { value: 6,  label: 'Every 6 hours' },
  { value: 12, label: 'Every 12 hours' },
  { value: 24, label: 'Once a day' },
];

interface Props {
  onClose: () => void;
}

export default function BackupPanel({ onClose }: Props) {
  const [config, setConfig] = useState<BackupConfig>({ enabled: true, intervalHours: 6 });
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const showMsg = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const reload = useCallback(async () => {
    try {
      const [cfgRes, listRes] = await Promise.all([
        fetch('/api/backup/config').then(r => r.json() as Promise<BackupConfig>),
        fetch('/api/backup/list').then(r => r.json() as Promise<{ backups: BackupInfo[] }>),
      ]);
      setConfig(cfgRes);
      setBackups(listRes.backups ?? []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const updateConfig = async (patch: Partial<BackupConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    try {
      await fetch('/api/backup/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch { /* ignore */ }
  };

  const handleTrigger = async () => {
    setActionLoading(true);
    try {
      const r = await fetch('/api/backup/trigger', { method: 'POST' });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (d.ok) { showMsg(true, 'Backup created successfully'); await reload(); }
      else showMsg(false, d.error ?? 'Backup failed');
    } catch (e) {
      showMsg(false, (e as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleExport = async () => {
    setActionLoading(true);
    try {
      const r = await fetch('/api/backup/export');
      if (!r.ok) throw new Error('Export failed');
      const blob = await r.blob();
      const cd = r.headers.get('Content-Disposition') ?? '';
      const match = cd.match(/filename="([^"]+)"/);
      const name = match?.[1] ?? 'openpilot.db';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showMsg(true, 'Database exported');
    } catch (e) {
      showMsg(false, (e as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleImport = async (file: File) => {
    if (!file.name.endsWith('.db')) { showMsg(false, 'Please select a .db file'); return; }
    if (!confirm('Replace the current database with the imported file? This cannot be undone.')) return;
    setActionLoading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await fetch('/api/backup/import', { method: 'POST', body: form });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (d.ok) showMsg(true, 'Imported — reload to see changes');
      else showMsg(false, d.error ?? 'Import failed');
    } catch (e) {
      showMsg(false, (e as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestore = async (filename: string) => {
    if (!confirm(`Restore database from "${filename}"? All current data will be replaced.`)) return;
    setActionLoading(true);
    try {
      const r = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (d.ok) showMsg(true, 'Restored — reload to see changes');
      else showMsg(false, d.error ?? 'Restore failed');
    } catch (e) {
      showMsg(false, (e as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 3 8 3s8-.79 8-3V7M4 7c0 2.21 3.582 3 8 3s8-.79 8-3M4 7c0-2.21 3.582-3 8-3s8 .79 8 3" />
            </svg>
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Backup Configuration</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Status message */}
          {msg && (
            <p className={`text-sm px-3 py-2 rounded-lg ${msg.ok ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'}`}>
              {msg.text}
            </p>
          )}

          {/* Auto-backup settings */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Auto-Backup</p>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg divide-y divide-gray-200 dark:divide-gray-700">
              {/* Enable toggle */}
              <button
                onClick={() => updateConfig({ enabled: !config.enabled })}
                className="w-full flex items-center justify-between px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white text-left">Automatic Backups</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 text-left">
                    {config.enabled ? `Running every ${config.intervalHours}h` : 'Disabled'}
                  </p>
                </div>
                <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${config.enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${config.enabled ? 'translate-x-4' : 'translate-x-1'}`} />
                </span>
              </button>
              {/* Frequency */}
              {config.enabled && (
                <div className="px-4 py-3 flex items-center justify-between">
                  <p className="text-sm text-gray-700 dark:text-gray-300">Frequency</p>
                  <select
                    value={config.intervalHours}
                    onChange={e => updateConfig({ intervalHours: parseInt(e.target.value) })}
                    className="border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    {INTERVAL_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <button
              onClick={handleTrigger}
              disabled={actionLoading}
              className="w-full text-sm py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              {actionLoading ? 'Working…' : '⚡ Back Up Now'}
            </button>
          </div>

          {/* Auto-backup list */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Auto-Backup History ({backups.length})
            </p>
            {loading ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 py-2">Loading…</p>
            ) : backups.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 py-2">
                No backups yet. {config.enabled ? 'First backup runs 30s after server start.' : 'Enable auto-backup or click "Back Up Now".'}
              </p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {backups.map(b => (
                  <div key={b.filename} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800 dark:text-gray-200">{fmtDate(b.createdAt)}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">{fmtSize(b.size)}</p>
                    </div>
                    <button
                      onClick={() => handleRestore(b.filename)}
                      disabled={actionLoading}
                      className="shrink-0 text-xs px-3 py-1 rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Export / Import */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Database</p>
            <div className="flex gap-2">
              <button
                onClick={handleExport}
                disabled={actionLoading}
                className="flex-1 text-sm py-2 rounded-lg bg-gray-900 dark:bg-gray-700 text-white hover:bg-gray-800 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
              >
                ⬇ Export .db
              </button>
              <button
                onClick={() => importRef.current?.click()}
                disabled={actionLoading}
                className="flex-1 text-sm py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                ⬆ Import .db
              </button>
              <input
                ref={importRef}
                type="file"
                accept=".db"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = ''; }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
