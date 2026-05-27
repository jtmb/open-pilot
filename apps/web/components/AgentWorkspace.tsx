'use client';
import { useCallback, useRef, useState } from 'react';
import AgentPanel from './AgentPanel';
import {
  applyReply,
  getStepPayload,
  logEntry,
  type AgentRun,
  type RunStatus,
} from '@/services/agentOrchestrator';

interface Props {
  run: AgentRun;
  onUpdate: (run: AgentRun) => void;
  onDelete: () => void;
}

const STATUS_BADGE: Record<RunStatus, { label: string; cls: string }> = {
  idle:     { label: 'Idle',     cls: 'bg-gray-100 text-gray-600'   },
  running:  { label: 'Running',  cls: 'bg-green-100 text-green-700' },
  paused:   { label: 'Paused',   cls: 'bg-yellow-100 text-yellow-700' },
  complete: { label: 'Complete', cls: 'bg-blue-100 text-blue-700'   },
  error:    { label: 'Error',    cls: 'bg-red-100 text-red-700'     },
};

export default function AgentWorkspace({ run: initialRun, onUpdate, onDelete }: Props) {
  const [run, setRun] = useState<AgentRun>(initialRun);
  const [isStepping, setIsStepping] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [injectTarget, setInjectTarget] = useState<'worker' | 'manager'>('worker');
  const [injectText, setInjectText] = useState('');
  const [injectLoading, setInjectLoading] = useState(false);

  // Refs to access latest values inside async loops without stale closures
  const runRef   = useRef<AgentRun>(run);
  const loopRef  = useRef(false);

  const setRunAndSync = useCallback((newRun: AgentRun) => {
    runRef.current = newRun;
    setRun(newRun);
    onUpdate(newRun);
  }, [onUpdate]);

  // ── Core step function ────────────────────────────────────────────────────

  const executeOneStep = useCallback(async (currentRun: AgentRun): Promise<AgentRun | null> => {
    const payload = getStepPayload(currentRun);
    if (!payload) return null;

    const cfg = currentRun.config;
    const model          = payload.isWorker ? cfg.workerModel          : cfg.managerModel;
    const reasoningEffort = payload.isWorker ? cfg.workerReasoningEffort : cfg.managerReasoningEffort;

    const res = await fetch('/api/agents/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        history: payload.messages,
        model,
        reasoningEffort: reasoningEffort || undefined,
      }),
    });

    const data = await res.json() as { reply?: string; error?: string };
    const reply = data.reply ?? `[API Error: ${data.error ?? 'unknown'}]`;

    return applyReply(currentRun, currentRun.nextStep!, reply);
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
      if (r.currentIteration >= r.config.maxIterations) {
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
        const updated = await executeOneStep(r);
        if (!updated) break;
        setRunAndSync(updated);
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
  }, [executeOneStep, setRunAndSync]);

  // ── Controls ──────────────────────────────────────────────────────────────

  const handleStart = useCallback(() => {
    const started = { ...runRef.current, status: 'running' as RunStatus };
    setRunAndSync(started);
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

  const handleResume = useCallback(() => {
    const resumed = { ...runRef.current, status: 'running' as RunStatus };
    setRunAndSync(resumed);
    executeLoop();
  }, [executeLoop, setRunAndSync]);

  const handleStop = useCallback(() => {
    loopRef.current = false;
    const stopped = {
      ...runRef.current,
      status: 'paused' as RunStatus,
      nextStep: null,
      log: [...runRef.current.log, logEntry('system', 'status', '⏹ Run stopped by user.', 'both')],
      updatedAt: Date.now(),
    };
    setRunAndSync(stopped);
  }, [setRunAndSync]);

  // ── User injection ────────────────────────────────────────────────────────

  const handleInject = useCallback(async () => {
    if (!injectText.trim() || injectLoading || isStepping) return;

    const isWorker = injectTarget === 'worker';
    const histKey  = isWorker ? 'workerHistory' : 'managerHistory';
    const sysPrompt = isWorker
      ? (await import('@/services/agentOrchestrator')).WORKER_SYSTEM
      : (await import('@/services/agentOrchestrator')).MANAGER_SYSTEM;

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
      const data = await res.json() as { reply?: string; error?: string };
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
    <div className="flex flex-col h-full bg-white">

      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-5 py-3 border-b bg-gray-50 shrink-0 flex-wrap gap-y-2">
        <span className="font-bold text-gray-800 truncate max-w-xs">{run.title}</span>

        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>
          {badge.label}
          {run.status === 'running' && (
            <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-ping" />
          )}
        </span>

        <span className="text-xs text-gray-400">
          {run.currentIteration}/{run.config.maxIterations} steps
        </span>

        <div className="ml-auto flex items-center gap-2">
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
          {run.status === 'paused' && run.nextStep && (
            <button
              onClick={handleResume}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded bg-green-600 text-white hover:bg-green-700"
            >
              ▶ Resume
            </button>
          )}
          {(run.status === 'running' || run.status === 'paused') && (
            <button
              onClick={handleStop}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
            >
              ⏹ Stop
            </button>
          )}
          <button
            onClick={onDelete}
            className="px-3 py-1.5 text-xs font-semibold rounded border border-red-200 text-red-500 hover:bg-red-50"
          >
            🗑 Delete
          </button>
        </div>
      </div>

      {/* ── Dual panels ── */}
      <div className="flex flex-1 overflow-hidden divide-x">
        <div className="flex-1 overflow-hidden">
          <AgentPanel
            label="Worker Agent"
            icon="👷"
            modelBadge={`${run.config.workerModel}${run.config.workerReasoningEffort ? ` · ${run.config.workerReasoningEffort}` : ''}`}
            log={run.log}
            loading={workerLoading}
            panelTarget="worker"
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
          />
        </div>
      </div>

      {/* ── User steer bar ── */}
      <div className="flex items-start gap-2 px-4 py-3 border-t bg-gray-50 shrink-0">
        <div className="flex-1 relative">
          <textarea
            rows={2}
            className="w-full border rounded px-3 py-2 text-sm resize-none pr-2"
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
              className={`px-2 py-1 text-xs rounded border font-medium ${injectTarget === 'worker' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              👷 Worker
            </button>
            <button
              onClick={() => setInjectTarget('manager')}
              className={`px-2 py-1 text-xs rounded border font-medium ${injectTarget === 'manager' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
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
    </div>
  );
}
