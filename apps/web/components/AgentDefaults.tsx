'use client';
import { useEffect, useState } from 'react';
import { bestFreeModel, multiplierLabel, type CopilotModel } from './ModelSelector';

export const AGENT_DEFAULTS_KEY = 'openpilot:agentDefaults';

export interface AgentDefaultsConfig {
  /** Model for the floating chat assistant */
  assistantModel: string;
  /** Default worker model for new agent runs */
  workerModel: string;
  /** Default manager model for new agent runs */
  managerModel: string;
  /** Default monitor model */
  monitorModel: string;
}

export function loadAgentDefaults(): AgentDefaultsConfig {
  try {
    return JSON.parse(localStorage.getItem(AGENT_DEFAULTS_KEY) ?? '{}') as AgentDefaultsConfig;
  } catch { return {} as AgentDefaultsConfig; }
}

export function saveAgentDefaults(patch: Partial<AgentDefaultsConfig>) {
  const existing = loadAgentDefaults();
  localStorage.setItem(AGENT_DEFAULTS_KEY, JSON.stringify({ ...existing, ...patch }));
}

const ROLE_LABELS: { key: keyof AgentDefaultsConfig; label: string; hint: string }[] = [
  {
    key:   'assistantModel',
    label: '🤖 Chat Assistant',
    hint:  'The model used by the floating assistant bot. Pick a 0× (free) model to avoid premium quota usage.',
  },
  {
    key:   'workerModel',
    label: '⚙️ Agent Worker (default)',
    hint:  'Pre-fills the Worker model when you create a new agent run.',
  },
  {
    key:   'managerModel',
    label: '🧑‍💼 Agent Manager (default)',
    hint:  'Pre-fills the Manager model when you create a new agent run.',
  },
  {
    key:   'monitorModel',
    label: '📡 Run Monitor (default)',
    hint:  'Pre-fills the Monitor model inside agent runs.',
  },
];

function ModelPicker({
  label,
  hint,
  models,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  models: CopilotModel[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div>
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{label}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p>
      </div>
      <select
        className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        <option value="">— Use app default —</option>
        {models.map(m => (
          <option key={m.id} value={m.id}>
            {m.name} ({multiplierLabel(m.multiplier)})
          </option>
        ))}
      </select>
    </div>
  );
}

export default function AgentDefaults() {
  const [models, setModels]     = useState<CopilotModel[]>([]);
  const [config, setConfig]     = useState<AgentDefaultsConfig>({} as AgentDefaultsConfig);
  const [saved, setSaved]       = useState(false);

  useEffect(() => {
    setConfig(loadAgentDefaults());
    fetch('/api/models')
      .then(r => r.json())
      .then((d: { models?: CopilotModel[] }) => {
        const list = d.models ?? [];
        setModels(list);
        // If no defaults set yet, pre-fill with the best free model
        const existing = loadAgentDefaults();
        if (!existing.assistantModel) {
          const free = bestFreeModel(list);
          if (free) {
            const patch = { assistantModel: free.id };
            saveAgentDefaults(patch);
            setConfig(prev => ({ ...prev, ...patch }));
          }
        }
      })
      .catch(() => {});
  }, []);

  const handleChange = (key: keyof AgentDefaultsConfig, val: string) => {
    const patch = { [key]: val } as Partial<AgentDefaultsConfig>;
    setConfig(prev => ({ ...prev, ...patch }));
    saveAgentDefaults(patch);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="overflow-y-auto h-full bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-xl mx-auto space-y-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Agent Defaults</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Choose which Copilot model each part of the app uses. Changes take effect immediately.
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 space-y-5">
          {ROLE_LABELS.map(({ key, label, hint }) => (
            <ModelPicker
              key={key}
              label={label}
              hint={hint}
              models={models}
              value={config[key] ?? ''}
              onChange={val => handleChange(key, val)}
            />
          ))}
        </div>

        {saved && (
          <p className="text-xs text-green-600 dark:text-green-400 text-center">✓ Saved</p>
        )}

        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 text-xs text-amber-800 dark:text-amber-300 space-y-1">
          <p className="font-semibold">About model costs</p>
          <p>Models marked <strong>0×</strong> are free and don't consume GitHub Copilot premium request quota. Models marked <strong>1×</strong> or higher cost premium requests.</p>
          <p>For the Chat Assistant and Monitor, choose a 0× model to keep usage free.</p>
        </div>
      </div>
    </div>
  );
}
