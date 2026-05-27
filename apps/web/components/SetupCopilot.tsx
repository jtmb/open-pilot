"use client";
import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';

type Step = 'idle' | 'starting' | 'awaiting-auth' | 'activating' | 'done' | 'error';

const SK = 'copilot-setup-state';
const DONE_KEY = 'copilot-authorized';

export default function SetupCopilot() {
  const { data: session } = useSession();
  const [step, setStep] = useState<Step>('idle');
  const [userCode, setUserCode] = useState('');
  const [verificationUri, setVerificationUri] = useState('');
  const [deviceCode, setDeviceCode] = useState('');
  const [error, setError] = useState('');
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!session || started.current) return;
    started.current = true;

    // 1. Persistent done flag (localStorage survives across tabs/refreshes)
    if (typeof window !== 'undefined' && localStorage.getItem(DONE_KEY) === '1') {
      setStep('done');
      return;
    }

    // 2. Check server-side whether credentials already exist
    fetch('/api/setup-vscode')
      .then(r => r.json())
      .then((d: { authorized?: boolean }) => {
        if (d.authorized) {
          if (typeof window !== 'undefined') localStorage.setItem(DONE_KEY, '1');
          setStep('done');
          return;
        }

        // 3. Restore in-progress flow from sessionStorage (survives remounts/navigation)
        try {
          const saved = JSON.parse(sessionStorage.getItem(SK) ?? 'null');
          if (saved?.step === 'awaiting-auth' && saved.deviceCode) {
            setDeviceCode(saved.deviceCode);
            setUserCode(saved.userCode);
            setVerificationUri(saved.verificationUri);
            setStep('awaiting-auth');
            pollTimer.current = setInterval(() => poll(saved.deviceCode, saved.interval ?? 5), (saved.interval ?? 5) * 1000);
            return;
          }
        } catch { /* ignore corrupt storage */ }

        startFlow();
      })
      .catch(() => startFlow());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => () => { if (pollTimer.current) clearInterval(pollTimer.current); }, []);

  async function startFlow() {
    setStep('starting');
    setError('');
    try {
      const res = await fetch('/api/setup-vscode', { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? 'Failed to start device flow');

      const state = { step: 'awaiting-auth', deviceCode: data.deviceCode, userCode: data.userCode, verificationUri: data.verificationUri, interval: data.interval ?? 5 };
      sessionStorage.setItem(SK, JSON.stringify(state));

      setDeviceCode(data.deviceCode);
      setUserCode(data.userCode);
      setVerificationUri(data.verificationUri);
      setStep('awaiting-auth');

      window.open(data.verificationUri, '_blank', 'noopener,noreferrer');
      const iv = data.interval ?? 5;
      pollTimer.current = setInterval(() => poll(data.deviceCode, iv), iv * 1000);
    } catch (e: any) {
      setError(e.message);
      setStep('error');
    }
  }

  async function poll(dc: string, iv: number) {
    const username = (session?.user?.name ?? session?.user?.email ?? 'user') as string;
    try {
      const res = await fetch(`/api/setup-vscode/poll?device_code=${encodeURIComponent(dc)}&username=${encodeURIComponent(username)}`);
      const data = await res.json();

      if (data.status === 'authorized') {
        clearInterval(pollTimer.current!);
        sessionStorage.setItem(SK, JSON.stringify({ step: 'done' }));
        if (typeof window !== 'undefined') localStorage.setItem(DONE_KEY, '1');
        setStep('activating');
        setTimeout(() => setStep('done'), 12_000);
      } else if (data.status === 'slow_down') {
        clearInterval(pollTimer.current!);
        pollTimer.current = setInterval(() => poll(dc, data.interval), data.interval * 1000);
      } else if (data.status === 'expired' || data.status === 'error') {
        // Code expired or invalid — clear and auto-restart with a fresh code
        clearInterval(pollTimer.current!);
        sessionStorage.removeItem(SK);
        started.current = false;
        setStep('idle');
        if (session) { started.current = true; startFlow(); }
      }
    } catch { /* ignore transient network errors */ }
  }

  function retry() {
    sessionStorage.removeItem(SK);
    started.current = false;
    setStep('idle');
    if (pollTimer.current) clearInterval(pollTimer.current);
    if (session) { started.current = true; startFlow(); }
  }

  if (!session || step === 'idle' || step === 'done') return null;

  if (step === 'starting')
    return <Banner color="purple">Starting Copilot authorization…</Banner>;

  if (step === 'activating')
    return <Banner color="purple">Authorized — connecting Copilot to code-server (restarting, ~10 s)…</Banner>;

  if (step === 'error')
    return (
      <Banner color="red">
        Copilot setup failed: {error}&nbsp;
        <button onClick={retry} className="underline text-blue-700 ml-1">Retry</button>
      </Banner>
    );

  return (
    <div className="w-full bg-yellow-50 border-b border-yellow-300 px-6 py-2.5 flex items-center gap-4 text-sm flex-wrap">
      <span className="text-yellow-900 shrink-0">
        GitHub Copilot needs authorization — code&nbsp;
        <strong className="font-mono text-base tracking-widest bg-yellow-100 px-1 rounded">{userCode}</strong>
        &nbsp;is pre-filled.&nbsp;
        <span className="font-semibold">Click "Authorize GitHub Copilot" on the page that opens.</span>
      </span>
      <a
        href={verificationUri || 'https://github.com/login/device'}
        target="_blank"
        rel="noopener noreferrer"
        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded font-medium shrink-0"
      >
        Open GitHub ↗
      </a>
      <span className="text-yellow-700 text-xs animate-pulse">Waiting…</span>
      <button onClick={retry} className="ml-auto text-xs text-gray-400 hover:text-gray-700 underline shrink-0">
        New code
      </button>
    </div>
  );
}

function Banner({ color, children }: { color: 'purple' | 'red'; children: React.ReactNode }) {
  const cls = color === 'purple'
    ? 'bg-purple-50 border-purple-200 text-purple-700'
    : 'bg-red-50 border-red-200 text-red-700';
  return (
    <div className={`w-full border-b px-6 py-2 text-sm animate-pulse ${cls}`}>
      {children}
    </div>
  );
}
