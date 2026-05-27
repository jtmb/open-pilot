'use client';
import { signIn, signOut, useSession } from 'next-auth/react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface BackupInfo {
  filename: string;
  createdAt: number;
  size: number;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

export default function ProfileMenu() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Backup state
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupMsg, setBackupMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showBackups, setShowBackups] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  // Sync dark state from DOM on mount
  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggleDark = () => {
    const next = !isDark;
    setIsDark(next);
    if (next) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('openpilot_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('openpilot_theme', 'light');
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const loadBackups = useCallback(async () => {
    try {
      const r = await fetch('/api/backup/list');
      const d = await r.json() as { backups: BackupInfo[] };
      setBackups(d.backups ?? []);
    } catch { setBackups([]); }
  }, []);

  useEffect(() => {
    if (showBackups) loadBackups();
  }, [showBackups, loadBackups]);

  const handleExport = useCallback(async () => {
    setBackupLoading(true);
    setBackupMsg(null);
    try {
      const r = await fetch('/api/backup/export');
      if (!r.ok) throw new Error('Export failed');
      const blob = await r.blob();
      const cd = r.headers.get('Content-Disposition') ?? '';
      const match = cd.match(/filename="([^"]+)"/);
      const name = match?.[1] ?? 'openpilot.db';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
      setBackupMsg({ ok: true, text: 'Database exported successfully' });
    } catch (e) {
      setBackupMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBackupLoading(false);
    }
  }, []);

  const handleImport = useCallback(async (file: File) => {
    if (!file.name.endsWith('.db')) {
      setBackupMsg({ ok: false, text: 'Please select a .db file' });
      return;
    }
    setBackupLoading(true);
    setBackupMsg(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await fetch('/api/backup/import', { method: 'POST', body: form });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (d.ok) {
        setBackupMsg({ ok: true, text: 'Database imported — reload to see changes' });
      } else {
        setBackupMsg({ ok: false, text: d.error ?? 'Import failed' });
      }
    } catch (e) {
      setBackupMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBackupLoading(false);
    }
  }, []);

  const handleRestore = useCallback(async (filename: string) => {
    if (!confirm(`Restore database from "${filename}"? All current data will be replaced.`)) return;
    setBackupLoading(true);
    setBackupMsg(null);
    try {
      const r = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (d.ok) {
        setBackupMsg({ ok: true, text: 'Restored successfully — reload to see changes' });
      } else {
        setBackupMsg({ ok: false, text: d.error ?? 'Restore failed' });
      }
    } catch (e) {
      setBackupMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBackupLoading(false);
    }
  }, []);

  if (!session?.user) {
    return (
      <div className="px-4 py-3 border-t border-gray-800 shrink-0">
        <button
          onClick={() => signIn('github')}
          className="w-full text-left text-xs text-gray-400 hover:text-white transition-colors py-1"
        >
          Sign in →
        </button>
      </div>
    );
  }

  const user = session.user;
  const initials = (user.name ?? '?')
    .split(' ')
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative shrink-0 border-t border-gray-800" ref={menuRef}>
      {/* Dropdown menu — renders above the button */}
      {open && (
        <div className="absolute bottom-full left-2 right-2 mb-1 bg-gray-800 rounded-lg overflow-hidden shadow-xl border border-gray-700 z-50">
          <div className="px-3 py-2.5 border-b border-gray-700">
            <div className="text-xs font-medium text-white truncate">{user.name}</div>
            {user.email && (
              <div className="text-xs text-gray-400 truncate mt-0.5">{user.email}</div>
            )}
          </div>
          <div className="px-3 py-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Settings</p>
            <button
              onClick={toggleDark}
              className="w-full flex items-center justify-between px-1 py-1.5 rounded hover:bg-gray-700 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm text-gray-300">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
                Dark mode
              </span>
              {/* Toggle switch */}
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${isDark ? 'bg-blue-600' : 'bg-gray-600'}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${isDark ? 'translate-x-4' : 'translate-x-1'}`} />
              </span>
            </button>
          </div>
          <div className="border-t border-gray-700 mt-0.5" />

          {/* Backup section */}
          <div className="px-3 py-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Database Backup</p>

            {/* Status message */}
            {backupMsg && (
              <p className={`text-xs px-1 py-1 mb-1 rounded ${backupMsg.ok ? 'text-green-400' : 'text-red-400'}`}>
                {backupMsg.text}
              </p>
            )}

            {/* Export + Import row */}
            <div className="flex gap-1.5 mb-1.5">
              <button
                onClick={handleExport}
                disabled={backupLoading}
                className="flex-1 text-xs py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors disabled:opacity-50"
              >
                ⬇ Export
              </button>
              <button
                onClick={() => importRef.current?.click()}
                disabled={backupLoading}
                className="flex-1 text-xs py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors disabled:opacity-50"
              >
                ⬆ Import
              </button>
              <input
                ref={importRef}
                type="file"
                accept=".db"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = ''; }}
              />
            </div>

            {/* Auto-backup list toggle */}
            <button
              onClick={() => setShowBackups(p => !p)}
              className="w-full text-left text-xs text-gray-400 hover:text-gray-200 flex items-center justify-between px-1 py-1 rounded hover:bg-gray-700 transition-colors"
            >
              <span>Auto-backups</span>
              <span className="text-gray-500">{showBackups ? '▲' : '▼'}</span>
            </button>

            {showBackups && (
              <div className="mt-1 space-y-1 max-h-48 overflow-y-auto">
                {backups.length === 0 ? (
                  <p className="text-xs text-gray-500 px-1 py-1">No auto-backups yet (first runs 30s after startup)</p>
                ) : backups.map(b => (
                  <div key={b.filename} className="flex items-center justify-between gap-1 px-1 py-1 rounded hover:bg-gray-700">
                    <div className="min-w-0">
                      <div className="text-xs text-gray-300 truncate">{fmtDate(b.createdAt)}</div>
                      <div className="text-[10px] text-gray-500">{fmtSize(b.size)}</div>
                    </div>
                    <button
                      onClick={() => handleRestore(b.filename)}
                      disabled={backupLoading}
                      className="shrink-0 text-[10px] px-2 py-0.5 rounded bg-gray-600 hover:bg-gray-500 text-gray-200 transition-colors disabled:opacity-50"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-gray-700 mt-0.5" />
          <button
            onClick={() => { setOpen(false); signOut(); }}
            className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
          >
            Sign out
          </button>
        </div>
      )}

      {/* Profile button */}
      <button
        onClick={() => setOpen(prev => !prev)}
        className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-gray-800 transition-colors"
      >
        {user.image ? (
          <img
            src={user.image}
            alt=""
            className="w-7 h-7 rounded-full shrink-0 ring-1 ring-gray-600"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-gray-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
            {initials}
          </div>
        )}
        <div className="flex-1 min-w-0 text-left">
          <div className="text-sm text-white font-medium truncate">{user.name}</div>
          {user.email && (
            <div className="text-[11px] text-gray-400 truncate">{user.email}</div>
          )}
        </div>
        <svg
          className={`w-3.5 h-3.5 text-gray-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    </div>
  );
}
