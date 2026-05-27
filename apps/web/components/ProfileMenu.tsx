'use client';
import { signIn, signOut, useSession } from 'next-auth/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import BackupPanel from './BackupPanel';
import NotificationPanel from './NotificationPanel';
import AgentDefaults from './AgentDefaults';
import SecurityPanel from './SecurityPanel';

export default function ProfileMenu() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(true);
  const [showBackupPanel, setShowBackupPanel] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  const [showAgentDefaults, setShowAgentDefaults] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Sync dark state from DOM on mount
  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  // Load auto-backup config from server
  useEffect(() => {
    fetch('/api/backup/config')
      .then(r => r.json())
      .then((d: { enabled?: boolean }) => { if (d.enabled !== undefined) setAutoBackupEnabled(d.enabled); })
      .catch(() => {});
  }, []);

  // Load notification config from server
  useEffect(() => {
    fetch('/api/notifications/config')
      .then(r => r.json())
      .then((d: { enabled?: boolean }) => { if (d.enabled !== undefined) setNotificationsEnabled(d.enabled); })
      .catch(() => {});
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

  const toggleAutoBackup = useCallback(async () => {
    const next = !autoBackupEnabled;
    setAutoBackupEnabled(next);
    try {
      await fetch('/api/backup/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
    } catch { /* ignore */ }
  }, [autoBackupEnabled]);

  const toggleNotifications = useCallback(async () => {
    const next = !notificationsEnabled;
    setNotificationsEnabled(next);
    try {
      await fetch('/api/notifications/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
    } catch { /* ignore */ }
  }, [notificationsEnabled]);

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
            {/* Automatic Backups toggle */}
            <button
              onClick={toggleAutoBackup}
              className="w-full flex items-center justify-between px-1 py-1.5 rounded hover:bg-gray-700 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm text-gray-300">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 3 8 3s8-.79 8-3V7M4 7c0 2.21 3.582 3 8 3s8-.79 8-3M4 7c0-2.21 3.582-3 8-3s8 .79 8 3" />
                </svg>
                Automatic Backups
              </span>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${autoBackupEnabled ? 'bg-blue-600' : 'bg-gray-600'}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${autoBackupEnabled ? 'translate-x-4' : 'translate-x-1'}`} />
              </span>
            </button>
            <button
              onClick={() => { setOpen(false); setShowBackupPanel(true); }}
              className="w-full text-left px-1 py-0.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Configure Backups →
            </button>
          </div>

          <div className="border-t border-gray-700 mt-0.5" />

          {/* Notifications section */}
          <div className="px-3 py-1.5">
            <button
              onClick={toggleNotifications}
              className="w-full flex items-center justify-between px-1 py-1.5 rounded hover:bg-gray-700 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm text-gray-300">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                Notifications
              </span>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${notificationsEnabled ? 'bg-blue-600' : 'bg-gray-600'}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${notificationsEnabled ? 'translate-x-4' : 'translate-x-1'}`} />
              </span>
            </button>
            <button
              onClick={() => { setOpen(false); setShowNotificationPanel(true); }}
              className="w-full text-left px-1 py-0.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Configure Notifications →
            </button>
          </div>

          <div className="border-t border-gray-700 mt-0.5" />

          {/* Agent Defaults */}
          <div className="px-3 py-1.5">
            <button
              onClick={() => { setOpen(false); setShowAgentDefaults(true); }}
              className="w-full flex items-center gap-2 px-1 py-1.5 rounded hover:bg-gray-700 transition-colors"
            >
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              <span className="text-sm text-gray-300">Agent Defaults</span>
              <svg className="w-3 h-3 text-gray-500 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>

          {/* Security */}
          <div className="px-3 py-1.5">
            <button
              onClick={() => { setOpen(false); setShowSecurity(true); }}
              className="w-full flex items-center gap-2 px-1 py-1.5 rounded hover:bg-gray-700 transition-colors"
            >
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span className="text-sm text-gray-300">Security</span>
              <svg className="w-3 h-3 text-gray-500 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
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

      {/* Backup configuration modal */}
      {showBackupPanel && <BackupPanel onClose={() => setShowBackupPanel(false)} />}
      {/* Notification configuration modal */}
      {showNotificationPanel && <NotificationPanel onClose={() => setShowNotificationPanel(false)} />}
      {/* Security modal */}
      {showSecurity && <SecurityPanel onClose={() => setShowSecurity(false)} />}
      {/* Agent Defaults modal */}
      {showAgentDefaults && (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: '85vh' }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
                <h2 className="text-base font-bold text-gray-900 dark:text-white">Agent Defaults</h2>
              </div>
              <button
                onClick={() => setShowAgentDefaults(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0">
              <AgentDefaults />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
