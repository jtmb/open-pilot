'use client';
import { useEffect, useRef } from 'react';
import { multiplierLabel, type CopilotModel } from './ModelSelector';

export interface DisplayFinding {
  id:        string;
  severity:  'error' | 'warning' | 'info';
  category:  string;
  message:   string;
  iteration: number;
  source:    'rule' | 'ai';
}

const SEV_STYLE: Record<string, { wrap: string; badge: string; icon: string }> = {
  error:   { wrap: 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800',       badge: 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300',         icon: '🔴' },
  warning: { wrap: 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800', badge: 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300', icon: '🟡' },
  info:    { wrap: 'bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800',       badge: 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300',         icon: '🔵' },
};

const SEV_TOOLTIP: Record<string, string> = {
  error:   'Blocking issue — the run may be stuck or producing incorrect results. Immediate attention recommended.',
  warning: 'Potential problem — worth reviewing but not necessarily blocking. Monitor for recurrence.',
  info:    'Observation or suggestion — informational only, no action required.',
};

const CAT_LABEL: Record<string, string> = {
  loop:           'Loop',
  compliance:     'Compliance',
  'task-quality': 'Task',
  suggestion:     'Suggestion',
};

const CAT_TOOLTIP: Record<string, string> = {
  loop:           'Loop detection — the agent appears to be repeating the same actions without making progress.',
  compliance:     'Compliance check — the agent may be violating rules or constraints from the specification.',
  'task-quality': 'Task quality — the output may be incomplete, incorrect, or not meeting the requirements.',
  suggestion:     'Suggestion — an optional improvement identified by the monitor. Not a problem.',
};

const SOURCE_TOOLTIP: Record<string, string> = {
  ai:   'Found by AI analysis — the monitor model reviewed recent activity and flagged this finding.',
  rule: 'Found by a built-in rule — a deterministic check that runs automatically on every iteration.',
};

interface Props {
  findings:             DisplayFinding[];
  isAnalyzing:          boolean;
  models:               CopilotModel[];
  monitorModel:         string;
  onMonitorModelChange: (id: string) => void;
  aiEnabled:            boolean;
  onToggleAi:           () => void;
}

export default function MonitorPanel({ findings, isAnalyzing, models, monitorModel, onMonitorModelChange, aiEnabled, onToggleAi }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  // Scroll to bottom: instant on initial mount (page reload), smooth on new findings
  useEffect(() => {
    const behavior = mountedRef.current ? 'smooth' : 'instant';
    mountedRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior } as ScrollIntoViewOptions);
  }, [findings.length]);

  // Chronological order — newest at bottom, matching worker/manager panels
  const sorted = [...findings].sort((a, b) => a.iteration - b.iteration);

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">

      {/* ── Header ── */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shrink-0 min-w-0 overflow-hidden">
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 shrink-0">🔍 Monitor</span>
        {isAnalyzing && aiEnabled && (
          <span className="text-[11px] text-blue-500 animate-pulse shrink-0">analyzing…</span>
        )}
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <button
            onClick={onToggleAi}
            title={aiEnabled ? 'Disable AI analysis' : 'Enable AI analysis'}
            className={`text-[11px] px-2 py-0.5 rounded border font-medium whitespace-nowrap transition-colors ${
              aiEnabled
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 border-blue-200 dark:border-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/50'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            ✨ AI {aiEnabled ? 'on' : 'off'}
          </button>
          {aiEnabled && models.length > 0 && (
            <select
              value={monitorModel}
              onChange={e => onMonitorModelChange(e.target.value)}
              className="text-[11px] border border-gray-200 dark:border-gray-600 rounded px-1.5 py-0.5 bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 max-w-[140px] truncate"
              title="Model used for AI analysis"
            >
              {models.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name} ({multiplierLabel(m.multiplier)})
                </option>
              ))}
            </select>
          )}
          <span className="text-xs text-gray-400 shrink-0">
            {findings.length} finding{findings.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* ── Findings ── */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {sorted.length === 0 && !isAnalyzing && (
          <p className="text-xs text-gray-400 text-center mt-8 px-2">
            No issues detected yet. Findings will appear here as the run progresses.
          </p>
        )}

        {sorted.map(f => {
          const s = SEV_STYLE[f.severity] ?? SEV_STYLE.info;
          return (
            <div key={f.id} className={`border rounded-lg p-2.5 ${s.wrap}`}>
              <div className="flex items-start gap-1.5">
                <span
                  className="mt-0.5 shrink-0 text-sm cursor-help"
                  title={SEV_TOOLTIP[f.severity] ?? f.severity}
                >
                  {s.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded cursor-help ${s.badge}`}
                      title={CAT_TOOLTIP[f.category] ?? f.category}
                    >
                      {CAT_LABEL[f.category] ?? f.category}
                    </span>
                    <span className="text-[10px] text-gray-400">iter {f.iteration}</span>
                    <span
                      className="text-[10px] text-gray-400 cursor-help"
                      title={SOURCE_TOOLTIP[f.source] ?? f.source}
                    >
                      {f.source === 'ai' ? '✨ AI' : '⚡ rule'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-700 dark:text-gray-300 leading-snug break-words">{f.message}</p>
                </div>
              </div>
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
