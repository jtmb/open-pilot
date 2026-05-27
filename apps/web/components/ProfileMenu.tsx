'use client';
import { signIn, signOut, useSession } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';

export default function ProfileMenu() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
