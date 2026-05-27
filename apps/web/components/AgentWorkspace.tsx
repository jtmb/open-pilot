'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import AgentPanel from './AgentPanel';
import FilesModal from './FilesModal';
import MonitorPanel, { type DisplayFinding } from './MonitorPanel';
import { bestFreeModel, type CopilotModel } from './ModelSelector';
import {
  applyReply,
  getStepPayload,
  logEntry,
  parseTokens,
  type AgentRun,
  type RunStatus,
} from '@/services/agentOrchestrator';
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
      /\[COMPLETE\]/.test(t);
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
  const lastWorkerOut = [...run.log].reverse().find(
    e => e.type === 'output' && e.from === 'worker',
  );
  if (lastWorkerOut && !/\[DONE\]/.test(lastWorkerOut.content)) {
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
  const [filesOpen, setFilesOpen] = useState(false);

  // Monitor state
  const [monitorOpen, setMonitorOpen]           = useState(false);
  const [monitorAiEnabled, setMonitorAiEnabled] = useState(true);
  const [allFindings, setAllFindings]           = useState<DisplayFinding[]>([]);
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

  // Refs to access latest values inside async loops without stale closures
  const runRef            = useRef<AgentRun>(run);
  const loopRef           = useRef(false);
  const buildRetriesRef   = useRef(0);

  const setRunAndSync = useCallback((newRun: AgentRun) => {
    runRef.current = newRun;
    setRun(newRun);
    onUpdate(newRun);
  }, [onUpdate]);

  // When monitor models load, pick best free model (unless user already has a saved preference)
  useEffect(() => {
    if (monitorModels.length === 0) return;
    const saved = typeof window !== 'undefined' ? localStorage.getItem('openpilot:monitorModel') : null;
    if (!saved || !monitorModels.some(m => m.id === saved)) {
      const best = bestFreeModel(monitorModels);
      if (best) setMonitorModel(best.id);
    }
  }, [monitorModels]);

  const handleMonitorModelChange = useCallback((id: string) => {
    setMonitorModel(id);
    if (typeof window !== 'undefined') localStorage.setItem('openpilot:monitorModel', id);
  }, []);

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

  const MAX_BUILD_RETRIES = 3;

  const executeOneStep = useCallback(async (currentRun: AgentRun, advisory?: string): Promise<AgentRun | null> => {
    const payload = getStepPayload(currentRun);
    if (!payload) return null;

    const cfg = currentRun.config;
    const model           = payload.isWorker ? cfg.workerModel           : cfg.managerModel;
    const reasoningEffort = payload.isWorker ? cfg.workerReasoningEffort : cfg.managerReasoningEffort;

    // Inject monitor advisory into manager steps (appended to last user message)
    let messages = payload.messages;
    if (!payload.isWorker && advisory) {
      const last = messages[messages.length - 1];
      messages = [
        ...messages.slice(0, -1),
        { ...last, content: last.content + '\n\n' + advisory },
      ];
    }

    const res = await fetch('/api/agents/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        history: messages,
        model,
        reasoningEffort: reasoningEffort || undefined,
      }),
    });

    const data = await res.json() as { reply?: string; error?: string };
    const reply = data.reply ?? `[API Error: ${data.error ?? 'unknown'}]`;

    // ── Manager step: just apply reply ──────────────────────────────────────
    if (!payload.isWorker) {
      return applyReply(currentRun, currentRun.nextStep!, reply);
    }

    // ── Worker step ─────────────────────────────────────────────────────────
    const tokens = parseTokens(reply);

    // Apply reply first so history/logs are updated
    let updated = applyReply(currentRun, currentRun.nextStep!, reply);

    // Extract files from this reply (for syncing to workspace)
    const { extractFilesFromText } = await import('@/utils/fileParser');
    const fileMap = new Map<string, ParsedFile>();
    extractFilesFromText(reply, fileMap);
    const filesThisReply = Array.from(fileMap.values());

    // ── Handle [EXEC: command] tokens ────────────────────────────────────────
    if (tokens.execCommands.length > 0) {
      let filesForFirstCmd = filesThisReply; // sync files only on first command
      for (const cmd of tokens.execCommands) {
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
      return updated;
    }

    // ── Auto-build after [DONE] ──────────────────────────────────────────────
    if (tokens.done && cfg.buildCommand && buildRetriesRef.current < MAX_BUILD_RETRIES) {
      // Collect all files from entire worker history for this run
      const allFileMap = new Map<string, ParsedFile>();
      for (const msg of updated.workerHistory) {
        if (msg.role === 'assistant') extractFilesFromText(msg.content, allFileMap);
      }
      const allFiles = Array.from(allFileMap.values());

      updated = {
        ...updated,
        log: [...updated.log, logEntry('system', 'exec', cfg.buildCommand, 'worker')],
      };

      try {
        const buildRes = await fetch('/api/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: cfg.buildCommand,
            runId: currentRun.id,
            files: allFiles.length > 0 ? allFiles : undefined,
          }),
        });
        const { output, exitCode, error: buildError } =
          await buildRes.json() as { output?: string; exitCode?: number; error?: string };

        const resultText = buildError ? `error: ${buildError}` : (output ?? '');
        const exitLabel  = buildError ? 'error' : `exit ${exitCode}`;
        const passed     = !buildError && exitCode === 0;

        updated = {
          ...updated,
          log: [...updated.log, logEntry('system', 'exec-result', `${exitLabel}\n${resultText}`, 'worker')],
        };

        if (!passed) {
          buildRetriesRef.current += 1;
          // Let worker fix the errors
          updated = {
            ...updated,
            workerHistory: [
              ...updated.workerHistory,
              {
                role: 'user' as const,
                content:
                  `[BUILD_RESULT: exit_code=${exitCode ?? -1}]\n${resultText}\n\n` +
                  `Please fix the errors above and end with [DONE] when the build passes.`,
              },
            ],
            nextStep: 'worker-execute',
            status:   'running',
          };
        } else {
          buildRetriesRef.current = 0;
          // Build passed — proceed to manager review as normal
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        updated = {
          ...updated,
          log: [...updated.log, logEntry('system', 'exec-result', `error\n${msg}`, 'worker')],
        };
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

  const handleStart = useCallback(() => {
    buildRetriesRef.current = 0;
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
    // If nextStep was cleared (e.g. by a blocked worker or manual stop), infer it
    const current = runRef.current;
    const withStep: AgentRun = {
      ...current,
      status: 'running',
      nextStep: current.nextStep ?? inferNextStep(current),
    };
    setRunAndSync(withStep);
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

  const handleExport = useCallback(() => {
    const r = runRef.current;
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
      spec: r.spec,
      workerLog: r.log
        .filter(e => e.target === 'worker' || e.target === 'both')
        .map(e => ({
          time:          new Date(e.timestamp).toISOString(),
          from:          e.from,
          type:          e.type,
          monitorAdvised: e.monitorAdvised ?? false,
          content:       e.content,
        })),
      managerLog: r.log
        .filter(e => e.target === 'manager' || e.target === 'both')
        .map(e => ({
          time:          new Date(e.timestamp).toISOString(),
          from:          e.from,
          type:          e.type,
          monitorAdvised: e.monitorAdvised ?? false,
          content:       e.content,
        })),
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
          {run.currentIteration}/{run.config.maxIterations === 0 ? '∞' : run.config.maxIterations} steps
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleExport}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded border bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
            title="Export all logs and monitor findings as JSON"
          >
            ⬇ Export
          </button>

          <button
            onClick={() => setFilesOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded border bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
            title="Browse and download files produced by the worker agent"
          >
            📁 Files
          </button>

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
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
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
          {run.status === 'paused' && (
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
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
              title="Stop the run (use Resume to continue, or Delete to remove)"
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

      {/* ── Panels ── */}
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
      </div>

      {filesOpen && (
        <FilesModal
          run={run}
          onClose={() => setFilesOpen(false)}
        />
      )}

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
