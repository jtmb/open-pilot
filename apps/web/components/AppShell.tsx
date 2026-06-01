'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SessionProvider, useSession } from 'next-auth/react';
import LoginScreen from './LoginScreen';
import Sidebar, { type Conversation } from './Sidebar';
import Dashboard from './Dashboard';
import ApiKeysManager from './ApiKeysManager';
import ChatBox, { type ConversationData } from './ChatBox';
import Documentation from './Documentation';
import { type Mode, type CopilotModel } from './ModelSelector';
import JobStatus from './JobStatus';
import AuthUI from './AuthUI';
import SetupCopilot from './SetupCopilot';
import AgentWorkspace from './AgentWorkspace';
import NewRunModal from './NewRunModal';
import AssistantBot from './AssistantBot';
import type { AgentRun } from '@/services/agentOrchestrator';

const ACTIVE_KEY       = 'openpilot_active_id';
const ACTIVE_RUN_KEY   = 'openpilot_active_run';
const MODEL_KEY        = 'openpilot_model';
const MODE_KEY         = 'openpilot_mode';
const EFFORT_KEY       = 'openpilot_effort';

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function AppShellInner() {
  const { data: session, status: sessionStatus } = useSession();
  const [hasCredentials, setHasCredentials] = useState(false);
  const [credChecked, setCredChecked] = useState(false);
  // Failsafe: if either the credentials fetch or the NextAuth session check
  // hangs for any reason, force the UI to render after 6 seconds.
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5_000);
    fetch('/api/auth/github-credentials', { signal: ctrl.signal })
      .then(r => r.json())
      .then((d: { hasCredentials: boolean }) => {
        setHasCredentials(d.hasCredentials);
        setCredChecked(true);
      })
      .catch(() => setCredChecked(true))
      .finally(() => clearTimeout(timer));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setLoadingTimedOut(true), 6_000);
    return () => clearTimeout(t);
  }, []);

  const [activeTab, setActiveTab] = useState<'dashboard' | 'chat' | 'docs' | 'autopilot' | 'apikeys'>('chat');
  const [model, setModel] = useState('');
  const [mode, setMode]   = useState<Mode>('ask');
  const [reasoningEffort, setReasoningEffort] = useState('');

  // Conversations — loaded from DB
  const [conversations, setConversations] = useState<ConversationData[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // Track which conversation IDs have had full messages loaded
  const loadedRef = useRef<Set<string>>(new Set());

  // Agent runs — persisted in DB
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [showNewRunModal, setShowNewRunModal] = useState(false);
  const [newRunPrefill, setNewRunPrefill] = useState<{ spec?: string; title?: string } | null>(null);

  // ── Backend health status ─────────────────────────────────────────────────
  const [backendStatus, setBackendStatus] = useState<{ db: boolean; codeServer: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch('/api/health/services', { signal: AbortSignal.timeout(5_000) });
        const data = await res.json() as { db: boolean; codeServer: boolean };
        if (!cancelled) setBackendStatus({ db: !!data.db, codeServer: !!data.codeServer });
      } catch {
        if (!cancelled) setBackendStatus({ db: false, codeServer: false });
      }
    }
    check();
    const interval = setInterval(check, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // ── Initial load ─────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      // Helper: fetch with a 10-second timeout so a hung endpoint never blocks hydration
      function fetchWithTimeout(url: string, opts?: RequestInit): Promise<Response> {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10_000);
        return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
      }

      // Load conversations and runs in parallel so neither can block the other
      const [convsResult, runsResult] = await Promise.allSettled([
        fetchWithTimeout('/api/conversations').then(r => r.json() as Promise<{ conversations?: ConversationData[] }>),
        fetchWithTimeout('/api/runs').then(r => r.json() as Promise<{ runs?: AgentRun[] }>),
      ]);

      // ── Process conversations ────────────────────────────────────────────
      if (convsResult.status === 'fulfilled') {
        const list = convsResult.value.conversations ?? [];
        const storedActiveId = localStorage.getItem(ACTIVE_KEY);
        if (list.length > 0) {
          setConversations(list);
          const target = list.find(c => c.id === storedActiveId) ?? list[0];
          setActiveId(target.id);
        } else {
          // First run — create a default conversation
          const first: ConversationData = { id: makeId(), title: 'New chat', createdAt: Date.now(), messages: [] };
          fetch('/api/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(first),
          }).catch(() => {});
          setConversations([first]);
          setActiveId(first.id);
          loadedRef.current.add(first.id);
        }
      } else {
        // DB not ready yet — fall back to a local placeholder
        const first: ConversationData = { id: makeId(), title: 'New chat', createdAt: Date.now(), messages: [] };
        setConversations([first]);
        setActiveId(first.id);
        loadedRef.current.add(first.id);
      }

      // ── Process runs ─────────────────────────────────────────────────────
      // Any run still marked 'running' means the server was killed mid-execution —
      // transition it to 'error' so AgentWorkspace can auto-resume it.
      let rawRuns: AgentRun[] = [];
      if (runsResult.status === 'fulfilled') {
        rawRuns = runsResult.value.runs ?? [];
      }
      const storedRuns = rawRuns.map(r => {
        if (r.status !== 'running') return r;
        return {
          ...r,
          status: 'error' as const,
          log: [
            ...r.log,
            {
              id: Date.now().toString(36) + Math.random().toString(36).slice(2),
              timestamp: Date.now(),
              from: 'system' as const,
              type: 'status' as const,
              content: '⚠ Run was interrupted by a server restart. Auto-resuming…',
              target: 'both' as const,
            },
          ],
          updatedAt: Date.now(),
        };
      });
      setAgentRuns(storedRuns);
      // Persist any runs that were normalised (running→error) back to DB
      for (const r of storedRuns) {
        const original = rawRuns.find(o => o.id === r.id);
        if (original && original.status !== r.status) {
          fetch(`/api/runs/${r.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(r),
          }).catch(() => {});
        }
      }
      const storedRunId = localStorage.getItem(ACTIVE_RUN_KEY);
      if (storedRunId && storedRuns.find(r => r.id === storedRunId)) {
        setActiveRunId(storedRunId);
      } else if (storedRuns.length > 0) {
        setActiveRunId(storedRuns[0].id);
      }

      setHydrated(true);
    })();
  }, []);

  // ── Lazy-load full messages when active conversation changes ─────────────
  useEffect(() => {
    if (!activeId || loadedRef.current.has(activeId)) return;
    (async () => {
      try {
        const res = await fetch(`/api/conversations/${activeId}`);
        if (!res.ok) return;
        const data = await res.json() as { conversation?: ConversationData };
        if (data.conversation) {
          loadedRef.current.add(activeId);
          setConversations(prev =>
            prev.map(c => c.id === activeId ? data.conversation! : c),
          );
        }
      } catch { /* silently ignore */ }
    })();
  }, [activeId]);

  // ── Persist active IDs ───────────────────────────────────────────────────
  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
  }, [activeId]);

  // (runs are persisted per-change in handlers below — no batch save needed)

  useEffect(() => {
    if (activeRunId) localStorage.setItem(ACTIVE_RUN_KEY, activeRunId);
  }, [activeRunId]);

  // ── Persist & restore model/mode/effort ─────────────────────────────────
  useEffect(() => {
    const savedModel  = localStorage.getItem(MODEL_KEY);
    const savedMode   = localStorage.getItem(MODE_KEY) as Mode | null;
    const savedEffort = localStorage.getItem(EFFORT_KEY);
    if (savedModel)  setModel(savedModel);
    if (savedMode && ['ask', 'plan', 'agent'].includes(savedMode)) setMode(savedMode);
    if (savedEffort !== null) setReasoningEffort(savedEffort);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (model)  localStorage.setItem(MODEL_KEY, model); }, [model]);
  useEffect(() => { localStorage.setItem(MODE_KEY, mode); }, [mode]);
  useEffect(() => { localStorage.setItem(EFFORT_KEY, reasoningEffort); }, [reasoningEffort]);

  // ── Conversation handlers ────────────────────────────────────────────────

  // Called by ChatBox on every message update
  const handleUpdate = useCallback((updated: ConversationData) => {
    setConversations(prev => prev.map(c => c.id === updated.id ? updated : c));
    // Persist to DB (fire and forget)
    fetch(`/api/conversations/${updated.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: updated.title, messages: updated.messages }),
    }).catch(() => {});
  }, []);

  const handleNew = useCallback(async () => {
    const conv: ConversationData = { id: makeId(), title: 'New chat', createdAt: Date.now(), messages: [] };
    try {
      await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(conv),
      });
    } catch { /* optimistic — still add locally */ }
    loadedRef.current.add(conv.id);
    setConversations(prev => [conv, ...prev]);
    setActiveId(conv.id);
    setActiveTab('chat');
  }, []);

  const handleSelect = useCallback((id: string) => {
    setActiveId(id);
    setActiveTab('chat');
  }, []);

  const handleDelete = useCallback((id: string) => {
    fetch(`/api/conversations/${id}`, { method: 'DELETE' }).catch(() => {});
    loadedRef.current.delete(id);
    setConversations(prev => {
      const next = prev.filter(c => c.id !== id);
      if (next.length === 0) {
        const fresh: ConversationData = { id: makeId(), title: 'New chat', createdAt: Date.now(), messages: [] };
        fetch('/api/conversations', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fresh),
        }).catch(() => {});
        loadedRef.current.add(fresh.id);
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  }, [activeId]);

  // ── Agent run handlers ───────────────────────────────────────────────────
  const handleNewRun = useCallback((run: AgentRun) => {
    setAgentRuns(prev => [run, ...prev]);
    setActiveRunId(run.id);
    setShowNewRunModal(false);
    setActiveTab('autopilot');
    // Persist to DB
    fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(run),
    }).catch(() => {});
  }, []);

  const handleRunUpdate = useCallback((updated: AgentRun) => {
    setAgentRuns(prev => prev.map(r => r.id === updated.id ? updated : r));
    // Persist to DB (fire and forget — called on every agent step)
    fetch(`/api/runs/${updated.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).catch(() => {});
  }, []);

  const handleRunDelete = useCallback(() => {
    if (!activeRunId) return;
    const runId = activeRunId;

    // Fire-and-forget: stop preview + delete workspace files in code-server
    fetch('/api/exec', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId }),
    }).catch(() => {});

    // Remove from DB
    fetch(`/api/runs/${runId}`, { method: 'DELETE' }).catch(() => {});

    setAgentRuns(prev => {
      const next = prev.filter(r => r.id !== runId);
      setActiveRunId(next.length > 0 ? next[0].id : null);
      return next;
    });
  }, [activeRunId]);

  // Sidebar needs only title + id + createdAt
  const sidebarConvs: Conversation[] = conversations.map(c => ({
    id: c.id, title: c.title, createdAt: c.createdAt,
  }));

  const activeConversation = conversations.find(c => c.id === activeId) ?? conversations[0];

  // Show loading spinner while we check credentials and session status.
  // The 6-second failsafe (loadingTimedOut) prevents an infinite spinner if
  // either the credentials fetch or the NextAuth session check hangs.
  if (!loadingTimedOut && (!credChecked || sessionStatus === 'loading')) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    );
  }

  // Always require authentication — even on first boot before OAuth is configured
  if (!session) {
    return <LoginScreen hasCredentials={hasCredentials} />;
  }

  return (
    <>
      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar
          conversations={sidebarConvs}
          activeId={activeId}
          onNew={handleNew}
          onSelect={handleSelect}
          onDelete={handleDelete}
          setActiveTab={setActiveTab}
          activeTab={activeTab}
          agentRuns={agentRuns}
          activeRunId={activeRunId}
          onSelectRun={(id) => { setActiveRunId(id); setActiveTab('autopilot'); }}
          onNewRun={() => setShowNewRunModal(true)}
          backendStatus={backendStatus}
        />

        <main className="flex-1 flex flex-col bg-gray-50 dark:bg-gray-800 min-w-0">
          <header className="flex items-center justify-between px-6 py-3 border-b bg-white dark:bg-gray-800 dark:border-gray-700 shrink-0">
            <h1 className="text-xl font-bold dark:text-white">OpenPilot for VS Code</h1>
            <div className="flex items-center gap-3">
              <JobStatus />
              <AuthUI />
            </div>
          </header>

          <SetupCopilot />

          {/* ── Backend offline banner ─────────────────────────────────────── */}
          {backendStatus && (!backendStatus.db || !backendStatus.codeServer) && (() => {
            const issues: string[] = [];
            if (!backendStatus.db)          issues.push('database');
            if (!backendStatus.codeServer)  issues.push('code-server container');
            const affected = [
              !backendStatus.db ? 'Chat, API Keys and Auto Pilot' : null,
              !backendStatus.codeServer && backendStatus.db ? 'Auto Pilot' : null,
            ].filter(Boolean).join(', ');
            return (
              <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-red-600 text-white text-xs">
                <span className="text-base">⚠️</span>
                <span>
                  <strong>Backend unreachable:</strong> {issues.join(' and ')} {issues.length > 1 ? 'are' : 'is'} offline.
                  {affected && <> {affected} {affected.includes(',') ? 'are' : 'is'} disabled until the connection is restored.</>}
                </span>
              </div>
            );
          })()}

          <section className="flex-1 overflow-hidden relative">
            {activeTab === 'dashboard' && <Dashboard agentRuns={agentRuns} conversations={conversations} onSelectRun={(id) => { setActiveRunId(id); setActiveTab('autopilot'); }} onSelectConv={(id) => { setActiveId(id); setActiveTab('chat'); }} />}
            {activeTab === 'docs'      && <Documentation />}
            {activeTab === 'apikeys'   && <ApiKeysManager />}

            {activeTab === 'chat'      && hydrated && activeConversation && (
              <ChatBox
                key={activeConversation.id}
                conversation={activeConversation}
                model={model}
                mode={mode}
                reasoningEffort={reasoningEffort}
                onUpdate={handleUpdate}
                onModelChange={(id: string, meta: CopilotModel | undefined) => {
                  setModel(id);
                  if (meta?.reasoningEffort.length) {
                    setReasoningEffort(meta.reasoningEffort.includes('medium') ? 'medium' : meta.reasoningEffort[0]);
                  } else {
                    setReasoningEffort('');
                  }
                }}
                onModeChange={setMode}
                onReasoningEffortChange={setReasoningEffort}
              />
            )}

            {/* Empty state when on autopilot tab with no valid active run */}
            {activeTab === 'autopilot' && hydrated && !agentRuns.find(r => r.id === activeRunId) && (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
                <span className="text-4xl">🤖</span>
                <p className="text-sm">No agent runs yet.</p>
                <button
                  onClick={() => setShowNewRunModal(true)}
                  className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                >
                  + New Run
                </button>
              </div>
            )}

            {/* Agent workspaces — kept mounted for all running/error runs so execution
                loops survive tab switches and navigation. Visible only when the user is
                on the autopilot tab and the run is the selected one. */}
            {hydrated && agentRuns.map(run => {
              const isActive    = activeTab === 'autopilot' && run.id === activeRunId;
              const keepMounted = run.status === 'running' || run.status === 'error';
              if (!isActive && !keepMounted) return null;
              return (
                <div
                  key={run.id}
                  className={isActive ? 'absolute inset-0' : 'hidden'}
                  aria-hidden={!isActive}
                >
                  <AgentWorkspace
                    run={run}
                    onUpdate={handleRunUpdate}
                    onDelete={handleRunDelete}
                    onNewPersonalityRun={(spec, title) => {
                      setNewRunPrefill({ spec, title });
                      setShowNewRunModal(true);
                    }}
                  />
                </div>
              );
            })}
          </section>
        </main>
      </div>
      {showNewRunModal && (
        <NewRunModal
          onStart={handleNewRun}
          onClose={() => { setShowNewRunModal(false); setNewRunPrefill(null); }}
          initialSpec={newRunPrefill?.spec}
          initialTitle={newRunPrefill?.title}
        />
      )}
      <AssistantBot
        activeTab={activeTab}
        onNavigate={(tab) => setActiveTab(tab)}
        onNewRun={() => setShowNewRunModal(true)}
        onNewChat={handleNew}
      />
    </>
  );
}

export default function AppShell() {
  return (
    <SessionProvider>
      <AppShellInner />
    </SessionProvider>
  );
}
