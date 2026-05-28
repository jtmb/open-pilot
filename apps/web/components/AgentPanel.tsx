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
  /** Run ID — used to construct code-server file links */
  runId?: string;
  /** Called when the user clicks the rewind button on an entry */
  onRewind?: (entryId: string) => void;
}

// ─── Styling maps ─────────────────────────────────────────────────────────────

const TYPE_STYLES: Record<LogEntryType, { wrapper: string; badge: string; label: string; tooltip: string }> = {
  task:         { wrapper: 'bg-white dark:bg-gray-700 border dark:border-gray-600 border-l-4 border-l-blue-400',    badge: 'bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',    label: 'Task',         tooltip: 'Manager assigned a new task to the worker agent'                                         },
  output:       { wrapper: 'bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600',                  badge: 'bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300',      label: 'Output',       tooltip: "Worker's code or text output in response to its last task"                            },
  question:     { wrapper: 'bg-white dark:bg-gray-700 border dark:border-gray-600 border-l-4 border-l-amber-400',   badge: 'bg-amber-50 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300', label: 'Question',     tooltip: 'Worker is asking the manager for clarification before proceeding'                     },
  answer:       { wrapper: 'bg-white dark:bg-gray-700 border dark:border-gray-600 border-l-4 border-l-teal-400',    badge: 'bg-teal-50 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300',    label: 'Answer',       tooltip: "Manager answered the worker's question"                                               },
  review:       { wrapper: 'bg-white dark:bg-gray-700 border dark:border-gray-600 border-l-4 border-l-purple-400',  badge: 'bg-purple-50 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300', label: 'Review',   tooltip: "Manager's full review of the worker's completed work"                                  },
  correction:   { wrapper: 'bg-white dark:bg-gray-700 border dark:border-gray-600 border-l-4 border-l-orange-400',  badge: 'bg-orange-50 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300', label: 'Correction', tooltip: 'Manager is requesting changes or corrections to the work'                            },
  directive:    { wrapper: 'bg-white dark:bg-gray-700 border dark:border-gray-600 border-l-4 border-l-indigo-400',  badge: 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300', label: 'Directive',  tooltip: 'Manager is giving the worker explicit instructions or guidance'                      },
  status:       { wrapper: '',                                                                                        badge: 'bg-gray-100 dark:bg-gray-700 text-gray-400',                          label: 'System',       tooltip: 'Automated system event or status update (not from an agent)'                        },
  'user-input': { wrapper: 'bg-white dark:bg-gray-700 border dark:border-gray-600 border-l-4 border-l-green-400',   badge: 'bg-green-50 dark:bg-green-900/40 text-green-700 dark:text-green-300',  label: 'You',          tooltip: 'Your direct message injected into the conversation'                                  },
  'exec':       { wrapper: 'bg-gray-900 border-gray-700',                                                            badge: 'bg-gray-700 text-green-400',                                           label: 'Run',          tooltip: 'Shell command requested by the worker to run in the workspace container'              },
  'exec-result':{ wrapper: 'bg-gray-900 border-gray-700',                                                            badge: 'bg-gray-700 text-gray-300',                                            label: 'Output',       tooltip: 'stdout/stderr output and exit code from the executed shell command'                   },
  'checkpoint': { wrapper: '',                                                                                        badge: 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300', label: '📍 Checkpoint', tooltip: 'Workspace snapshot automatically saved after this command succeeded — restorable from the Checkpoints panel' },
  'file-context':{ wrapper: '',                                                                                        badge: 'bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300', label: '📁 Files',  tooltip: 'Workspace file listing or file content injected into worker context before this step' },
};

const COLLAPSE_THRESHOLD = 400; // chars

// ─── File context entry — collapsible workspace snapshot ─────────────────────

function FileContextEntry({
  entry, files, runId, outerClass, onDismiss, dimmed,
}: {
  entry: LogEntry;
  files: string[];
  runId?: string;
  outerClass: string;
  onDismiss?: () => void;
  dimmed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [openedFile, setOpenedFile] = useState<string | null>(null);

  const workspaceFolder = runId ? `/home/coder/workspace/${runId}` : null;

  async function openInCodeServer(relPath: string) {
    if (!runId || !workspaceFolder) return;
    const folderParam = encodeURIComponent(workspaceFolder);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2_000);
      const res = await fetch('/api/exec/open-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, filePath: relPath }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        // Bridge opened the file in the existing code-server tab — flash the pill
        setOpenedFile(relPath);
        setTimeout(() => setOpenedFile(null), 2_000);
        return;
      }
    } catch { /* fall through */ }
    // Bridge unavailable — open code-server folder in new tab
    window.open(`http://localhost:8080/?folder=${folderParam}`, '_blank', 'noopener,noreferrer');
  }

  return (
    <div
      data-entry-id={entry.id}
      className={`border-l-2 border-emerald-300 px-2 py-1 ${outerClass}`}
      onClick={dimmed ? onDismiss : undefined}
    >
      <button
        className="flex items-center gap-2 w-full text-left"
        onClick={() => !dimmed && setOpen(o => !o)}
      >
        <span className="text-[10px] text-gray-400 shrink-0">{new Date(entry.timestamp).toLocaleTimeString()}</span>
        <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
          📁 Workspace snapshot — {files.length} file{files.length !== 1 ? 's' : ''}
        </span>
        <span className="text-[10px] text-gray-400 ml-auto">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {files.map((f, i) => runId ? (
            <button
              key={i}
              onClick={() => openInCodeServer(f)}
              title={`Open ${f} in code-server`}
              className={`group flex items-center gap-1 text-[10px] font-mono rounded px-1.5 py-0.5 border transition-colors cursor-pointer ${
                openedFile === f
                  ? 'bg-emerald-200 dark:bg-emerald-700 text-emerald-900 dark:text-emerald-100 border-emerald-400'
                  : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-800/50 hover:border-emerald-400'
              }`}
            >
              {openedFile === f ? '✓ opened' : f}
              {openedFile !== f && (
                <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="opacity-40 group-hover:opacity-80 shrink-0" aria-hidden="true">
                  <path d="M1 2.75A.75.75 0 011.75 2h5.5a.75.75 0 010 1.5H2.5v9h9v-4.75a.75.75 0 011.5 0V13.25a.75.75 0 01-.75.75H1.75A.75.75 0 011 13.25V2.75z"/>
                  <path d="M12.5 1a.75.75 0 01.75.75v3.5h-1.5V3.56L8.53 6.78A.75.75 0 117.47 5.72l3.22-3.22H8.25a.75.75 0 010-1.5h4.25z"/>
                </svg>
              )}
            </button>
          ) : (
            <span
              key={i}
              className="text-[10px] font-mono bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 rounded px-1.5 py-0.5 border border-emerald-200 dark:border-emerald-700"
            >
              {f}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

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
  runId,
  highlighted,
  dimmed,
  onDismiss,
  onRewind,
}: {
  entry: LogEntry;
  runId?: string;
  highlighted?: boolean;
  dimmed?: boolean;
  onDismiss?: () => void;
  onRewind?: (entryId: string) => void;
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

  // ── File context: workspace snapshot or [READ:] result ────────────────────
  if (entry.type === 'file-context') {
    const isRead = entry.content.startsWith('READ:');
    if (isRead) {
      const path = entry.content.slice(5).trim();
      return (
        <div
          data-entry-id={entry.id}
          className={`flex items-center gap-2 px-2 py-1 border-l-2 border-emerald-300 ${outerClass}`}
          onClick={dimmed ? onDismiss : undefined}
        >
          <span className="text-[10px] text-gray-400 shrink-0">{new Date(entry.timestamp).toLocaleTimeString()}</span>
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400">📄 Read into context: <span className="font-mono">{path}</span></span>
        </div>
      );
    }
    // Workspace snapshot — collapsible file grid
    const files = entry.content.split('\n').map(l => l.replace(/^\.\//,'')).filter(Boolean);
    return (
      <FileContextEntry
        entry={entry}
        files={files}
        runId={runId}
        outerClass={outerClass}
        onDismiss={onDismiss}
        dimmed={dimmed}
      />
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
        className={`group border border-gray-700 rounded-lg bg-gray-900 p-3 text-sm font-mono ${outerClass}`}
        onClick={dimmed ? onDismiss : undefined}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded cursor-help ${passed ? 'bg-green-800 text-green-300' : 'bg-red-900 text-red-300'}`}
            title={TYPE_STYLES['exec-result'].tooltip}
          >
            {passed ? '✓' : '✗'} {exitLine}
          </span>
          <span className="text-xs text-gray-500">{new Date(entry.timestamp).toLocaleTimeString()}</span>
          {onRewind && !dimmed && (
            <button
              onClick={e => { e.stopPropagation(); onRewind(entry.id); }}
              title="Rewind workspace and agent histories to this point"
              className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-700 hover:bg-amber-800/50 font-semibold shrink-0"
            >
              ⏪ rewind
            </button>
          )}
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
      className={`group rounded-lg p-3 text-sm ${styles.wrapper}${entry.monitorAdvised ? ' border-l-teal-400' : ''} ${outerClass}`}
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
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 font-semibold border border-teal-200 dark:border-teal-700 shrink-0">
            📡 monitor advised
          </span>
        )}
        {onRewind && !dimmed && (
          <button
            onClick={e => { e.stopPropagation(); onRewind(entry.id); }}
            title="Rewind workspace and agent histories to this point"
            className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-800/50 font-semibold shrink-0"
          >
            ⏪ rewind
          </button>
        )}
      </div>
      <div className="text-xs leading-relaxed text-gray-800 dark:text-gray-200">
        {renderContent(displayContent)}
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-2 text-xs text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
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
  runId,
  onRewind,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  const visible = log.filter(
    e =>
      (e.target === panelTarget || e.target === 'both') &&
      !(hideCheckpointMessages && e.type === 'checkpoint'),
  );

  // Auto-scroll to bottom: instant on initial mount (page reload), smooth on new messages
  useEffect(() => {
    if (highlightedEntryId) return;
    const behavior = mountedRef.current ? 'smooth' : 'instant';
    mountedRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior } as ScrollIntoViewOptions);
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
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80 shrink-0">
        <span className="text-base">{icon}</span>
        <span className="font-semibold text-sm text-gray-800 dark:text-gray-100">{label}</span>
        {modelBadge && (
          <span className="ml-auto text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded px-2 py-0.5 truncate max-w-[160px]">
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
            runId={runId}
            highlighted={highlightedEntryId === entry.id}
            dimmed={!!highlightedEntryId && highlightedEntryId !== entry.id}
            onDismiss={onClearHighlight}
            onRewind={onRewind}
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
