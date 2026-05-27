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
  error:   { wrap: 'bg-red-50 border-red-200',       badge: 'bg-red-100 text-red-700',       icon: '🔴' },
  warning: { wrap: 'bg-yellow-50 border-yellow-200', badge: 'bg-yellow-100 text-yellow-700', icon: '🟡' },
  info:    { wrap: 'bg-sky-50 border-sky-200',       badge: 'bg-sky-100 text-sky-700',       icon: '🔵' },
};

const CAT_LABEL: Record<string, string> = {
  loop:           'Loop',
  compliance:     'Compliance',
  'task-quality': 'Task',
  suggestion:     'Suggestion',
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

  // Auto-scroll as new findings arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [findings.length]);

  // Sort: errors first, warnings next, info last — within same severity newest first
  const sorted = [...findings].sort((a, b) => {
    const order = { error: 0, warning: 1, info: 2 };
    const diff = (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
    return diff !== 0 ? diff : b.iteration - a.iteration;
  });

  return (
    <div className="flex flex-col h-full bg-gray-50">

      {/* ── Header ── */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b bg-white shrink-0 min-w-0 overflow-hidden">
        <span className="text-sm font-semibold text-gray-700 shrink-0">🔍 Monitor</span>
        {isAnalyzing && aiEnabled && (
          <span className="text-[11px] text-blue-500 animate-pulse shrink-0">analyzing…</span>
        )}
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <button
            onClick={onToggleAi}
            title={aiEnabled ? 'Disable AI analysis' : 'Enable AI analysis'}
            className={`text-[11px] px-2 py-0.5 rounded border font-medium whitespace-nowrap transition-colors ${
              aiEnabled
                ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'
                : 'bg-gray-100 text-gray-400 border-gray-200 hover:bg-gray-200'
            }`}
          >
            ✨ AI {aiEnabled ? 'on' : 'off'}
          </button>
          {aiEnabled && models.length > 0 && (
            <select
              value={monitorModel}
              onChange={e => onMonitorModelChange(e.target.value)}
              className="text-[11px] border rounded px-1.5 py-0.5 bg-white text-gray-600 max-w-[140px] truncate"
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
                <span className="mt-0.5 shrink-0 text-sm">{s.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${s.badge}`}>
                      {CAT_LABEL[f.category] ?? f.category}
                    </span>
                    <span className="text-[10px] text-gray-400">iter {f.iteration}</span>
                    <span className="text-[10px] text-gray-400">
                      {f.source === 'ai' ? '✨ AI' : '⚡ rule'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-700 leading-snug break-words">{f.message}</p>
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
