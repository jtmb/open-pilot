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
}

// ─── Styling maps ─────────────────────────────────────────────────────────────

const TYPE_STYLES: Record<LogEntryType, { wrapper: string; badge: string; label: string }> = {
  task:       { wrapper: 'bg-blue-50 border-blue-200',    badge: 'bg-blue-100 text-blue-700',    label: 'Task'       },
  output:     { wrapper: 'bg-white border-gray-200',      badge: 'bg-gray-100 text-gray-600',    label: 'Output'     },
  question:   { wrapper: 'bg-amber-50 border-amber-200',  badge: 'bg-amber-100 text-amber-700',  label: 'Question'   },
  answer:     { wrapper: 'bg-teal-50 border-teal-200',    badge: 'bg-teal-100 text-teal-700',    label: 'Answer'     },
  review:     { wrapper: 'bg-purple-50 border-purple-200',badge: 'bg-purple-100 text-purple-700',label: 'Review'     },
  correction: { wrapper: 'bg-orange-50 border-orange-200',badge: 'bg-orange-100 text-orange-700',label: 'Correction' },
  directive:  { wrapper: 'bg-indigo-50 border-indigo-200',badge: 'bg-indigo-100 text-indigo-700',label: 'Directive'  },
  status:     { wrapper: 'bg-gray-50 border-gray-200',    badge: 'bg-gray-100 text-gray-500',    label: 'System'     },
  'user-input':{ wrapper: 'bg-green-50 border-green-200', badge: 'bg-green-100 text-green-700',  label: 'You'        },
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

function Entry({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const styles = TYPE_STYLES[entry.type] ?? TYPE_STYLES.status;
  const isLong = entry.content.length > COLLAPSE_THRESHOLD;
  const displayContent = !isLong || expanded ? entry.content : entry.content.slice(0, COLLAPSE_THRESHOLD) + '…';

  return (
    <div className={`border rounded-lg p-3 text-sm ${styles.wrapper}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${styles.badge}`}>
          {styles.label}
        </span>
        <span className="text-xs text-gray-400">
          {new Date(entry.timestamp).toLocaleTimeString()}
        </span>
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

export default function AgentPanel({ label, icon, modelBadge, log, loading, panelTarget }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  const visible = log.filter(e => e.target === panelTarget || e.target === 'both');

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visible.length]);

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
      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-white">
        {visible.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            {loading ? 'Waiting…' : 'No messages yet.'}
          </div>
        )}
        {visible.map(entry => (
          <Entry key={entry.id} entry={entry} />
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
