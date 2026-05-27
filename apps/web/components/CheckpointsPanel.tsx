'use client';

import React, { useState, useCallback } from 'react';
import type { Checkpoint } from '@/services/agentOrchestrator';

interface Props {
  runId: string;
  checkpoints: Checkpoint[];
  isRunning: boolean;
  onClose: () => void;
  /** Called after a successful restore so the parent can pause the run */
  onRestored: () => void;
  /** Whether checkpoint log entries are hidden in both chat panels */
  hideCheckpointLogs: boolean;
  onToggleHideCheckpointLogs: () => void;
  /** Called when user clicks a checkpoint row — parent scrolls the chat to that entry */
  onSelectCheckpoint: (logEntryId: string) => void;
}

interface DiffState {
  status: 'loading' | 'loaded' | 'error';
  content: string;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

/** Parse and render a unified diff with line-level coloring */
function DiffViewer({ diff }: { diff: string }) {
  if (!diff.trim()) {
    return <p className="text-xs text-gray-400 italic py-2">No changes since this checkpoint.</p>;
  }
  const lines = diff.split('\n');
  return (
    <pre className="text-[11px] font-mono leading-snug overflow-x-auto whitespace-pre">
      {lines.map((line, i) => {
        let cls = 'text-gray-400';
        if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
          cls = 'text-gray-500 font-semibold';
        } else if (line.startsWith('@@')) {
          cls = 'text-blue-500';
        } else if (line.startsWith('+')) {
          cls = 'text-green-600 bg-green-50';
        } else if (line.startsWith('-')) {
          cls = 'text-red-600 bg-red-50';
        }
        return (
          <span key={i} className={`block ${cls}`}>{line || ' '}</span>
        );
      })}
    </pre>
  );
}

export default function CheckpointsPanel({
  runId,
  checkpoints,
  isRunning,
  onClose,
  onRestored,
  hideCheckpointLogs,
  onToggleHideCheckpointLogs,
  onSelectCheckpoint,
}: Props) {
  // Map from checkpoint id → restore state: 'idle' | 'confirm' | 'restoring' | 'ok' | 'error:<msg>'
  const [states, setStates] = useState<Record<string, string>>({});
  // Map from checkpoint id → diff state
  const [diffs, setDiffs] = useState<Record<string, DiffState>>({});
  // Which checkpoint diff is expanded (only one at a time)
  const [diffOpen, setDiffOpen] = useState<string | null>(null);

  const setState = (id: string, s: string) =>
    setStates(prev => ({ ...prev, [id]: s }));

  const handleToggleDiff = useCallback(async (cp: Checkpoint) => {
    // Collapse if already open
    if (diffOpen === cp.id) {
      setDiffOpen(null);
      return;
    }
    setDiffOpen(cp.id);
    // If already loaded (or loading), don't re-fetch
    if (diffs[cp.id]) return;

    setDiffs(prev => ({ ...prev, [cp.id]: { status: 'loading', content: '' } }));
    try {
      const res = await fetch(`/api/exec/checkpoint/diff?runId=${encodeURIComponent(runId)}&commitHash=${encodeURIComponent(cp.commitHash)}`);
      const data = await res.json() as { diff?: string; error?: string };
      if (!res.ok || data.error) {
        setDiffs(prev => ({ ...prev, [cp.id]: { status: 'error', content: data.error ?? 'Failed to load diff' } }));
      } else {
        setDiffs(prev => ({ ...prev, [cp.id]: { status: 'loaded', content: data.diff ?? '' } }));
      }
    } catch (e) {
      setDiffs(prev => ({ ...prev, [cp.id]: { status: 'error', content: e instanceof Error ? e.message : 'Network error' } }));
    }
  }, [runId, diffs, diffOpen]);

  const handleRestore = useCallback(
    async (cp: Checkpoint) => {
      const current = states[cp.id] ?? 'idle';

      if (current === 'idle') {
        // First click — show confirm
        setState(cp.id, 'confirm');
        // Auto-reset after 4 s
        setTimeout(() => {
          setStates(prev => (prev[cp.id] === 'confirm' ? { ...prev, [cp.id]: 'idle' } : prev));
        }, 4000);
        return;
      }

      if (current !== 'confirm') return;

      setState(cp.id, 'restoring');
      try {
        const res = await fetch('/api/exec/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId, commitHash: cp.commitHash }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) {
          setState(cp.id, `error:${data.error ?? 'restore failed'}`);
        } else {
          setState(cp.id, 'ok');
          onRestored();
        }
      } catch (e) {
        setState(cp.id, `error:${e instanceof Error ? e.message : 'network error'}`);
      }
    },
    [runId, states, onRestored],
  );

  const sorted = [...checkpoints].reverse();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-white shrink-0">
        <span className="text-sm font-semibold text-gray-800">
          📍 Checkpoints
          {checkpoints.length > 0 && (
            <span className="ml-1.5 text-xs font-medium text-gray-400">({checkpoints.length})</span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleHideCheckpointLogs}
            title={hideCheckpointLogs ? 'Show checkpoint messages in chat' : 'Hide checkpoint messages in chat'}
            className={`text-xs px-2 py-0.5 rounded border font-medium transition-colors ${
              hideCheckpointLogs
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {hideCheckpointLogs ? '🚫 in chat' : '💬 in chat'}
          </button>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
            aria-label="Close checkpoints panel"
          >
            ×
          </button>
        </div>
      </div>

      {/* Restore note */}
      <div className="px-4 py-2 text-xs text-gray-500 bg-amber-50 border-b border-amber-100 shrink-0">
        Restoring resets workspace code only — conversation history is preserved.
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-gray-400">
            Checkpoints are created automatically after each successful command.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {sorted.map((cp, idx) => {
              const s = states[cp.id] ?? 'idle';
              const isRestoring = s === 'restoring';
              const isOk = s === 'ok';
              const isConfirm = s === 'confirm';
              const isError = s.startsWith('error:');
              // Ordinal based on original creation order (sorted is reversed)
              const ordinal = sorted.length - idx;

              return (
                <li key={cp.id} className="px-4 py-3 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className="min-w-0 flex-1 cursor-pointer group"
                      title="Click to highlight this checkpoint in the chat"
                      onClick={() => onSelectCheckpoint(cp.logEntryId)}
                    >
                      {/* Friendly name */}
                      <p className="text-xs font-semibold text-indigo-700 group-hover:text-indigo-900 truncate">
                        {cp.name ?? `Checkpoint ${ordinal}`}
                      </p>
                      {/* Raw command */}
                      <p className="text-xs text-gray-500 truncate mt-0.5" title={cp.label}>
                        {cp.label.replace(/^exec:\s*/, '')}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Iter&nbsp;{cp.iteration}&nbsp;·&nbsp;{relativeTime(cp.createdAt)}
                      </p>
                      <p className="text-[10px] font-mono text-gray-300 mt-0.5">
                        {cp.commitHash.slice(0, 7)}
                      </p>
                    </div>

                    <button
                      disabled={isRestoring || isOk}
                      onClick={() => handleRestore(cp)}
                      className={[
                        'shrink-0 text-xs font-semibold px-2.5 py-1 rounded border transition-colors',
                        isConfirm
                          ? 'bg-orange-500 text-white border-orange-500 hover:bg-orange-600'
                          : isRestoring
                          ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                          : isOk
                          ? 'bg-green-50 text-green-600 border-green-200 cursor-not-allowed'
                          : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50',
                      ].join(' ')}
                    >
                      {isConfirm ? 'Confirm?' : isRestoring ? 'Restoring…' : isOk ? 'Restored' : 'Restore'}
                    </button>

                    <button
                      onClick={() => handleToggleDiff(cp)}
                      title="Show diff from this checkpoint to current state"
                      className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded border transition-colors ${
                        diffOpen === cp.id
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      ≈ Diff
                    </button>
                  </div>
                  {(isError || isOk) && (
                    <p className={`text-xs mt-1 ${isError ? 'text-red-500' : 'text-green-600'}`}>
                      {isError ? `❌ ${s.slice('error:'.length)}` : '✅ Restored'}
                    </p>
                  )}
                  {/* Diff viewer */}
                  {diffOpen === cp.id && (
                    <div className="mt-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 max-h-80 overflow-y-auto">
                      <p className="text-[10px] text-gray-400 mb-1">Changes since this checkpoint → current state</p>
                      {!diffs[cp.id] || diffs[cp.id].status === 'loading' ? (
                        <p className="text-xs text-gray-400 animate-pulse">Loading diff…</p>
                      ) : diffs[cp.id].status === 'error' ? (
                        <p className="text-xs text-red-500">❌ {diffs[cp.id].content}</p>
                      ) : (
                        <DiffViewer diff={diffs[cp.id].content} />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
