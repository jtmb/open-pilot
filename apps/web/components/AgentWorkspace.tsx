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
  logEntry,
  makeLogId,
  parseTokens,
  type AgentRun,
  type Checkpoint,
  type RunStatus,
} from '@/services/agentOrchestrator';
import CheckpointsPanel from './CheckpointsPanel';
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
  const [checkpointsOpen, setCheckpointsOpen] = useState(false);
  const [hideCheckpointLogs, setHideCheckpointLogs] = useState(true);
  const [highlightedEntryId, setHighlightedEntryId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [restartConfirm, setRestartConfirm] = useState(false);
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

  const { data: session } = useSession();

  // Refs to access latest values inside async loops without stale closures
  const runRef            = useRef<AgentRun>(run);
  const loopRef           = useRef(false);

  const setRunAndSync = useCallback((newRun: AgentRun) => {
    runRef.current = newRun;
    setRun(newRun);
    onUpdate(newRun);
  }, [onUpdate]);

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
          const execPassed = !execError && exitCode === 0;

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
      return updated;
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
    setPreviewUrl(null);
    // Stop any running preview from a previous run of the same id
    fetch('/api/exec/serve', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: runRef.current.id }),
    }).catch(() => {});
    // Initialise workspace with AGENTS.md + CLAUDE.md (fire-and-forget before loop)
    fetch('/api/exec/workspace-init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: runRef.current.id, title: runRef.current.title, spec: runRef.current.spec }),
    }).catch(() => {});
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
      status: 'idle',
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
    // Re-seed the workspace with AGENTS.md + CLAUDE.md
    fetch('/api/exec/workspace-init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: r.id, title: r.title, spec: r.spec }),
    }).catch(() => {});
    setRunAndSync(restarted);
  }, [restartConfirm, setRunAndSync]);

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

        <span className="text-xs text-gray-400">
          {run.currentIteration}/{run.config.maxIterations === 0 ? '∞' : run.config.maxIterations} steps
        </span>

        <div className="ml-auto flex items-center gap-2">
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
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded border bg-blue-600 text-white border-blue-600 hover:bg-blue-700"
              title="Start preview server and open the app"
            >
              ▶ Preview
            </button>
          )}
          {previewUrl && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded border bg-green-600 text-white border-green-600 hover:bg-green-700"
              title={`Open preview at ${previewUrl}`}
            >
              ↗ Open Preview
            </a>
          )}

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

          <button
            onClick={onDelete}
            className="px-3 py-1.5 text-xs font-semibold rounded border border-red-200 dark:border-red-800 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
          >
            🗑 Delete
          </button>
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
            highlightedEntryId={highlightedEntryId}
            hideCheckpointMessages={hideCheckpointLogs}
            onClearHighlight={() => setHighlightedEntryId(null)}
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

        {/* Checkpoints panel — collapsible right sidebar */}
        {checkpointsOpen && (
          <div className="w-72 shrink-0 overflow-hidden border-l flex flex-col">
            <CheckpointsPanel
              runId={run.id}
              checkpoints={run.checkpoints ?? []}
              isRunning={run.status === 'running'}
              onClose={() => setCheckpointsOpen(false)}
              onRestored={handleRestored}
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
