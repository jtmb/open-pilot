'use client';
import { useEffect, useRef, useState } from 'react';
import type { LogEntry, LogEntryType } from '@/services/agentOrchestrator';

interface Props {
  label: string;
  icon: string;
  modelBadge: string;
  log: LogEntry[];
  loading: boolean;
  /** Which target to filter by ('worker' or 'manager') */
  panelTarget: 'worker' | 'manager';
  /** Entry id to scroll to and highlight; all others are dimmed */
  highlightedEntryId?: string | null;
  /** Hide checkpoint log entries */
  hideCheckpointMessages?: boolean;
  /** Called when user clicks a dimmed entry or the backdrop to clear highlight */
  onClearHighlight?: () => void;
}

// ─── Styling maps ─────────────────────────────────────────────────────────────

const TYPE_STYLES: Record<LogEntryType, { wrapper: string; badge: string; label: string; tooltip: string }> = {
  task:         { wrapper: 'bg-white border border-l-4 border-l-blue-400',    badge: 'bg-blue-50 text-blue-700',    label: 'Task',         tooltip: 'Manager assigned a new task to the worker agent'                                         },
  output:       { wrapper: 'bg-white border border-gray-200',                  badge: 'bg-gray-100 text-gray-600',   label: 'Output',       tooltip: "Worker's code or text output in response to its last task"                            },
  question:     { wrapper: 'bg-white border border-l-4 border-l-amber-400',   badge: 'bg-amber-50 text-amber-700',  label: 'Question',     tooltip: 'Worker is asking the manager for clarification before proceeding'                     },
  answer:       { wrapper: 'bg-white border border-l-4 border-l-teal-400',    badge: 'bg-teal-50 text-teal-700',    label: 'Answer',       tooltip: "Manager answered the worker's question"                                               },
  review:       { wrapper: 'bg-white border border-l-4 border-l-purple-400',  badge: 'bg-purple-50 text-purple-700',label: 'Review',       tooltip: "Manager's full review of the worker's completed work"                                  },
  correction:   { wrapper: 'bg-white border border-l-4 border-l-orange-400',  badge: 'bg-orange-50 text-orange-700',label: 'Correction',   tooltip: 'Manager is requesting changes or corrections to the work'                            },
  directive:    { wrapper: 'bg-white border border-l-4 border-l-indigo-400',  badge: 'bg-indigo-50 text-indigo-700',label: 'Directive',    tooltip: 'Manager is giving the worker explicit instructions or guidance'                      },
  status:       { wrapper: '',                                                  badge: 'bg-gray-100 text-gray-400',   label: 'System',       tooltip: 'Automated system event or status update (not from an agent)'                        },
  'user-input': { wrapper: 'bg-white border border-l-4 border-l-green-400',   badge: 'bg-green-50 text-green-700',  label: 'You',          tooltip: 'Your direct message injected into the conversation'                                  },
  'exec':       { wrapper: 'bg-gray-900 border-gray-700',                      badge: 'bg-gray-700 text-green-400',  label: 'Run',          tooltip: 'Shell command requested by the worker to run in the workspace container'              },
  'exec-result':{ wrapper: 'bg-gray-900 border-gray-700',                      badge: 'bg-gray-700 text-gray-300',   label: 'Output',       tooltip: 'stdout/stderr output and exit code from the executed shell command'                   },
  'checkpoint': { wrapper: '',                                                  badge: 'bg-indigo-50 text-indigo-600', label: '📍 Checkpoint', tooltip: 'Workspace snapshot automatically saved after this command succeeded — restorable from the Checkpoints panel' },
};

const COLLAPSE_THRESHOLD = 400; // chars

// ─── Content renderer — simple code-block highlighting ───────────────────────

function renderContent(text: string) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith('```')) {
      const lines = part.split('\n');
      const lang = lines[0].slice(3).trim();
      const code = lines.slice(1, -1).join('\n');
      return (
        <pre
          key={i}
          className="bg-gray-900 text-gray-100 rounded p-3 my-2 text-xs overflow-x-auto font-mono leading-relaxed"
        >
          {lang && <div className="text-gray-500 text-xs mb-1 font-sans">{lang}</div>}
          {code}
        </pre>
      );
    }
    return (
      <span key={i} className="whitespace-pre-wrap break-words">
        {part}
      </span>
    );
  });
}

// ─── Single entry ─────────────────────────────────────────────────────────────

function Entry({
  entry,
  highlighted,
  dimmed,
  onDismiss,
}: {
  entry: LogEntry;
  highlighted?: boolean;
  dimmed?: boolean;
  onDismiss?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const styles = TYPE_STYLES[entry.type] ?? TYPE_STYLES.status;

  const outerClass = [
    'transition-opacity duration-200',
    highlighted ? 'ring-2 ring-indigo-400 rounded-lg shadow-lg scroll-mt-4' : '',
    dimmed ? 'opacity-20 cursor-pointer select-none' : '',
  ].join(' ');

  // ── Slim annotation for status / checkpoint entries ────────────────────────
  if (entry.type === 'status') {
    return (
      <div
        data-entry-id={entry.id}
        className={`flex items-center gap-2 px-2 py-1 border-l-2 border-gray-300 ${outerClass}`}
        onClick={dimmed ? onDismiss : undefined}
      >
        <span className="text-[10px] text-gray-400 shrink-0">{new Date(entry.timestamp).toLocaleTimeString()}</span>
        <span className="text-xs text-gray-400 italic">{entry.content}</span>
      </div>
    );
  }

  if (entry.type === 'checkpoint') {
    return (
      <div
        data-entry-id={entry.id}
        className={`flex items-center gap-2 px-2 py-1 border-l-2 border-indigo-300 ${outerClass}`}
        onClick={dimmed ? onDismiss : undefined}
      >
        <span className="text-[10px] text-gray-400 shrink-0">{new Date(entry.timestamp).toLocaleTimeString()}</span>
        <span className="text-[11px] font-medium text-indigo-500">{entry.content}</span>
      </div>
    );
  }

  // ── Terminal-style rendering for exec entries ─────────────────────────────
  if (entry.type === 'exec') {
    return (
      <div
        data-entry-id={entry.id}
        className={`border border-gray-700 rounded-lg bg-gray-900 p-3 text-sm font-mono ${outerClass}`}
        onClick={dimmed ? onDismiss : undefined}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <span
            className="text-xs font-semibold px-1.5 py-0.5 rounded bg-gray-700 text-green-400 cursor-help"
            title={TYPE_STYLES['exec'].tooltip}
          >
            $ run
          </span>
          <span className="text-xs text-gray-500">{new Date(entry.timestamp).toLocaleTimeString()}</span>
        </div>
        <span className="text-green-400 text-xs">$ </span>
        <span className="text-gray-100 text-xs break-all">{entry.content}</span>
      </div>
    );
  }

  if (entry.type === 'exec-result') {
    const [exitLine, ...rest] = entry.content.split('\n');
    const exitCode = parseInt(exitLine?.replace('exit ', '') ?? '-1', 10);
    const passed   = exitCode === 0;
    const output   = rest.join('\n').trim();
    const isLong   = output.length > COLLAPSE_THRESHOLD;
    const shown    = !isLong || expanded ? output : output.slice(0, COLLAPSE_THRESHOLD) + '…';

    return (
      <div
        data-entry-id={entry.id}
        className={`border border-gray-700 rounded-lg bg-gray-900 p-3 text-sm font-mono ${outerClass}`}
        onClick={dimmed ? onDismiss : undefined}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded cursor-help ${passed ? 'bg-green-800 text-green-300' : 'bg-red-900 text-red-300'}`}
            title={TYPE_STYLES['exec-result'].tooltip}
          >
            {passed ? '✓' : '✗'} {exitLine}
          </span>
          <span className="text-xs text-gray-500">{new Date(entry.timestamp).toLocaleTimeString()}</span>
        </div>
        {output && (
          <pre className="text-gray-300 text-xs leading-relaxed whitespace-pre-wrap break-words mt-1 max-h-64 overflow-y-auto">
            {shown}
          </pre>
        )}
        {isLong && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="mt-1 text-xs text-blue-400 hover:text-blue-300 font-medium"
          >
            {expanded ? 'Show less ↑' : 'Show more ↓'}
          </button>
        )}
      </div>
    );
  }

  // ── Standard entry ────────────────────────────────────────────────────────
  const isLong = entry.content.length > COLLAPSE_THRESHOLD;
  const displayContent = !isLong || expanded ? entry.content : entry.content.slice(0, COLLAPSE_THRESHOLD) + '…';

  return (
    <div
      data-entry-id={entry.id}
      className={`rounded-lg p-3 text-sm ${styles.wrapper}${entry.monitorAdvised ? ' border-l-teal-400' : ''} ${outerClass}`}
      onClick={dimmed ? onDismiss : undefined}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded cursor-help ${styles.badge}`} title={styles.tooltip}>
          {styles.label}
        </span>
        <span className="text-xs text-gray-400">
          {new Date(entry.timestamp).toLocaleTimeString()}
        </span>
        {entry.monitorAdvised && (
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 font-semibold border border-teal-200 shrink-0">
            📡 monitor advised
          </span>
        )}
      </div>
      <div className="text-xs leading-relaxed">
        {renderContent(displayContent)}
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-2 text-xs text-blue-500 hover:text-blue-700 font-medium"
        >
          {expanded ? 'Show less ↑' : 'Show more ↓'}
        </button>
      )}
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export default function AgentPanel({
  label,
  icon,
  modelBadge,
  log,
  loading,
  panelTarget,
  highlightedEntryId,
  hideCheckpointMessages,
  onClearHighlight,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const visible = log.filter(
    e =>
      (e.target === panelTarget || e.target === 'both') &&
      !(hideCheckpointMessages && e.type === 'checkpoint'),
  );

  // Auto-scroll to bottom when new messages arrive (skip when a message is highlighted)
  useEffect(() => {
    if (highlightedEntryId) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visible.length, highlightedEntryId]);

  // Scroll to highlighted entry when it changes
  useEffect(() => {
    if (!highlightedEntryId || !containerRef.current) return;
    const el = containerRef.current.querySelector(`[data-entry-id="${highlightedEntryId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightedEntryId]);

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Panel header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-gray-50 shrink-0">
        <span className="text-base">{icon}</span>
        <span className="font-semibold text-sm text-gray-800">{label}</span>
        {modelBadge && (
          <span className="ml-auto text-xs bg-gray-200 text-gray-600 rounded px-2 py-0.5 truncate max-w-[160px]">
            {modelBadge}
          </span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-white dark:bg-gray-800" ref={containerRef}>
        {visible.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            {loading ? 'Waiting…' : 'No messages yet.'}
          </div>
        )}
        {visible.map(entry => (
          <Entry
            key={entry.id}
            entry={entry}
            highlighted={highlightedEntryId === entry.id}
            dimmed={!!highlightedEntryId && highlightedEntryId !== entry.id}
            onDismiss={onClearHighlight}
          />
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-gray-400 animate-pulse px-1">
            <span className="w-2 h-2 rounded-full bg-gray-400 inline-block animate-bounce" />
            Thinking…
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
