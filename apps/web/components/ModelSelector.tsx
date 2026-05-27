'use client';
import { useEffect, useState } from 'react';

export interface CopilotModel {
  id: string;
  name: string;
  multiplier: number | 'free';
  category: string;
  reasoningEffort: string[];
}

export type Mode = 'ask' | 'plan' | 'agent';

interface Props {
  model: string;
  mode: Mode;
  reasoningEffort: string;
  onModelChange: (id: string, meta: CopilotModel | undefined) => void;
  onModeChange: (m: Mode) => void;
  onReasoningEffortChange: (e: string) => void;
}

const MODES: { id: Mode; label: string }[] = [
  { id: 'ask',   label: 'Ask'   },
  { id: 'plan',  label: 'Plan'  },
  { id: 'agent', label: 'Agent' },
];

export function multiplierLabel(m: number | 'free'): string {
  if (m === 'free') return '0x';
  return `${m}x`;
}

// Preferred 0x models in priority order: best GPT free first
const FREE_PRIORITY = [
  'gpt-5-mini',
  'gpt-4.1',
  'gpt-4o',
  'gpt-4.1-mini',
  'gpt-4o-mini',
  'gpt-3.5-turbo',
];

export function bestFreeModel(list: CopilotModel[]): CopilotModel | undefined {
  const free = list.filter(m => m.multiplier === 'free');
  for (const id of FREE_PRIORITY) {
    const m = free.find(m => m.id === id);
    if (m) return m;
  }
  return free[0] ?? list[0];
}

export default function ModelSelector({
  model,
  mode,
  reasoningEffort,
  onModelChange,
  onModeChange,
  onReasoningEffortChange,
}: Props) {
  const [models, setModels] = useState<CopilotModel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/models')
      .then(r => r.json())
      .then((data: { models?: CopilotModel[] }) => {
        const list = data.models ?? [];
        setModels(list);
        if (list.length) {
          const best = bestFreeModel(list);
          if ((!model || !list.find(m => m.id === model)) && best) {
            onModelChange(best.id, best);
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeMeta = models.find(m => m.id === model);
  const effortOptions = activeMeta?.reasoningEffort ?? [];

  return (
    <div className="flex items-center gap-2">
      {/* Model selector */}
      <select
        className="border rounded px-2 py-1 text-sm bg-white min-w-[200px]"
        value={model}
        onChange={e => {
          const meta = models.find(m => m.id === e.target.value);
          onModelChange(e.target.value, meta);
          // reset effort to first supported value when switching models
          if (meta?.reasoningEffort.length) {
            const defaultEffort = meta.reasoningEffort.includes('medium')
              ? 'medium'
              : meta.reasoningEffort[0];
            onReasoningEffortChange(defaultEffort);
          } else {
            onReasoningEffortChange('');
          }
        }}
        disabled={loading}
      >
        {loading && <option>Loading models…</option>}
        {models.map(m => (
          <option key={m.id} value={m.id}>
            {m.name} ({multiplierLabel(m.multiplier)})
          </option>
        ))}
      </select>

      {/* Thinking effort — only shown when model supports it */}
      {effortOptions.length > 0 && (
        <select
          className="border rounded px-2 py-1 text-sm bg-white"
          value={reasoningEffort || (effortOptions.includes('medium') ? 'medium' : effortOptions[0])}
          onChange={e => onReasoningEffortChange(e.target.value)}
          title="Thinking effort"
        >
          {effortOptions.map(e => (
            <option key={e} value={e}>
              🧠 {e.charAt(0).toUpperCase() + e.slice(1)}
            </option>
          ))}
        </select>
      )}

      {/* Mode selector */}
      <select
        className="border rounded px-2 py-1 text-sm bg-white"
        value={mode}
        onChange={e => onModeChange(e.target.value as Mode)}
      >
        {MODES.map(m => (
          <option key={m.id} value={m.id}>{m.label}</option>
        ))}
      </select>
    </div>
  );
}
