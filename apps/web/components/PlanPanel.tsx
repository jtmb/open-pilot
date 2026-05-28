'use client';
import type { PlanTask } from '@/services/agentOrchestrator';

interface PlanPanelProps {
  plan: PlanTask[];
  onClose: () => void;
}

const STATUS_CONFIG = {
  'pending':     { icon: '○', ring: 'border-zinc-600',   bg: 'bg-zinc-900',   text: 'text-zinc-400',  label: 'Pending'     },
  'in-progress': { icon: '●', ring: 'border-blue-500',   bg: 'bg-blue-950',   text: 'text-blue-300',  label: 'In Progress' },
  'done':        { icon: '✓', ring: 'border-green-500',  bg: 'bg-green-950',  text: 'text-green-300', label: 'Done'        },
  'skipped':     { icon: '–', ring: 'border-zinc-700',   bg: 'bg-zinc-900',   text: 'text-zinc-500',  label: 'Skipped'     },
} as const;

export default function PlanPanel({ plan, onClose }: PlanPanelProps) {
  const done      = plan.filter(t => t.status === 'done').length;
  const total     = plan.length;
  const pct       = total > 0 ? Math.round((done / total) * 100) : 0;
  const current   = plan.find(t => t.status === 'in-progress');

  return (
    <div className="w-72 shrink-0 flex flex-col border-l border-zinc-700 bg-zinc-900 text-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700 bg-zinc-800">
        <div className="flex items-center gap-2 font-semibold text-zinc-200">
          <span>📋</span>
          <span>Plan</span>
          {total > 0 && (
            <span className="text-xs font-normal text-zinc-400">
              {done}/{total}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-200 transition-colors text-lg leading-none"
          title="Close plan"
        >
          ×
        </button>
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="px-3 py-2 border-b border-zinc-700">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-zinc-400">Progress</span>
            <span className="text-xs text-zinc-400">{pct}%</span>
          </div>
          <div className="w-full h-1.5 bg-zinc-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          {current && (
            <p className="mt-1 text-xs text-blue-400 truncate">
              Working on: {current.title}
            </p>
          )}
        </div>
      )}

      {/* Task list */}
      <div className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
        {total === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 text-zinc-500 text-xs text-center px-4">
            <span className="text-2xl mb-1">📋</span>
            <span>The manager will create a plan on the first step.</span>
          </div>
        ) : (
          plan.map(task => {
            const cfg = STATUS_CONFIG[task.status];
            return (
              <div
                key={task.id}
                className={`flex items-start gap-2 px-2 py-1.5 rounded border ${cfg.ring} ${cfg.bg} transition-colors`}
              >
                {/* Status dot */}
                <span className={`mt-0.5 shrink-0 w-4 text-center font-bold ${cfg.text}`}>
                  {cfg.icon}
                </span>
                {/* Task number + title */}
                <div className="flex-1 min-w-0">
                  <span className={`text-xs font-mono mr-1 ${cfg.text} opacity-60`}>
                    {task.id}.
                  </span>
                  <span className={`text-xs leading-snug ${task.status === 'done' ? 'line-through text-zinc-500' : 'text-zinc-200'}`}>
                    {task.title}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
