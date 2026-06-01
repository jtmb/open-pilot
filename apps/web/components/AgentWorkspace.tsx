'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import AgentPanel from './AgentPanel';
import FilesModal from './FilesModal';
import MonitorPanel, { type DisplayFinding } from './MonitorPanel';
import { bestFreeModel, type CopilotModel } from './ModelSelector';
import {
  applyReply,
  getStepPayload,
  getSystemPrompts,
  logEntry,
  makeLogId,
  parseTokens,
  personalities,
  type AgentRun,
  type Checkpoint,
  type PersonalityId,
  type RunStatus,
} from '@/services/agentOrchestrator';
import CheckpointsPanel from './CheckpointsPanel';
import PlanPanel from './PlanPanel';
import GitHubPushModal from './GitHubPushModal';
import type { ParsedFile } from '@/utils/fileParser';

// ─── Format monitor findings into a manager advisory message ──────────────────
function formatAdvisory(findings: DisplayFinding[]): string {
  const lines = findings.map(f => {
    const icon = f.severity === 'error' ? '🔴' : f.severity === 'warning' ? '🟡' : '🔵';
    return `${icon} [${f.category}] ${f.message}`;
  });
  return `[Monitor Advisory — consider these observations before deciding your next action]
${lines.join('\n')}`;
}

// ─── Infer the next step when resuming a run with no nextStep ───────────────────
function inferNextStep(run: AgentRun): NonNullable<typeof run.nextStep> {
  const lastWorker  = run.workerHistory[run.workerHistory.length - 1];
  const lastManager = run.managerHistory[run.managerHistory.length - 1];
  if (lastWorker?.role  === 'assistant') return 'manager-review';
  if (lastManager?.role === 'assistant') return 'worker-execute';
  return 'manager-init';
}

// ─── Client-side rule engine (instant, no API cost) ───────────────────────────

function runClientRules(run: AgentRun): DisplayFinding[] {
  const findings: DisplayFinding[] = [];
  const iter = run.currentIteration;

  // 1. Loop detection — same correction content sent twice in a row
  const corrections = run.log.filter(e => e.type === 'correction');
  if (corrections.length >= 2) {
    const last = corrections[corrections.length - 1].content.trim();
    const prev = corrections[corrections.length - 2].content.trim();
    if (last.slice(0, 120) === prev.slice(0, 120)) {
      findings.push({
        id: Math.random().toString(36).slice(2),
        severity: 'error',
        category: 'loop',
        message: 'Manager sent the same correction twice — infinite loop detected.',
        iteration: iter,
        source: 'rule',
      });
    }
  }

  // 2. High correction rate — 3+ corrections in the last 10 entries
  const recentCorrCount = run.log.slice(-10).filter(e => e.type === 'correction').length;
  if (recentCorrCount >= 3) {
    findings.push({
      id: Math.random().toString(36).slice(2),
      severity: 'warning',
      category: 'loop',
      message: `${recentCorrCount} corrections in the last 10 steps — consider steering via the inject box.`,
      iteration: iter,
      source: 'rule',
    });
  }

  // 3. Manager reply has no recognized token — run will stall
  const lastMgrEntry = [...run.log].reverse().find(
    e => (e.type === 'directive' || e.type === 'answer') && e.from === 'manager',
  );
  if (lastMgrEntry) {
    const t = lastMgrEntry.content;
    const hasToken =
      /\[NEXT_TASK:/.test(t) ||
      /\[CORRECTION:/.test(t) ||
      /\[ANSWER:/.test(t)     ||
      /\[COMPLETE\]/.test(t)  ||
      /\[PLAN:/.test(t);       // first-response planning token is valid
    if (!hasToken) {
      findings.push({
        id: Math.random().toString(36).slice(2),
        severity: 'error',
        category: 'compliance',
        message: 'Manager reply contains no recognized token — run will stall. Use the inject box to steer.',
        iteration: iter,
        source: 'rule',
      });
    }
  }

  // 4. Worker output missing [DONE]
  // Skip the check if the response ends with [EXEC:] — [DONE] comes after the exec result.
  const lastWorkerOut = [...run.log].reverse().find(
    e => e.type === 'output' && e.from === 'worker',
  );
  if (
    lastWorkerOut &&
    !/\[DONE\]/.test(lastWorkerOut.content) &&
    !/\[EXEC:/.test(lastWorkerOut.content)
  ) {
    findings.push({
      id: Math.random().toString(36).slice(2),
      severity: 'info',
      category: 'compliance',
      message: 'Worker response is missing [DONE] — the task may be incomplete.',
      iteration: iter,
      source: 'rule',
    });
  }

  // 5. Approaching max iterations (>= 80%)
  if (
    run.config.maxIterations > 0 &&
    run.currentIteration >= Math.floor(run.config.maxIterations * 0.8)
  ) {
    findings.push({
      id: Math.random().toString(36).slice(2),
      severity: 'warning',
      category: 'suggestion',
      message: `Approaching max iterations (${run.currentIteration}/${run.config.maxIterations}). Consider raising the limit.`,
      iteration: iter,
      source: 'rule',
    });
  }

  return findings;
}

interface Props {
  run: AgentRun;
  onUpdate: (run: AgentRun) => void;
  onDelete: () => void;
  onNewPersonalityRun?: (spec: string, title: string) => void;
}

const STATUS_BADGE: Record<RunStatus, { label: string; cls: string }> = {
  idle:     { label: 'Idle',     cls: 'bg-gray-100 text-gray-600'   },
  running:  { label: 'Running',  cls: 'bg-green-100 text-green-700' },
  paused:   { label: 'Paused',   cls: 'bg-yellow-100 text-yellow-700' },
  complete: { label: 'Complete', cls: 'bg-blue-100 text-blue-700'   },
  error:    { label: 'Error',    cls: 'bg-red-100 text-red-700'     },
};

export default function AgentWorkspace({ run: initialRun, onUpdate, onDelete, onNewPersonalityRun }: Props) {
  const [run, setRun] = useState<AgentRun>(initialRun);
  const [isStepping, setIsStepping] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [injectTarget, setInjectTarget] = useState<'worker' | 'manager'>('worker');
  const [injectText, setInjectText] = useState('');
  const [injectLoading, setInjectLoading] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [checkpointsOpen, setCheckpointsOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [hideCheckpointLogs, setHideCheckpointLogs] = useState(true);
  const [highlightedEntryId, setHighlightedEntryId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [restartConfirm, setRestartConfirm] = useState(false);
  const [continueSpec, setContinueSpec] = useState('');
  const [continueAiLoading, setContinueAiLoading] = useState(false);
  const [continuePersonality, setContinuePersonality] = useState<string>(initialRun.config.category ?? 'developer');
  const [continueExpanded, setContinueExpanded] = useState(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Monitor state
  const monitorKey = `openpilot:monitor:${initialRun.id}`;
  const [monitorOpen, setMonitorOpen]           = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem(monitorKey) ?? 'null')?.open ?? false; } catch { return false; }
  });
  const [monitorAiEnabled, setMonitorAiEnabled] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem(monitorKey) ?? 'null')?.aiEnabled ?? true; } catch { return true; }
  });
  const [allFindings, setAllFindings]           = useState<DisplayFinding[]>(() => {
    try { return JSON.parse(localStorage.getItem(monitorKey) ?? 'null')?.findings ?? []; } catch { return []; }
  });
  const [isAnalyzing, setIsAnalyzing]           = useState(false);
  const [monitorModel, setMonitorModel]         = useState(() =>
    (typeof window !== 'undefined' && localStorage.getItem('openpilot:monitorModel')) || 'gpt-4o'
  );
  const [monitorModels, setMonitorModels]       = useState<CopilotModel[]>([]);
  // Deduplicate rule findings: skip if exact same message fired within last 3 iterations
  const seenRules          = useRef<Map<string, number>>(new Map());
  const modelsFetched      = useRef(false);
  // Accumulates findings to inject as advisory into the next manager step
  const pendingAdvisoryRef = useRef<DisplayFinding[]>([]);

  // GitHub push state (transient — not persisted)
  const [showPushModal, setShowPushModal] = useState(false);
  const [pushState, setPushState] = useState<{ status: 'idle' | 'pushing' | 'success' | 'error'; url?: string; message?: string }>({ status: 'idle' });

  // Delete confirmation state
  const [deletePhase, setDeletePhase] = useState<'idle' | 'confirm'>('idle');
  const [deletingRepo, setDeletingRepo] = useState(false);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Workspace existence — null = unknown, true/false after check
  const [workspaceExists, setWorkspaceExists] = useState<boolean | null>(null);

  // Training: accumulated token counts and run-persist state
  const tokenAccumRef = useRef({ prompt: 0, completion: 0 });
  const [savedRunId, setSavedRunId]   = useState<string | null>(null);
  const [userRating,  setUserRating]  = useState<1 | -1 | null>(null);

  const { data: session } = useSession();

  // Refs to access latest values inside async loops without stale closures
  const runRef            = useRef<AgentRun>(run);
  const loopRef           = useRef(false);

  const setRunAndSync = useCallback((newRun: AgentRun) => {
    runRef.current = newRun;
    setRun(newRun);
    onUpdate(newRun);
  }, [onUpdate]);

  // Open this run's workspace in code-server, checking existence first.
  const openCodeServerWorkspace = useCallback(async () => {
    const r = runRef.current;
    const base = `${window.location.protocol}//${window.location.hostname}:8080`;
    const folderUrl = `${base}/?folder=/home/coder/workspace/${r.id}`;
    try {
      const res = await fetch(`/api/exec/workspace-exists?runId=${encodeURIComponent(r.id)}`);
      const data = await res.json() as { exists?: boolean };
      if (data.exists === false) {
        setWorkspaceExists(false);
        setTimeout(() => setWorkspaceExists(null), 5000);
        return;
      }
    } catch { /* fall through — open anyway if check fails */ }
    setWorkspaceExists(true);
    window.open(folderUrl, '_blank', 'noopener,noreferrer');
  }, []);

  // Auto-open the plan panel the first time the manager creates a plan
  const planLengthRef = useRef(initialRun.plan?.length ?? 0);
  useEffect(() => {
    const newLen = run.plan?.length ?? 0;
    if (newLen > 0 && planLengthRef.current === 0) {
      setPlanOpen(true);
    }
    planLengthRef.current = newLen;
  }, [run.plan?.length]);

  // ── Normalize stale 'running' status left over from a container/page restart ──
  useEffect(() => {
    const r = runRef.current;
    if (r.status === 'running') {
      setRunAndSync({
        ...r,
        status: 'paused',
        log: [
          ...r.log,
          logEntry('system', 'status', '⚠️ Session interrupted — click Resume to continue.', 'both'),
        ],
        updatedAt: Date.now(),
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When monitor models load, pick best free model (unless user already has a saved preference)
  useEffect(() => {
    if (monitorModels.length === 0) return;
    const saved = typeof window !== 'undefined' ? localStorage.getItem('openpilot:monitorModel') : null;
    if (!saved || !monitorModels.some(m => m.id === saved)) {
      const best = bestFreeModel(monitorModels);
      if (best) setMonitorModel(best.id);
    }
  }, [monitorModels]);

  // Fetch monitor models whenever the panel is open (handles the case where it was open on mount)
  useEffect(() => {
    if (!monitorOpen) return;
    if (modelsFetched.current) return;
    modelsFetched.current = true;
    fetch('/api/models')
      .then(r => r.json())
      .then((data: { models?: CopilotModel[] }) => {
        if (data.models?.length) setMonitorModels(data.models);
      })
      .catch(() => {});
  }, [monitorOpen]);

  const handleMonitorModelChange = useCallback((id: string) => {
    setMonitorModel(id);
    if (typeof window !== 'undefined') localStorage.setItem('openpilot:monitorModel', id);
  }, []);

  // ── Persist monitor state ────────────────────────────────────────────────
  useEffect(() => {
    try {
      localStorage.setItem(monitorKey, JSON.stringify({ open: monitorOpen, aiEnabled: monitorAiEnabled, findings: allFindings }));
    } catch { /* quota */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monitorOpen, monitorAiEnabled, allFindings]);

  // ── Status-change notifications ──────────────────────────────────────────
  const prevStatusRef = useRef<string>(run.status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    const current = run.status;
    prevStatusRef.current = current;
    // Only fire when transitioning into a terminal/notable state (not on mount)
    if (prev === current) return;
    const fireNotification = (event: string, title: string, message: string) => {
      fetch('/api/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, title, message }),
      }).catch(() => {});
    };
    if (current === 'error') {
      fireNotification('agentError', `Agent Run Error: ${run.title}`, `The agent run "${run.title}" encountered an error after ${run.currentIteration} steps.`);
    } else if (current === 'complete') {
      fireNotification('agentComplete', `Agent Run Complete: ${run.title}`, `The agent run "${run.title}" finished successfully after ${run.currentIteration} steps.`);
    } else if (current === 'paused' && prev === 'running') {
      fireNotification('agentPaused', `Agent Run Paused: ${run.title}`, `The agent run "${run.title}" was paused after ${run.currentIteration} steps.`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.status]);

  // ── Persist run to DB on terminal state ──────────────────────────────────
  const persistKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const TERMINAL = new Set(['complete', 'error']);
    if (!TERMINAL.has(run.status)) return;
    const key = `${run.id}:${run.status}`;
    if (persistKeyRef.current === key) return;
    persistKeyRef.current = key;
    fetch('/api/runs/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        run,
        tokenPromptTotal:     tokenAccumRef.current.prompt,
        tokenCompletionTotal: tokenAccumRef.current.completion,
        monitorFindings:      JSON.stringify(allFindings),
      }),
    })
      .then(r => r.json() as Promise<{ ok: boolean; id?: string }>)
      .then(d => { if (d.ok && d.id) setSavedRunId(d.id); })
      .catch(() => {});

    // Phase 5: auto-record completed runs to AgentRunRecord for benchmarking
    if (run.status === 'complete') {
      fetch('/api/training/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run,
          tokenPromptTotal:     tokenAccumRef.current.prompt,
          tokenCompletionTotal: tokenAccumRef.current.completion,
          monitorFindings:      JSON.stringify(allFindings),
        }),
      })
        .then(r => r.json() as Promise<{ ok: boolean; id?: string }>)
        .then(d => {
          // Auto-score the run now that the record exists
          if (d.ok && d.id) {
            fetch('/api/training/score', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ runId: d.id }),
            }).catch(() => {});
          }
        })
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.status]);

  const handleRate = useCallback((rating: 1 | -1) => {
    if (!savedRunId || userRating !== null) return;
    setUserRating(rating);
    fetch(`/api/runs/${savedRunId}/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating }),
    }).catch(() => {});
  }, [savedRunId, userRating]);

  // ── Monitor helpers ──────────────────────────────────────────────────────

  const addRuleFindings = useCallback((findings: DisplayFinding[], currentIter: number) => {
    const fresh = findings.filter(f => {
      const key = `${f.category}:${f.message.slice(0, 60)}`;
      const last = seenRules.current.get(key);
      if (last !== undefined && currentIter - last < 3) return false;
      seenRules.current.set(key, currentIter);
      return true;
    });
    if (fresh.length > 0) {
      setAllFindings(prev => [...prev, ...fresh]);
      pendingAdvisoryRef.current.push(...fresh);
      // Auto-open on first error
      if (fresh.some(f => f.severity === 'error')) setMonitorOpen(true);
    }
  }, []);

  const triggerAiMonitor = useCallback(async (updatedRun: AgentRun, model: string) => {
    setIsAnalyzing(true);
    try {
      const recentLog = updatedRun.log.slice(-6).map(e => ({
        from:    e.from,
        type:    e.type,
        content: e.content,
      }));
      const correctionCount = updatedRun.log.filter(e => e.type === 'correction').length;
      const questionCount   = updatedRun.log.filter(e => e.type === 'question').length;

      const res = await fetch('/api/agents/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          iteration:       updatedRun.currentIteration,
          status:          updatedRun.status,
          recentLog,
          correctionCount,
          questionCount,
          workerModel:     updatedRun.config.workerModel,
          managerModel:    updatedRun.config.managerModel,
          model,
        }),
      });

      const data = await res.json() as {
        findings: Array<{ severity: string; category: string; message: string }>;
      };

      const aiFindings: DisplayFinding[] = (data.findings ?? []).map(f => ({
        id:        Math.random().toString(36).slice(2),
        severity:  f.severity as DisplayFinding['severity'],
        category:  f.category,
        message:   f.message,
        iteration: updatedRun.currentIteration,
        source:    'ai' as const,
      }));

      if (aiFindings.length > 0) {
        setAllFindings(prev => [...prev, ...aiFindings]);
        pendingAdvisoryRef.current.push(...aiFindings);
        if (aiFindings.some(f => f.severity === 'error')) setMonitorOpen(true);
      }
    } catch {
      // Never let monitor errors affect the run
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  // ── Core step function ────────────────────────────────────────────────────

  const executeOneStep = useCallback(async (currentRun: AgentRun, advisory?: string): Promise<AgentRun | null> => {
    const payload = getStepPayload(currentRun);
    if (!payload) return null;

    const cfg = currentRun.config;
    const model           = payload.isWorker ? cfg.workerModel           : cfg.managerModel;
    const reasoningEffort = payload.isWorker ? cfg.workerReasoningEffort : cfg.managerReasoningEffort;

    // Inject monitor advisory into manager steps (appended to last user message)
    let messages = payload.messages;
    let wsSnapshotForLog: string | null = null;
    if (!payload.isWorker && advisory) {
      const last = messages[messages.length - 1];
      messages = [
        ...messages.slice(0, -1),
        { ...last, content: last.content + '\n\n' + advisory },
      ];
    }

    // Phase 1A: inject workspace file listing at the start of each new task
    // (ephemeral — not stored in history, just prepended to this LLM call)
    if (payload.isWorker) {
      const lastUserMsg = currentRun.workerHistory.filter(m => m.role === 'user').at(-1);
      if (lastUserMsg?.content.startsWith('Task: ')) {
        try {
          const listRes = await fetch('/api/exec', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              command: 'find . -not -path \'*/node_modules/*\' -not -path \'*/.git/*\' -type f 2>/dev/null | sort | head -60',
              runId: currentRun.id,
            }),
          });
          const { output: wsOutput } = await listRes.json() as { output?: string };
          if (wsOutput?.trim()) {
            messages = [
              ...messages,
              { role: 'user' as const, content: `[Current workspace files — read before writing]\n${wsOutput.trim()}\n\nOnly create new files or modify files that need changing. Use [READ: path] to inspect an existing file before modifying it.` },
            ];
            wsSnapshotForLog = wsOutput.trim();
          }
        } catch { /* non-fatal */ }
      }
    }

    // Phase 3: inject workspace git diff for manager-review steps
    if (!payload.isWorker && currentRun.nextStep === 'manager-review') {
      try {
        const diffRes = await fetch('/api/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: 'git log --oneline -3 2>/dev/null && echo "---" && git diff --stat HEAD~1 HEAD 2>/dev/null || echo "(no git history yet)"',
            runId: currentRun.id,
          }),
        });
        const { output: diffOutput } = await diffRes.json() as { output?: string };
        if (diffOutput?.trim()) {
          const last = messages[messages.length - 1];
          if (last?.role === 'user') {
            messages = [
              ...messages.slice(0, -1),
              { ...last, content: `[Workspace changes since last checkpoint]\n${diffOutput.trim()}\n\n${last.content}` },
            ];
          }
        }
      } catch { /* non-fatal */ }
    }

    // ── Call the LLM with retry on transient errors ───────────────────────
    const MAX_STEP_RETRIES = 3;
    let data: { reply?: string; error?: string; promptTokens?: number; completionTokens?: number } = {};
    let stepOk = false;
    for (let attempt = 0; attempt < MAX_STEP_RETRIES; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 3 s, 9 s
        await new Promise(r => setTimeout(r, 3_000 * attempt));
      }
      try {
        const res = await fetch('/api/agents/step', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            history: messages,
            model,
            reasoningEffort: reasoningEffort || undefined,
          }),
        });
        data = await res.json() as typeof data;
        if (res.ok && data.reply) { stepOk = true; break; }
        // Non-retryable client errors (4xx except 429/408) — bail immediately
        if (res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 408) break;
        // Retryable: 5xx, 429, 408, or missing reply
      } catch {
        // fetch/network error — retryable
      }
    }

    if (!stepOk) {
      const errMsg = data.error ?? 'unknown error';
      return {
        ...currentRun,
        status: 'paused' as const,
        log: [
          ...currentRun.log,
          logEntry('system', 'status',
            `⏸ API call failed after ${MAX_STEP_RETRIES} attempts — "${errMsg}". Fix the connection issue and resume.`,
            'both'),
        ],
      };
    }

    tokenAccumRef.current.prompt     += data.promptTokens     ?? 0;
    tokenAccumRef.current.completion += data.completionTokens ?? 0;
    const reply = data.reply!;

    // ── Manager step ────────────────────────────────────────────────────────
    if (!payload.isWorker) {
      let mgrUpdated = applyReply(currentRun, currentRun.nextStep!, reply);
      const mgrTokens = parseTokens(reply);

      // Phase 4: correction rate limiting
      // Count how many corrections have been issued since the last task assignment
      if (mgrTokens.correction) {
        const lastTaskIdx = [...mgrUpdated.log].reverse().findIndex(e => e.type === 'task');
        const taskStart = lastTaskIdx >= 0 ? mgrUpdated.log.length - 1 - lastTaskIdx : 0;
        const correctionsOnTask = mgrUpdated.log.slice(taskStart).filter(e => e.type === 'correction').length;

        if (correctionsOnTask >= 5) {
          // Instead of a hard pause, inject a strong directive to the manager to change strategy
          mgrUpdated = {
            ...mgrUpdated,
            status: 'running',
            managerHistory: [
              ...mgrUpdated.managerHistory,
              { role: 'user' as const, content: `[System: ${correctionsOnTask} corrections issued on this task without resolution. The current approach is not working. You MUST either: (1) issue a [CORRECTION:] with a completely different, simpler approach that avoids the root failure, or (2) skip this sub-task and issue [NEXT_TASK:] to move forward. Do NOT repeat prior instructions.]` },
            ],
            log: [...mgrUpdated.log, logEntry('system', 'status',
              `⚠️ ${correctionsOnTask} corrections without resolution — manager redirected to change strategy`,
              'both')],
          };
        } else if (correctionsOnTask >= 3) {
          // Inject a simplification nudge into the worker's next context
          mgrUpdated = {
            ...mgrUpdated,
            workerHistory: [
              ...mgrUpdated.workerHistory,
              { role: 'user' as const, content: `[System note: ${correctionsOnTask} corrections on this task without resolution. Your previous approaches are not working. Simplify radically \u2014 implement the minimal version that satisfies core acceptance criteria only. Do not repeat the same approach.]` },
            ],
            log: [...mgrUpdated.log, logEntry('system', 'status',
              `\u{1F4A1} ${correctionsOnTask} corrections on same task \u2014 simplification nudge injected into worker context`,
              'worker')],
          };
        }
      }

      // Reset selfHealCount when manager assigns a new task
      if (mgrTokens.nextTask) {
        mgrUpdated = { ...mgrUpdated, selfHealCount: 0 };
      }

      return mgrUpdated;
    }

    // ── Worker step ─────────────────────────────────────────────────────────
    const tokens = parseTokens(reply);

    // Apply reply first so history/logs are updated
    let updated = applyReply(currentRun, currentRun.nextStep!, reply);

    // Emit file-context log entry for workspace snapshot (Phase 1A)
    if (wsSnapshotForLog) {
      updated = { ...updated, log: [...updated.log, logEntry('system', 'file-context', wsSnapshotForLog, 'worker')] };
    }

    // Apply [SERVE: command] if declared — stored on the run for persistence
    if (tokens.serveCommand) {
      updated = { ...updated, previewCommand: tokens.serveCommand };
    }

    // Extract files from this reply (for syncing to workspace)
    const { extractFilesFromText } = await import('@/utils/fileParser');
    const fileMap = new Map<string, ParsedFile>();
    extractFilesFromText(reply, fileMap);
    const filesThisReply = Array.from(fileMap.values());

    // ── Handle [EXEC: command] tokens ────────────────────────────────────────
    if (tokens.execCommands.length > 0) {
      let filesForFirstCmd = filesThisReply; // sync files only on first command
      let anyExecFailed = false;
      for (const cmd of tokens.execCommands) {
        // Intercept git push / git remote add commands — workspace has no remote credentials.
        // GitHub push is handled automatically by the system after completion.
        // Match regardless of position in the command (e.g. inside bash -lc "... && git push ...")
        const isGitRemoteOp = /\bgit\s+(push|remote\s+add)\b/.test(cmd);
        if (isGitRemoteOp && !currentRun.config.existingRepo) {
          const skipMsg = 'exit 0 (skipped — no remote configured)\nNote: git push is not available in this sandbox. GitHub deployment is handled automatically when the run completes.';
          updated = {
            ...updated,
            log: [...updated.log, logEntry('system', 'exec', cmd, 'worker'), logEntry('system', 'exec-result', skipMsg, 'worker')],
            workerHistory: [
              ...updated.workerHistory,
              { role: 'user' as const, content: `[EXEC_RESULT: exit_code=0]\nNote: git push/remote commands are skipped in this environment — no remote is configured. The system will push to GitHub automatically when the run completes. Continue with the remaining tasks.` },
            ],
            nextStep: 'worker-execute',
            status: 'running',
          };
          filesForFirstCmd = [];
          continue;
        }

        // Add exec log entry
        updated = {
          ...updated,
          log: [...updated.log, logEntry('system', 'exec', cmd, 'worker')],
        };

        try {
          const execRes = await fetch('/api/exec', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              command: cmd,
              runId: currentRun.id,
              files: filesForFirstCmd.length > 0 ? filesForFirstCmd : undefined,
            }),
          });
          const { output, exitCode, error: execError } =
            await execRes.json() as { output?: string; exitCode?: number; error?: string };

          const resultText = execError
            ? `error: ${execError}`
            : `${output ?? ''}`;
          const exitLabel = execError ? 'error' : `exit ${exitCode}`;
          const execPassed = !execError && exitCode === 0;
          if (!execPassed) anyExecFailed = true;

          // Unlock preview + auto-checkpoint when any exec passes
          if (execPassed) {
            updated = { ...updated, previewUnlocked: true };
            // Auto-checkpoint: git commit workspace state (non-fatal)
            try {
              const cpLabel = `exec: ${cmd.slice(0, 80)}`;
              const cpRes = await fetch('/api/exec/checkpoint', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ runId: currentRun.id, label: cpLabel }),
              });
              const cpData = (await cpRes.json()) as { commitHash?: string };
              if (cpData.commitHash) {
                const cpIndex = (updated.checkpoints ?? []).length + 1;
                const cpName = `Checkpoint ${cpIndex}`;
                const cpLogId = makeLogId();
                const cpLogEntry = {
                  ...logEntry('system', 'checkpoint', `${cpName} · ${cmd.slice(0, 120)}`, 'both'),
                  id: cpLogId,
                };
                const newCp: Checkpoint = {
                  id: makeLogId(),
                  name: cpName,
                  label: cpLabel,
                  commitHash: cpData.commitHash,
                  createdAt: Date.now(),
                  iteration: currentRun.currentIteration,
                  logEntryId: cpLogId,
                  workerHistoryLen: updated.workerHistory.length,
                  managerHistoryLen: updated.managerHistory.length,
                  logLen: updated.log.length + 1, // +1 for the cpLogEntry we're about to add
                };
                updated = {
                  ...updated,
                  checkpoints: [...(updated.checkpoints ?? []), newCp],
                  log: [...updated.log, cpLogEntry],
                };
              }
            } catch {
              // Checkpoint failure is non-fatal — never blocks the run
            }
          }

          updated = {
            ...updated,
            log: [...updated.log, logEntry('system', 'exec-result', `${exitLabel}\n${resultText}`, 'worker')],
            workerHistory: [
              ...updated.workerHistory,
              {
                role: 'user' as const,
                content: `[EXEC_RESULT: exit_code=${exitCode ?? -1}]\n${resultText}`,
              },
            ],
            // Keep worker going to see the output
            nextStep: 'worker-execute',
            status: 'running',
          };
        } catch (err) {
          anyExecFailed = true;
          const msg = err instanceof Error ? err.message : String(err);
          updated = {
            ...updated,
            log: [...updated.log, logEntry('system', 'exec-result', `error\n${msg}`, 'worker')],
            workerHistory: [
              ...updated.workerHistory,
              { role: 'user' as const, content: `[EXEC_RESULT: error]\n${msg}` },
            ],
            nextStep: 'worker-execute',
            status: 'running',
          };
        }
        filesForFirstCmd = []; // only sync files on the first exec per reply
      }
      // Auto-start preview when both the serve command and a passing exec are present
      if (updated.previewCommand && updated.previewUnlocked && !previewUrl) {
        fetch('/api/exec/serve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: updated.previewCommand, runId: currentRun.id }),
        })
          .then(r => r.json() as Promise<{ url?: string }>)
          .then(d => { if (d.url) setPreviewUrl(d.url); })
          .catch(() => {});
      }

      // Phase 2: self-healing — if worker said [DONE] but some commands failed,
      // give it ONE more attempt then immediately escalate to manager for guidance.
      if (anyExecFailed && tokens.done) {
        const selfHealCount = (currentRun.selfHealCount ?? 0) + 1;
        if (selfHealCount <= 1) {
          // Collect the most recent exec failure output to give the worker context
          const recentFailures = updated.log
            .slice(-10)
            .filter(e => e.type === 'exec-result' && /^exit [^0]|^error/.test(e.content))
            .map(e => e.content.slice(0, 300))
            .join('\n---\n');
          updated = {
            ...updated,
            selfHealCount,
            nextStep: 'worker-execute',
            status: 'running',
            workerHistory: [
              ...updated.workerHistory,
              { role: 'user' as const, content: `One or more commands failed (self-heal attempt ${selfHealCount}/2). Review the errors, fix the root cause, and re-run only the failing commands.\n\nFailed output:\n${recentFailures || '(see above)'}\n\nSay [DONE] only when all commands pass.` },
            ],
            log: [...updated.log, logEntry('system', 'status', `⚠️ Exec failed — worker self-healing (${selfHealCount}/2)`, 'worker')],
          };
        } else {
          // After 2 failed self-heal attempts, escalate to manager for targeted guidance
          const recentFailures = updated.log
            .slice(-12)
            .filter(e => e.type === 'exec-result' && /^exit [^0]|^error/.test(e.content))
            .map(e => e.content.slice(0, 400))
            .join('\n---\n');
          updated = {
            ...updated,
            selfHealCount: 0,
            nextStep: 'manager-review',
            status: 'running',
            // Prepend failure context into manager's incoming message
            managerHistory: [
              ...updated.managerHistory,
              { role: 'user' as const, content: `[System: Worker exhausted 2 self-heal attempts. The following commands failed repeatedly:\n${recentFailures || '(see worker log)'}\nPlease analyse the errors and issue a [CORRECTION:] with a specific alternative approach. Do NOT repeat the same instructions.]` },
            ],
            log: [...updated.log, logEntry('system', 'status', `⚠️ 2 self-heal attempts exhausted — escalating to manager for guidance`, 'both')],
          };
        }
      }

      return updated;
    }

    // Phase 1B: handle [READ: path] tokens — inject file content before next worker response
    if (tokens.readPaths.length > 0) {
      for (const rawPath of tokens.readPaths) {
        // Security: reject paths with traversal or absolute paths
        const safePath = rawPath.trim().replace(/\\/g, '/');
        if (!safePath || safePath.includes('..') || safePath.startsWith('/')) continue;
        try {
          const readRes = await fetch('/api/exec', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              command: `cat "${safePath}" 2>/dev/null || echo "[FILE NOT FOUND: ${safePath}]"`,
              runId: currentRun.id,
            }),
          });
          const { output: fileContent } = await readRes.json() as { output?: string };
          updated = {
            ...updated,
            workerHistory: [
              ...updated.workerHistory,
              { role: 'user' as const, content: `[READ_RESULT: ${safePath}]\n${fileContent ?? '[empty]'}` },
            ],
            log: [...updated.log, logEntry('system', 'file-context', `READ:${safePath}`, 'worker')],
            nextStep: 'worker-execute',
            status: 'running',
          };
        } catch { /* non-fatal */ }
      }
    }

    return updated;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // ── Auto-loop ─────────────────────────────────────────────────────────────

  const executeLoop = useCallback(async () => {
    if (loopRef.current) return;
    loopRef.current = true;
    setIsRunning(true);

    while (true) {
      const r = runRef.current;

      if (!loopRef.current)           break;
      if (r.status !== 'running')     break;
      if (!r.nextStep)                break;
      if (r.config.maxIterations > 0 && r.currentIteration >= r.config.maxIterations) {
        const paused: AgentRun = {
          ...r,
          status: 'paused',
          log: [
            ...r.log,
            logEntry('system', 'status',
              `⏸ Reached maximum iterations (${r.config.maxIterations}). Paused — click Resume to continue.`,
              'both'),
          ],
          updatedAt: Date.now(),
        };
        setRunAndSync(paused);
        break;
      }

      setIsStepping(true);
      try {
        // Build and clear pending monitor advisory for manager steps
        let advisory: string | undefined;
        if (r.nextStep && !r.nextStep.startsWith('worker')) {
          const pending = pendingAdvisoryRef.current.splice(0);
          if (pending.length > 0) advisory = formatAdvisory(pending);
        }
        let updated = await executeOneStep(r, advisory);
        if (!updated) break;
        // Mark new manager log entries as monitor-advised when an advisory was sent
        if (advisory) {
          const prevIds = new Set(r.log.map(e => e.id));
          updated = {
            ...updated,
            log: updated.log.map(e =>
              !prevIds.has(e.id) && e.from === 'manager'
                ? { ...e, monitorAdvised: true }
                : e
            ),
          };
        }
        setRunAndSync(updated);
        // Run monitor — client rules sync, AI analysis async
        addRuleFindings(runClientRules(updated), updated.currentIteration);
        if (monitorAiEnabled) triggerAiMonitor(updated, monitorModel); // fire-and-forget
      } catch (err) {
        const errRun: AgentRun = {
          ...runRef.current,
          status: 'error',
          log: [
            ...runRef.current.log,
            logEntry('system', 'status', `Error: ${(err as Error).message}`, 'both'),
          ],
          updatedAt: Date.now(),
        };
        setRunAndSync(errRun);
        break;
      } finally {
        setIsStepping(false);
      }

      // Brief pause between steps to avoid rate-limiting
      await new Promise<void>(resolve => setTimeout(resolve, 800));
    }

    loopRef.current = false;
    setIsRunning(false);
    // Snap status to 'paused' if the loop exited while run still shows 'running'
    // (can happen if the user clicked Pause mid-step)
    if (runRef.current.status === 'running') {
      setRunAndSync({ ...runRef.current, status: 'paused', updatedAt: Date.now() });
    }
  }, [executeOneStep, setRunAndSync]);

  // ── Controls ──────────────────────────────────────────────────────────────

  const handleStart = useCallback(async () => {
    setPreviewUrl(null);
    // Stop any running preview from a previous run of the same id
    fetch('/api/exec/serve', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: runRef.current.id }),
    }).catch(() => {});

    const r = runRef.current;
    const hasExistingRepo = !!r.config.existingRepo;

    // Mark as running immediately; add a log entry if cloning
    const started: AgentRun = {
      ...r,
      status: 'running' as RunStatus,
      updatedAt: Date.now(),
      log: hasExistingRepo
        ? [...r.log, logEntry('system', 'status', `⏳ Cloning \`${r.config.existingRepo}\` and checking out branch \`${r.config.featureBranch}\`…`, 'both')]
        : r.log,
    };
    setRunAndSync(started);

    // Initialise workspace — await when cloning so the agent doesn't run before the repo exists
    try {
      const initRes = await fetch('/api/exec/workspace-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: r.id,
          title: r.title,
          spec: r.spec,
          existingRepo: r.config.existingRepo,
          featureBranch: r.config.featureBranch,
        }),
      });

      if (hasExistingRepo) {
        const initData = await initRes.json() as { ok?: boolean; error?: string; branchPushed?: boolean };
        if (!initRes.ok || !initData.ok) {
          setRunAndSync({
            ...runRef.current,
            status: 'error' as RunStatus,
            updatedAt: Date.now(),
            log: [...runRef.current.log, logEntry('system', 'status', `❌ Clone failed: ${initData.error ?? 'unknown error'}`, 'both')],
          });
          return;
        }
        const pushNote = initData.branchPushed
          ? `✅ Cloned repo and published branch \`${r.config.featureBranch}\`. Starting run…`
          : `✅ Cloned repo and created branch \`${r.config.featureBranch}\` (remote push failed — agent can push when ready). Starting run…`;
        setRunAndSync({
          ...runRef.current,
          log: [...runRef.current.log, logEntry('system', 'status', pushNote, 'both')],
        });
      }
    } catch (err) {
      if (hasExistingRepo) {
        setRunAndSync({
          ...runRef.current,
          status: 'error' as RunStatus,
          updatedAt: Date.now(),
          log: [...runRef.current.log, logEntry('system', 'status', `❌ Failed to initialize workspace: ${(err as Error).message}`, 'both')],
        });
        return;
      }
    }

    executeLoop();
  }, [executeLoop, setRunAndSync]);

  const handlePause = useCallback(() => {
    loopRef.current = false;
    const paused = {
      ...runRef.current,
      status: 'paused' as RunStatus,
      log: [...runRef.current.log, logEntry('system', 'status', '⏸ Paused by user.', 'both')],
      updatedAt: Date.now(),
    };
    setRunAndSync(paused);
  }, [setRunAndSync]);

  const restartPreview = useCallback((r: AgentRun) => {
    if (!r.previewCommand || !r.previewUnlocked) return;
    fetch('/api/exec/serve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: r.previewCommand, runId: r.id }),
    })
      .then(res => res.json() as Promise<{ url?: string }>)
      .then(d => { if (d.url) setPreviewUrl(d.url); })
      .catch(() => {});
  }, []);

  const handleResume = useCallback(async () => {
    const current = runRef.current;

    // ── Pre-flight: verify DB, code-server, and workspace are reachable ──
    try {
      const res = await fetch(
        `/api/health/services?runId=${encodeURIComponent(current.id)}`,
      );
      const health = await res.json() as {
        ok: boolean;
        db: boolean;
        codeServer: boolean;
        workspace: boolean | null;
      };

      if (!health.ok) {
        const reasons: string[] = [];
        if (!health.db)                    reasons.push('database is not reachable');
        if (!health.codeServer)            reasons.push('code-server container is not running');
        if (health.workspace === false)    reasons.push('workspace directory not found — restart the run to rebuild it');

        setRunAndSync({
          ...current,
          status: 'paused',
          log: [
            ...current.log,
            logEntry(
              'system', 'status',
              `⚠️ Cannot resume: ${reasons.join('; ')}. Fix the issue and try again.`,
              'both',
            ),
          ],
          updatedAt: Date.now(),
        });
        return;
      }
    } catch {
      // Health check itself failed (e.g. dev server not yet ready) — proceed anyway
    }

    // If nextStep was cleared (e.g. by a blocked worker or manual stop), infer it
    const withStep: AgentRun = {
      ...current,
      status: 'running',
      nextStep: current.nextStep ?? inferNextStep(current),
    };
    setRunAndSync(withStep);
    // Restart preview server if this run previously had a successful build
    restartPreview(current);
    executeLoop();
  }, [executeLoop, restartPreview, setRunAndSync]);

  // ── Auto-start preview on mount ──────────────────────────────────────────
  // If the run already has a serve command and a passing build (previewUnlocked),
  // restart the preview server — this handles page reloads and container restarts.
  useEffect(() => {
    restartPreview(initialRun);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Restart preview when tab regains focus ───────────────────────────────
  // If code-server restarts while the page is still loaded, the preview process
  // is killed but React state still has previewUrl set. Re-launch on tab focus.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      restartPreview(runRef.current);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [restartPreview]);

  // ── Auto-resume on startup (server-restart recovery) ─────────────────────
  // If this run is in 'error' state when first mounted, it was interrupted by a
  // server restart — auto-resume it after a brief delay so the UI can settle.
  useEffect(() => {
    if (initialRun.status !== 'error') return;
    const t = setTimeout(() => handleResume(), 1500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStop = useCallback(() => {
    loopRef.current = false;
    setPreviewUrl(null);
    fetch('/api/exec/serve', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: runRef.current.id }),
    }).catch(() => {});
    const stopped = {
      ...runRef.current,
      status: 'paused' as RunStatus,
      nextStep: null,
      log: [...runRef.current.log, logEntry('system', 'status', '⏹ Run stopped by user.', 'both')],
      updatedAt: Date.now(),
    };
    setRunAndSync(stopped);
  }, [setRunAndSync]);

  const handleContinueAiFill = useCallback(async () => {
    if (!continueSpec.trim() || continueAiLoading) return;
    setContinueAiLoading(true);
    try {
      const prompt = `You are a software architect. A project titled "${runRef.current.title}" was just completed. The user wants to add the following to it. Expand this brief into a clear, detailed list of technical requirements and acceptance criteria:\n\n${continueSpec.trim()}`;
      const res = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model: runRef.current.config.managerModel, mode: 'plan' }),
      });
      const data = await res.json() as { result?: string };
      if (data.result) setContinueSpec(data.result);
    } catch { /* ignore */ } finally {
      setContinueAiLoading(false);
    }
  }, [continueSpec, continueAiLoading]);

  const handleContinueWithSpecs = useCallback(() => {
    if (!continueSpec.trim()) return;
    const r = runRef.current;
    const msg =
      `The original specification has been completed. Here are additional requirements to implement:\n\n${continueSpec.trim()}\n\nPlease assign the first new task to the worker.`;

    // Swap personality system prompts if the user changed it
    const currentCategory = r.config.category ?? 'developer';
    let newWorkerHistory = r.workerHistory;
    let newManagerHistory = r.managerHistory;
    if (continuePersonality !== currentCategory) {
      const { worker: ws, manager: ms } = getSystemPrompts(continuePersonality);
      newWorkerHistory = r.workerHistory.map((m, i) =>
        i === 0 && m.role === 'system' ? { ...m, content: ws } : m
      );
      newManagerHistory = r.managerHistory.map((m, i) =>
        i === 0 && m.role === 'system' ? { ...m, content: ms } : m
      );
    }

    const updated: AgentRun = {
      ...r,
      status: 'running' as RunStatus,
      nextStep: 'manager-review' as const,
      config: { ...r.config, category: continuePersonality as PersonalityId },
      workerHistory: newWorkerHistory,
      managerHistory: [...newManagerHistory, { role: 'user' as const, content: msg }],
      log: [...r.log, logEntry('user', 'user-input', `📋 Additional requirements added:\n${continueSpec.trim()}`, 'both')],
      updatedAt: Date.now(),
    };
    setContinueSpec('');
    setRunAndSync(updated);
    executeLoop();
  }, [continueSpec, continuePersonality, setRunAndSync, executeLoop]);

  const handleRestart = useCallback(() => {
    if (!restartConfirm) {
      // First click — show confirm state, auto-reset after 3 s
      setRestartConfirm(true);
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => setRestartConfirm(false), 3000);
      return;
    }
    // Second click — execute restart
    setRestartConfirm(false);
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    loopRef.current = false;
    setPreviewUrl(null);
    // Kill preview server
    fetch('/api/exec/serve', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: runRef.current.id }),
    }).catch(() => {});
    // Delete workspace files
    fetch('/api/exec', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: runRef.current.id }),
    }).catch(() => {});
    const r = runRef.current;
    const specMsg =
      `Here is the project specification:\n\n---\n${r.spec}\n---\n\n` +
      `Please analyze the spec and assign the FIRST task to the worker using exactly: ` +
      `[NEXT_TASK: detailed task description with all context]`;
    // Clear monitor localStorage so the panel starts fresh
    try { localStorage.removeItem(monitorKey); } catch { /* ignore */ }
    setAllFindings([]);
    setPushState({ status: 'idle' });
    const restarted: AgentRun = {
      id: r.id,
      title: r.title,
      spec: r.spec,
      status: 'running',
      createdAt: r.createdAt,
      updatedAt: Date.now(),
      config: r.config,
      currentIteration: 0,
      workerHistory: [],
      managerHistory: [{ role: 'user', content: specMsg }],
      log: [logEntry('system', 'status', '🔄 Restarted from beginning.', 'both')],
      nextStep: 'manager-init',
      checkpoints: [],
    };
    // Re-seed the workspace with AGENTS.md + CLAUDE.md (or re-clone if applicable)
    fetch('/api/exec/workspace-init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: r.id, title: r.title, spec: r.spec, existingRepo: r.config.existingRepo, featureBranch: r.config.featureBranch }),
    }).catch(() => {});
    setRunAndSync(restarted);
    executeLoop();
  }, [restartConfirm, executeLoop, setRunAndSync]);

  // ── Auto-push on completion (when configured at run creation) ─────────────
  useEffect(() => {
    if (run.status !== 'complete') return;
    if (!run.config.pushToGithub) return;
    if (pushState.status !== 'idle') return;
    const accessToken = (session as any)?.accessToken as string | undefined;
    if (!accessToken) return;

    const slug = (n: string) =>
      n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'my-project';
    const repoName = run.config.githubRepo?.trim() || slug(run.title);

    setPushState({ status: 'pushing' });
    fetch('/api/github/create-and-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: run.id, repoName, accessToken }),
    })
      .then(r => r.json() as Promise<{ ok: boolean; repoUrl?: string; error?: string }>)
      .then(d => {
        if (d.ok) {
          setPushState({ status: 'success', url: d.repoUrl });
        } else {
          setPushState({ status: 'error', message: d.error ?? 'Push failed' });
        }
      })
      .catch(e => setPushState({ status: 'error', message: e instanceof Error ? e.message : 'Push failed' }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.status, session]);

  // ── GitHub push helper ────────────────────────────────────────────────────
  const handleRestored = useCallback(() => {
    const r = runRef.current;
    const restoreMsg =
      '[SYSTEM: Checkpoint restored] The workspace files have been rolled back to a previous ' +
      'checkpoint. Code files may have changed or been removed since the last step. ' +
      'Acknowledge this and continue accordingly — do NOT repeat work that was already done before the rollback.';
    const updatedRun = {
      ...r,
      workerHistory:  [...r.workerHistory,  { role: 'system' as const, content: restoreMsg }],
      managerHistory: [...r.managerHistory, { role: 'system' as const, content: restoreMsg }],
      log: [
        ...r.log,
        logEntry('system', 'status', '⏸ Paused — workspace restored to checkpoint. Both agents have been informed.', 'both'),
      ],
      updatedAt: Date.now(),
    };
    if (r.status === 'running') {
      loopRef.current = false;
      setRunAndSync({ ...updatedRun, status: 'paused' });
    } else {
      setRunAndSync(updatedRun);
    }
  }, [setRunAndSync]);

  // ── Rewind to any log entry (finds the nearest preceding checkpoint) ──────
  const handleRewind = useCallback(async (entryId: string) => {
    loopRef.current = false;
    const r = runRef.current;

    // Find the position of the target log entry
    const entryIdx = r.log.findIndex(e => e.id === entryId);
    if (entryIdx < 0) return;

    // Find the latest checkpoint whose log entry sits at or before entryIdx
    const cps = r.checkpoints ?? [];
    let targetCp: Checkpoint | null = null;
    let cpIdx = -1;
    for (let i = cps.length - 1; i >= 0; i--) {
      const cpLogIdx = r.log.findIndex(e => e.id === cps[i].logEntryId);
      if (cpLogIdx >= 0 && cpLogIdx <= entryIdx) {
        targetCp = cps[i];
        cpIdx = i;
        break;
      }
    }

    // Restore git workspace to the checkpoint commit (non-fatal if no checkpoint)
    if (targetCp) {
      try {
        await fetch('/api/exec/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: r.id, commitHash: targetCp.commitHash }),
        });
      } catch { /* non-fatal */ }
    }

    // Trim run state back to checkpoint
    const logCutoff    = targetCp?.logLen       ?? entryIdx + 1;
    const workerLen    = targetCp?.workerHistoryLen  ?? r.workerHistory.length;
    const managerLen   = targetCp?.managerHistoryLen ?? r.managerHistory.length;
    const keptCps      = targetCp ? cps.slice(0, cpIdx + 1) : cps;

    // Clear monitor findings beyond this iteration
    const keptIteration = targetCp?.iteration ?? 0;
    setAllFindings(prev => prev.filter(f => f.iteration <= keptIteration));

    const rewindNote = logEntry(
      'system', 'status',
      `⏪ Rewound to ${targetCp ? targetCp.name : 'this point'} — workspace and agent histories restored. Run is paused.`,
      'both',
    );

    const rewound: AgentRun = {
      ...r,
      status: 'paused',
      log: [...r.log.slice(0, logCutoff), rewindNote],
      workerHistory:  r.workerHistory.slice(0, workerLen),
      managerHistory: r.managerHistory.slice(0, managerLen),
      checkpoints: keptCps,
      selfHealCount: 0,
      updatedAt: Date.now(),
    };
    setRunAndSync(rewound);
  }, [setRunAndSync, setAllFindings]);

  const handleExport = useCallback(() => {
    const r = runRef.current;

    // ── Derived diagnostics ──────────────────────────────────────────────────
    const execEntries    = r.log.filter(e => e.type === 'exec');
    const resultEntries  = r.log.filter(e => e.type === 'exec-result');
    const failedExecs    = resultEntries.filter(e =>
      /^(exit [^0]|error)/i.test(e.content.trimStart()),
    );
    const corrEntries    = r.log.filter(e => e.type === 'correction');
    const recoveries     = r.log.filter(
      e => e.type === 'status' && /auto-recovering|no recognized token/i.test(e.content),
    );

    // ── Per-entry iteration attribution ──────────────────────────────────────
    // Scan status entries that contain "iter N" to mark iteration boundaries.
    const iterBoundaries: { idx: number; iter: number }[] = [];
    r.log.forEach((e, idx) => {
      const m = e.content.match(/\biter(?:ation)?\s+(\d+)/i);
      if (m) iterBoundaries.push({ idx, iter: parseInt(m[1], 10) });
    });
    const getIter = (idx: number): number | undefined => {
      let cur: number | undefined;
      for (const b of iterBoundaries) {
        if (b.idx <= idx) cur = b.iter; else break;
      }
      return cur;
    };

    const mapEntry = (e: typeof r.log[0], idx: number) => ({
      time:           new Date(e.timestamp).toISOString(),
      iter:           getIter(idx),
      from:           e.from,
      type:           e.type,
      monitorAdvised: e.monitorAdvised ?? false,
      content:        e.content,
    });

    const exportData = {
      meta: {
        title:         r.title,
        status:        r.status,
        iterations:    r.currentIteration,
        maxIterations: r.config.maxIterations,
        createdAt:     new Date(r.createdAt).toISOString(),
        updatedAt:     new Date(r.updatedAt).toISOString(),
        workerModel:   r.config.workerModel,
        managerModel:  r.config.managerModel,
      },
      stats: {
        execCount:        execEntries.length,
        failedExecCount:  failedExecs.length,
        correctionCount:  corrEntries.length,
        recoveryCount:    recoveries.length,
        planTaskCount:    (r.plan ?? []).length,
        planDoneCount:    (r.plan ?? []).filter(t => t.status === 'done').length,
      },
      plan: (r.plan ?? []).map(t => ({ id: t.id, title: t.title, status: t.status })),
      spec: r.spec,
      workerLog: r.log
        .filter(e => e.target === 'worker' || e.target === 'both')
        .map((e, _, arr) => mapEntry(e, r.log.indexOf(e))),
      managerLog: r.log
        .filter(e => e.target === 'manager' || e.target === 'both')
        .map((e) => mapEntry(e, r.log.indexOf(e))),
      execSummary: execEntries.map((e) => {
        // Find the exec-result that immediately follows this exec entry in the log
        const execIdx = r.log.indexOf(e);
        const result = r.log.slice(execIdx + 1).find(x => x.type === 'exec-result');
        const firstLine = result?.content.split('\n')[0].trim() ?? '';
        const passed = result
          ? /^exit 0$/i.test(firstLine) || /exit_code=0/.test(firstLine)
          : null;
        return {
          time:    new Date(e.timestamp).toISOString(),
          iter:    getIter(execIdx),
          command: e.content,
          passed,
          output:  result?.content.slice(0, 500) ?? null,
        };
      }),
      monitorFindings: allFindings.map(f => ({
        iteration: f.iteration,
        severity:  f.severity,
        category:  f.category,
        source:    f.source,
        message:   f.message,
      })),
    };
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `openpilot-${r.id.slice(0, 8)}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [allFindings]);

  // ── User injection ────────────────────────────────────────────────────────

  const handleInject = useCallback(async () => {
    if (!injectText.trim() || injectLoading || isStepping) return;

    const isWorker = injectTarget === 'worker';
    const histKey  = isWorker ? 'workerHistory' : 'managerHistory';
    const { getSystemPrompts } = await import('@/services/agentOrchestrator');
    const prompts = getSystemPrompts(runRef.current.config.category);
    const sysPrompt = isWorker ? prompts.worker : prompts.manager;

    const r = runRef.current;
    const historyWithMsg = [
      ...r[histKey],
      { role: 'user' as const, content: injectText.trim() },
    ];

    const cfg = r.config;
    const model           = isWorker ? cfg.workerModel          : cfg.managerModel;
    const reasoningEffort = isWorker ? cfg.workerReasoningEffort : cfg.managerReasoningEffort;

    // Add user injection to log immediately
    const withUserLog: AgentRun = {
      ...r,
      log: [...r.log, logEntry('user', 'user-input', injectText.trim(), injectTarget)],
      [histKey]: historyWithMsg,
    };
    setRunAndSync(withUserLog);
    setInjectText('');
    setInjectLoading(true);

    try {
      const res = await fetch('/api/agents/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: [{ role: 'system', content: sysPrompt }, ...historyWithMsg],
          model,
          reasoningEffort: reasoningEffort || undefined,
        }),
      });
      const data = await res.json() as { reply?: string; error?: string; promptTokens?: number; completionTokens?: number };
      tokenAccumRef.current.prompt     += data.promptTokens     ?? 0;
      tokenAccumRef.current.completion += data.completionTokens ?? 0;
      const reply = data.reply ?? `[Error: ${data.error}]`;

      const replyLog = logEntry(isWorker ? 'worker' : 'manager', isWorker ? 'output' : 'review', reply, injectTarget);
      const updated: AgentRun = {
        ...runRef.current,
        [histKey]: [...runRef.current[histKey], { role: 'assistant' as const, content: reply }],
        log: [...runRef.current.log, replyLog],
        updatedAt: Date.now(),
      };
      setRunAndSync(updated);
    } catch (err) {
      const updated: AgentRun = {
        ...runRef.current,
        log: [...runRef.current.log, logEntry('system', 'status', `Inject error: ${(err as Error).message}`, injectTarget)],
      };
      setRunAndSync(updated);
    } finally {
      setInjectLoading(false);
    }
  }, [injectText, injectTarget, injectLoading, isStepping, setRunAndSync]);

  // ── Render ────────────────────────────────────────────────────────────────

  const badge = STATUS_BADGE[run.status];
  const workerLoading = isStepping && (run.nextStep === 'worker-execute');
  const managerLoading = isStepping && (run.nextStep !== 'worker-execute' && run.nextStep !== null);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">

      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-5 py-3 border-b bg-gray-50 dark:bg-gray-800 dark:border-gray-700 shrink-0 flex-wrap gap-y-2">
        <span className="font-bold text-gray-800 dark:text-gray-100 truncate max-w-xs">{run.title}</span>

        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>
          {badge.label}
          {run.status === 'running' && (
            <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-ping" />
          )}
        </span>

        {savedRunId && (run.status === 'complete' || run.status === 'error') && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400">Rate:</span>
            <button
              onClick={() => handleRate(1)}
              disabled={userRating !== null}
              title="Thumbs up — this run went well"
              className={`text-base leading-none px-1 rounded transition-opacity ${
                userRating === 1 ? 'opacity-100' : 'opacity-40 hover:opacity-100 disabled:opacity-40'
              }`}
            >👍</button>
            <button
              onClick={() => handleRate(-1)}
              disabled={userRating !== null}
              title="Thumbs down — this run had problems"
              className={`text-base leading-none px-1 rounded transition-opacity ${
                userRating === -1 ? 'opacity-100' : 'opacity-40 hover:opacity-100 disabled:opacity-40'
              }`}
            >👎</button>
          </div>
        )}

        <span className="text-xs text-gray-400">
          {run.currentIteration}/{run.config.maxIterations === 0 ? '∞' : run.config.maxIterations} steps
        </span>

        <div className="ml-auto flex items-center gap-2">
          {/* VS Code editor button — opens this run's workspace in code-server */}
          <button
            onClick={openCodeServerWorkspace}
            title={workspaceExists === false ? 'Workspace not found — restart the run to rebuild it' : 'Open workspace in VS Code editor'}
            className={`flex items-center justify-center w-7 h-7 rounded border transition-colors ${
              workspaceExists === false
                ? 'bg-red-50 dark:bg-red-900/30 border-red-300 dark:border-red-600 text-red-500'
                : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-400'
            }`}
          >
            {workspaceExists === false
              ? <span className="text-xs font-bold">✕</span>
              : <svg width="14" height="14" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                  <path fill="#007ACC" d="M74.9 5.2L39.2 33.6 15.4 18.4 4 25.1v49.8l11.4 6.7 23.8-15.2 35.7 28.4 17.1-7V12.2L74.9 5.2zm0 58.5L44.6 50l30.3-13.7V63.7zM15.4 64.5V35.5l19.2 14.5-19.2 14.5z"/>
                </svg>
            }
          </button>

          <button
            onClick={handleExport}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded border bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600"
            title="Export all logs and monitor findings as JSON"
          >
            ⬇ Export
          </button>

          <button
            onClick={() => setFilesOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded border bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600"
            title="Browse and download files produced by the worker agent"
          >
            📁 Files
          </button>

          <button
            onClick={() => setPlanOpen(v => !v)}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded border transition-colors ${
              planOpen
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
            }`}
            title="View the manager's task plan"
          >
            📋 Plan
            {(run.plan?.length ?? 0) > 0 && (
              <span className={`ml-0.5 rounded-full px-1.5 py-px text-[10px] font-bold ${
                run.plan!.every(t => t.status === 'done')
                  ? 'bg-green-500 text-white'
                  : 'bg-blue-500 text-white'
              }`}>
                {run.plan!.filter(t => t.status === 'done').length}/{run.plan!.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setCheckpointsOpen(v => !v)}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded border transition-colors ${
              checkpointsOpen
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
            }`}
            title="View and restore workspace checkpoints"
          >
            📍 Checkpoints
            {(run.checkpoints?.length ?? 0) > 0 && (
              <span className="ml-0.5 bg-indigo-500 text-white rounded-full px-1.5 py-px text-[10px] font-bold">
                {run.checkpoints!.length}
              </span>
            )}
          </button>

          {/* Preview button — 3 states */}
          {run.previewCommand && !run.previewUnlocked && (
            <button
              disabled
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded border bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
              title="Preview will unlock once the worker completes a successful build"
            >
              🔒 Preview
            </button>
          )}
          {/* ── Preview button — always visible ───────────────────────────── */}
          {(() => {
            const portFromUrl = previewUrl
              ? (() => { try { return new URL(previewUrl).port || '80'; } catch { return '4000'; } })()
              : null;
            const portFromCmd = (() => { const m = run.previewCommand?.match(/\b(\d{4,5})\b/); return m ? m[1] : '4000'; })();
            const port = portFromUrl ?? portFromCmd;
            const label = `:${port}`;
            const isActive = !!previewUrl;
            const canStart = !!(run.previewCommand && run.previewUnlocked && !previewUrl);

            const DockerIcon = () => (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="shrink-0" aria-hidden="true">
                <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.186.186 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.185.185v1.888c0 .101.083.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z"/>
              </svg>
            );

            if (isActive) {
              return (
                <a
                  href={previewUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded border bg-green-600 text-white border-green-600 hover:bg-green-700"
                  title={`Open preview at ${previewUrl}`}
                >
                  <DockerIcon />
                  {label}
                </a>
              );
            }
            if (canStart) {
              return (
                <button
                  onClick={() => {
                    fetch('/api/exec/serve', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ command: run.previewCommand, runId: run.id }),
                    })
                      .then(r => r.json() as Promise<{ url?: string }>)
                      .then(d => { if (d.url) setPreviewUrl(d.url); })
                      .catch(() => {});
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded border bg-blue-600 text-white border-blue-600 hover:bg-blue-700"
                  title="Start preview server"
                >
                  <DockerIcon />
                  {label}
                </button>
              );
            }
            return (
              <button
                disabled
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded border bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 border-gray-200 dark:border-gray-700 cursor-not-allowed opacity-50"
                title="Preview available after a successful build"
              >
                <DockerIcon />
                {label}
              </button>
            );
          })()}

          {/* Monitor toggle */}
          <button
            onClick={() => {
              const opening = !monitorOpen;
              setMonitorOpen(opening);
              // Fetch model list once when first opened
              if (opening && !modelsFetched.current) {
                modelsFetched.current = true;
                fetch('/api/models')
                  .then(r => r.json())
                  .then((data: { models?: CopilotModel[] }) => {
                    if (data.models?.length) setMonitorModels(data.models);
                  })
                  .catch(() => {});
              }
            }}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded border transition-colors ${
              monitorOpen
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
            }`}
          >
            🔍 Monitor
            {allFindings.some(f => f.severity === 'error') && (
              <span className="ml-0.5 bg-red-500 text-white rounded-full px-1.5 py-px text-[10px] font-bold">
                {allFindings.filter(f => f.severity === 'error').length}
              </span>
            )}
            {!allFindings.some(f => f.severity === 'error') && allFindings.some(f => f.severity === 'warning') && (
              <span className="ml-0.5 bg-yellow-500 text-white rounded-full px-1.5 py-px text-[10px] font-bold">
                {allFindings.filter(f => f.severity === 'warning').length}
              </span>
            )}
          </button>

          {(run.status === 'idle') && (
            <button
              onClick={handleStart}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded bg-green-600 text-white hover:bg-green-700"
            >
              ▶ Start
            </button>
          )}
          {run.status === 'running' && (
            <button
              onClick={handlePause}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded bg-yellow-500 text-white hover:bg-yellow-600"
            >
              ⏸ Pause
            </button>
          )}
          {(run.status === 'paused' || run.status === 'error') && (
            <button
              onClick={handleResume}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded bg-green-600 text-white hover:bg-green-700"
              title={run.status === 'error' ? 'Resume despite the error — the run will continue from the last successful step' : undefined}
            >
              ▶ Resume
            </button>
          )}
          {(run.status === 'running' || run.status === 'paused') && (
            <button
              onClick={handleStop}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Stop the run (use Resume to continue, or Delete to remove)"
            >
              ⏹ Stop
            </button>
          )}
          {run.status !== 'running' && (
            <button
              onClick={handleRestart}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded border transition-colors ${
                restartConfirm
                  ? 'bg-red-500 text-white border-red-500 hover:bg-red-600'
                  : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}
              title={restartConfirm ? 'Click again to confirm — this clears all history' : 'Restart run from the beginning'}
            >
              {restartConfirm ? '⚠ Confirm Restart?' : '🔄 Restart'}
            </button>
          )}

          {/* GitHub push button — shown when run is not actively running */}
          {run.status !== 'running' && run.status !== 'idle' && (
            <>
              {/* Auto-push status badge (when configured at run creation) */}
              {run.config.pushToGithub && pushState.status !== 'idle' ? (
                <span
                  title={pushState.url ? `View at ${pushState.url}` : pushState.message}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded border ${
                    pushState.status === 'pushing' ? 'bg-gray-100 dark:bg-gray-700 text-gray-400 border-gray-200 dark:border-gray-600 cursor-default' :
                    pushState.status === 'success' ? 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400 border-green-300 dark:border-green-800 cursor-default' :
                    'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border-red-300 dark:border-red-800 cursor-default'
                  }`}
                >
                  {pushState.status === 'pushing' && '⏳ Pushing…'}
                  {pushState.status === 'success' && (
                    pushState.url
                      ? <a href={pushState.url} target="_blank" rel="noreferrer" className="hover:underline">✓ Pushed to GitHub ↗</a>
                      : '✓ Pushed to GitHub'
                  )}
                  {pushState.status === 'error' && `✗ Push failed`}
                </span>
              ) : (
                /* Manual push button — always available */
                <button
                  onClick={() => setShowPushModal(true)}
                  title={pushState.status === 'success' ? `Pushed to ${pushState.url}. Click to push again.` : 'Push workspace to a new GitHub repository'}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded border transition-colors ${
                    pushState.status === 'success'
                      ? 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400 border-green-300 dark:border-green-800 hover:bg-green-100'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {pushState.status === 'success' ? '✓ Pushed to GitHub' : '⬆ Push to GitHub'}
                </button>
              )}
            </>
          )}

          {deletePhase === 'idle' ? (
            <button
              onClick={() => {
                setDeletePhase('confirm');
                if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
                deleteTimerRef.current = setTimeout(() => setDeletePhase('idle'), 4000);
              }}
              className="px-3 py-1.5 text-xs font-semibold rounded border border-red-200 dark:border-red-800 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
            >
              🗑 Delete
            </button>
          ) : (
            <span className="flex items-center gap-1">
              <button
                onClick={() => {
                  if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
                  setDeletePhase('idle');
                }}
                className="px-2.5 py-1.5 text-xs font-semibold rounded border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
                  setDeletePhase('idle');
                  onDelete();
                }}
                className="px-2.5 py-1.5 text-xs font-semibold rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
              >
                Run only
              </button>
              {pushState.url && (
                <button
                  disabled={deletingRepo}
                  onClick={async () => {
                    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
                    setDeletePhase('idle');
                    setDeletingRepo(true);
                    const accessToken = (session as any)?.accessToken as string | undefined;
                    if (accessToken && pushState.url) {
                      await fetch('/api/github/delete-repo', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ repoUrl: pushState.url, accessToken }),
                      }).catch(() => {});
                    }
                    setDeletingRepo(false);
                    onDelete();
                  }}
                  className="px-2.5 py-1.5 text-xs font-semibold rounded border border-red-500 dark:border-red-600 bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {deletingRepo ? 'Deleting…' : 'Run + repo'}
                </button>
              )}
            </span>
          )}
        </div>
      </div>

      {/* ── Panels ── */}
      <div className="flex flex-1 overflow-hidden divide-x divide-gray-200 dark:divide-gray-700">
        <div className="flex-1 overflow-hidden">
          <AgentPanel
            label="Worker Agent"
            icon="👷"
            modelBadge={`${run.config.workerModel}${run.config.workerReasoningEffort ? ` · ${run.config.workerReasoningEffort}` : ''}`}
            log={run.log}
            loading={workerLoading}
            panelTarget="worker"
            runId={run.id}
            highlightedEntryId={highlightedEntryId}
            hideCheckpointMessages={hideCheckpointLogs}
            onClearHighlight={() => setHighlightedEntryId(null)}
            onRewind={handleRewind}
          />
        </div>
        <div className="flex-1 overflow-hidden">
          <AgentPanel
            label="Manager Agent"
            icon="🧑‍💼"
            modelBadge={`${run.config.managerModel}${run.config.managerReasoningEffort ? ` · ${run.config.managerReasoningEffort}` : ''}`}
            log={run.log}
            loading={managerLoading}
            panelTarget="manager"
            runId={run.id}
            highlightedEntryId={highlightedEntryId}
            hideCheckpointMessages={hideCheckpointLogs}
            onClearHighlight={() => setHighlightedEntryId(null)}
          />
        </div>

        {/* Monitor panel — collapsible right sidebar */}
        {monitorOpen && (
          <div className="w-72 shrink-0 overflow-hidden">
            <MonitorPanel
              findings={allFindings}
              isAnalyzing={isAnalyzing}
              models={monitorModels}
              monitorModel={monitorModel}
              onMonitorModelChange={handleMonitorModelChange}
              aiEnabled={monitorAiEnabled}
              onToggleAi={() => setMonitorAiEnabled(v => !v)}
            />
          </div>
        )}

        {/* Plan panel — collapsible right sidebar */}
        {planOpen && (
          <PlanPanel
            plan={run.plan ?? []}
            onClose={() => setPlanOpen(false)}
          />
        )}

        {/* Checkpoints panel — collapsible right sidebar */}
        {checkpointsOpen && (
          <div className="w-72 shrink-0 overflow-hidden border-l flex flex-col">
            <CheckpointsPanel
              runId={run.id}
              checkpoints={run.checkpoints ?? []}
              isRunning={run.status === 'running'}
              onClose={() => setCheckpointsOpen(false)}
              onRestored={handleRestored}
              onRewind={handleRewind}
              hideCheckpointLogs={hideCheckpointLogs}
              onToggleHideCheckpointLogs={() => setHideCheckpointLogs(v => !v)}
              onSelectCheckpoint={(logEntryId) => setHighlightedEntryId(logEntryId)}
            />
          </div>
        )}
      </div>

      {filesOpen && (
        <FilesModal
          run={run}
          onClose={() => setFilesOpen(false)}
        />
      )}

      {/* ── Build completion banner ── */}
      {run.status === 'complete' && (
        <div className="shrink-0 border-t-2 border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/40 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="text-xl mt-0.5">✅</span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-green-800 dark:text-green-300 text-sm">
                Build complete — {run.currentIteration} step{run.currentIteration !== 1 ? 's' : ''}
              </p>
              <p className="text-xs text-green-700/70 dark:text-green-400/60 mt-0.5">
                All specification items have been implemented. What would you like to do next?
              </p>

              {/* Quick actions row */}
              <div className="flex flex-wrap items-center gap-2 mt-3">
                {previewUrl && (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
                  >
                    ↗ Open Build
                  </a>
                )}
                {run.previewCommand && run.previewUnlocked && !previewUrl && (
                  <button
                    onClick={() => {
                      fetch('/api/exec/serve', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ command: run.previewCommand, runId: run.id }),
                      })
                        .then(r => r.json() as Promise<{ url?: string }>)
                        .then(d => { if (d.url) setPreviewUrl(d.url); })
                        .catch(() => {});
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
                  >
                    ▶ Open Build
                  </button>
                )}
                {onNewPersonalityRun && (
                  <button
                    onClick={() => onNewPersonalityRun(run.spec, run.title)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    🎭 New run · different personality
                  </button>
                )}
              </div>

              {/* Continue with additional specs */}
              <div className="mt-3">
                <p className="text-xs font-medium text-green-800 dark:text-green-300 mb-1.5">
                  Or continue with additional requirements:
                </p>
                {/* Textarea with loading overlay + expand button */}
                <div className="relative">
                  <textarea
                    rows={3}
                    className={`w-full border border-green-200 dark:border-green-700 rounded-lg px-3 py-2 pr-8 text-sm resize-y bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-500 min-h-[4.5rem] transition-opacity${continueAiLoading ? ' opacity-40 cursor-not-allowed' : ''}`}
                    placeholder="Describe additional features or changes to implement…"
                    value={continueSpec}
                    readOnly={continueAiLoading}
                    onChange={e => setContinueSpec(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey && !continueAiLoading) {
                        e.preventDefault();
                        handleContinueWithSpecs();
                      }
                    }}
                  />
                  {/* Expand to full-screen */}
                  <button
                    onClick={() => setContinueExpanded(true)}
                    className="absolute top-1.5 right-1.5 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                    title="Expand"
                    tabIndex={-1}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
                      <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
                    </svg>
                  </button>
                  {/* Loading overlay */}
                  {continueAiLoading && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-lg pointer-events-none">
                      <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400 animate-pulse bg-white/80 dark:bg-gray-800/80 px-3 py-1 rounded-full">
                        ✨ Generating plan…
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <button
                    onClick={handleContinueAiFill}
                    disabled={!continueSpec.trim() || continueAiLoading}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    ✨ Plan with AI
                  </button>
                  <select
                    value={continuePersonality}
                    onChange={e => setContinuePersonality(e.target.value)}
                    className="border border-gray-200 dark:border-gray-600 rounded-md px-2 py-1 text-xs bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-green-500 cursor-pointer"
                    title="Personality for continuation"
                  >
                    {Object.values(personalities).map(p => (
                      <option key={p.id} value={p.id}>{p.icon} {p.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleContinueWithSpecs}
                    disabled={!continueSpec.trim() || continueAiLoading}
                    className="ml-auto flex items-center gap-1 px-3 py-1 text-xs font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                  >
                    + Continue →
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Continue spec full-screen modal ── */}
      {continueExpanded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col" style={{ height: '80vh' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Additional requirements</p>
              <button
                onClick={() => setContinueExpanded(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="relative flex-1 min-h-0">
              <textarea
                className={`w-full h-full resize-none px-4 py-3 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none transition-opacity${continueAiLoading ? ' opacity-40 cursor-not-allowed' : ''}`}
                placeholder="Describe additional features or changes to implement…"
                value={continueSpec}
                readOnly={continueAiLoading}
                onChange={e => setContinueSpec(e.target.value)}
                autoFocus
              />
              {continueAiLoading && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-sm font-medium text-indigo-600 dark:text-indigo-400 animate-pulse bg-white/80 dark:bg-gray-900/80 px-4 py-2 rounded-full">
                    ✨ Generating plan…
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0 flex-wrap">
              <button
                onClick={handleContinueAiFill}
                disabled={!continueSpec.trim() || continueAiLoading}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ✨ Plan with AI
              </button>
              <select
                value={continuePersonality}
                onChange={e => setContinuePersonality(e.target.value)}
                className="border border-gray-200 dark:border-gray-600 rounded-md px-2 py-1 text-xs bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
              >
                {Object.values(personalities).map(p => (
                  <option key={p.id} value={p.id}>{p.icon} {p.label}</option>
                ))}
              </select>
              <button
                onClick={() => { handleContinueWithSpecs(); setContinueExpanded(false); }}
                disabled={!continueSpec.trim() || continueAiLoading}
                className="ml-auto flex items-center gap-1 px-4 py-1.5 text-xs font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                + Continue →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── User steer bar ── */}
      <div className="flex items-start gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 shrink-0">
        <div className="flex-1 relative">
          <textarea
            rows={2}
            className="w-full border border-gray-200 dark:border-gray-600 rounded px-3 py-2 text-sm resize-none pr-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="Steer the run — inject a message into either agent…"
            value={injectText}
            onChange={e => setInjectText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleInject();
              }
            }}
          />
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <div className="flex gap-1">
            <button
              onClick={() => setInjectTarget('worker')}
              className={`px-2 py-1 text-xs rounded border font-medium ${injectTarget === 'worker' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'}`}
            >
              👷 Worker
            </button>
            <button
              onClick={() => setInjectTarget('manager')}
              className={`px-2 py-1 text-xs rounded border font-medium ${injectTarget === 'manager' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'}`}
            >
              🧑‍💼 Manager
            </button>
          </div>
          <button
            onClick={handleInject}
            disabled={!injectText.trim() || injectLoading || isStepping}
            className="px-3 py-1.5 text-xs font-semibold rounded bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {injectLoading ? 'Sending…' : 'Send →'}
          </button>
        </div>
      </div>

      {showPushModal && (
        <GitHubPushModal
          runId={run.id}
          runTitle={run.title}
          onClose={() => setShowPushModal(false)}
          onSuccess={(url) => {
            setPushState({ status: 'success', url });
            setShowPushModal(false);
          }}
        />
      )}
    </div>
  );
}
