'use client';
import { useEffect, useRef, useState } from 'react';
import { createAgentRun, personalities, type AgentRun, type AgentRunConfig, type PersonalityId } from '@/services/agentOrchestrator';
import { bestFreeModel, multiplierLabel, type CopilotModel } from './ModelSelector';

const RUN_PREFS_KEY = 'openpilot_run_prefs';

interface SavedRunPrefs {
  workerModel?: string;
  workerEffort?: string;
  managerModel?: string;
  managerEffort?: string;
  fillModel?: string;
  maxIterations?: number;
  approvalMode?: 'approvals' | 'bypass' | 'autopilot';
  githubRepo?: string;
  pushToGithub?: boolean;
  category?: PersonalityId;
}

interface Props {
  onStart: (run: AgentRun) => void;
  onClose: () => void;
}

function ModelPicker({
  label,
  models,
  model,
  effort,
  onModelChange,
  onEffortChange,
}: {
  label: string;
  models: CopilotModel[];
  model: string;
  effort: string;
  onModelChange: (v: string) => void;
  onEffortChange: (v: string) => void;
}) {
  const meta = models.find(m => m.id === model);
  const effortOptions = meta?.reasoningEffort ?? [];

  return (
    <div className="space-y-1">
      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
        {label}
      </label>
      <select
        className="w-full border rounded px-2 py-1.5 text-sm bg-white"
        value={model}
        onChange={e => {
          onModelChange(e.target.value);
          const m = models.find(m => m.id === e.target.value);
          if (m?.reasoningEffort?.length) {
            onEffortChange(m.reasoningEffort.includes('medium') ? 'medium' : m.reasoningEffort[0]);
          } else {
            onEffortChange('');
          }
        }}
      >
        {models.map(m => (
          <option key={m.id} value={m.id}>
            {m.name} ({multiplierLabel(m.multiplier)})
          </option>
        ))}
      </select>
      {effortOptions.length > 0 && (
        <select
          className="w-full border rounded px-2 py-1.5 text-sm bg-white"
          value={effort || (effortOptions.includes('medium') ? 'medium' : effortOptions[0])}
          onChange={e => onEffortChange(e.target.value)}
        >
          {effortOptions.map(e => (
            <option key={e} value={e}>
              🧠 Thinking: {e}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export default function NewRunModal({ onStart, onClose }: Props) {
  const [models, setModels] = useState<CopilotModel[]>([]);
  const [title, setTitle] = useState('');
  const [spec, setSpec] = useState('');
  const [workerModel, setWorkerModel] = useState('');
  const [workerEffort, setWorkerEffort] = useState('');
  const [managerModel, setManagerModel] = useState('');
  const [managerEffort, setManagerEffort] = useState('');
  const [maxIterations, setMaxIterations] = useState(10);
  const [approvalMode, setApprovalMode] = useState<'approvals' | 'bypass' | 'autopilot'>('approvals');
  const [pushToGithub, setPushToGithub] = useState(false);
  const [githubRepo, setGithubRepo] = useState('');
  const [category, setCategory] = useState<PersonalityId>('developer');
  const [specFullscreen, setSpecFullscreen] = useState(false);

  // Fill with AI
  const [fillModel, setFillModel] = useState('');
  const [fillLoading, setFillLoading] = useState(false);

  // Track whether we've applied saved prefs so we don't overwrite them on model reload
  const prefsApplied = useRef(false);

  function savePrefs(patch: Partial<SavedRunPrefs>) {
    try {
      const existing: SavedRunPrefs = JSON.parse(localStorage.getItem(RUN_PREFS_KEY) ?? '{}');
      localStorage.setItem(RUN_PREFS_KEY, JSON.stringify({ ...existing, ...patch }));
    } catch { /* ignore */ }
  }

  useEffect(() => {
    fetch('/api/models')
      .then(r => r.json())
      .then((d: { models?: CopilotModel[] }) => {
        const list = d.models ?? [];
        setModels(list);

        if (!prefsApplied.current) {
          prefsApplied.current = true;
          // Restore saved prefs, falling back to best free model
          const saved: SavedRunPrefs = JSON.parse(localStorage.getItem(RUN_PREFS_KEY) ?? '{}');
          const def = bestFreeModel(list);

          const wm = list.find(m => m.id === saved.workerModel) ? saved.workerModel! : def?.id ?? '';
          const mm = list.find(m => m.id === saved.managerModel) ? saved.managerModel! : def?.id ?? '';
          const fm = list.find(m => m.id === saved.fillModel) ? saved.fillModel! : def?.id ?? '';

          setWorkerModel(wm);
          setManagerModel(mm);
          setFillModel(fm);
          if (saved.workerEffort  !== undefined) setWorkerEffort(saved.workerEffort);
          if (saved.managerEffort !== undefined) setManagerEffort(saved.managerEffort);
          if (saved.maxIterations !== undefined) setMaxIterations(saved.maxIterations);
          if (saved.approvalMode  !== undefined) setApprovalMode(saved.approvalMode);
          if (saved.githubRepo    !== undefined) setGithubRepo(saved.githubRepo);
          if (saved.pushToGithub  !== undefined) setPushToGithub(saved.pushToGithub);
          if (saved.category      !== undefined) setCategory(saved.category);
        }
      })
      .catch(() => {});
  }, []);

  const canSubmit = title.trim().length > 0 && spec.trim().length > 0 && models.length > 0;

  const fillWithAI = async () => {
    if (!title.trim() || fillLoading) return;
    setFillLoading(true);
    try {
      const prompt =
        `You are a software architect. Write a detailed technical specification for the following project in plan mode.\n\nProject title: ${title.trim()}\n\nProvide: goals, tech stack, file structure, key features, constraints, and acceptance criteria. Be specific and actionable.`;
      const res = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model: fillModel, mode: 'plan' }),
      });
      const data = await res.json() as { result?: string; error?: string };
      if (data.result) setSpec(data.result);
    } catch {
      // ignore
    } finally {
      setFillLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const config: AgentRunConfig = {
      workerModel,
      workerReasoningEffort: workerEffort,
      managerModel,
      managerReasoningEffort: managerEffort,
      maxIterations,
      approvalMode,
      githubRepo: pushToGithub && githubRepo.trim() ? githubRepo.trim() : undefined,
      category,
    };
    savePrefs({ workerModel, workerEffort, managerModel, managerEffort, fillModel, maxIterations, approvalMode, githubRepo, pushToGithub, category });
    onStart(createAgentRun(title.trim(), spec.trim(), config));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h2 className="text-lg font-bold">New Agent Run</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Category */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
              Agent Type
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.values(personalities) as typeof personalities[keyof typeof personalities][]).map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setCategory(p.id as PersonalityId); savePrefs({ category: p.id as PersonalityId }); }}
                  className={`flex flex-col items-center gap-1 p-3 rounded-lg border-2 text-center transition-colors ${
                    category === p.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <span className="text-xl">{p.icon}</span>
                  <span className="text-xs font-semibold text-gray-800">{p.label}</span>
                  <span className="text-[10px] text-gray-500 leading-tight">{p.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              Run Title
            </label>
            <input
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="e.g. Build a todo app with React"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
            />
          </div>

          {/* Spec */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Specification
              </label>
              <div className="flex items-center gap-1.5">
                <select
                  className="border rounded px-2 py-1 text-xs bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  value={fillModel}
                  onChange={e => setFillModel(e.target.value)}
                  disabled={fillLoading}
                  title="Model for AI fill"
                >
                  {models.map(m => (
                    <option key={m.id} value={m.id}>{m.name} ({multiplierLabel(m.multiplier)})</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!title.trim() || fillLoading}
                  onClick={fillWithAI}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-purple-600 text-white font-medium hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Generate specification using AI in plan mode"
                >
                  {fillLoading ? <span className="animate-spin">⏳</span> : <span>✨</span>}
                  {fillLoading ? 'Planning…' : 'Fill with AI'}
                </button>
                <button
                  type="button"
                  onClick={() => setSpecFullscreen(true)}
                  className="px-2 py-1 text-xs rounded border hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                  title="Expand specification to full screen"
                >
                  ⛶ Expand
                </button>
              </div>
            </div>
            <textarea
              className="w-full border rounded px-3 py-2 text-sm font-mono resize-y"
              placeholder="Describe what you want built. Be specific: features, tech stack, file structure, constraints…"
              rows={12}
              value={spec}
              onChange={e => setSpec(e.target.value)}
              required
            />
          </div>

          {/* Agent config */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3 p-3 border rounded-lg bg-gray-50">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
                <span>👷</span> Worker Agent
              </div>
              <ModelPicker
                label="Model"
                models={models}
                model={workerModel}
                effort={workerEffort}
                onModelChange={v => { setWorkerModel(v); savePrefs({ workerModel: v }); }}
                onEffortChange={v => { setWorkerEffort(v); savePrefs({ workerEffort: v }); }}
              />
            </div>
            <div className="space-y-3 p-3 border rounded-lg bg-gray-50">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
                <span>🧑‍💼</span> Manager Agent
              </div>
              <ModelPicker
                label="Model"
                models={models}
                model={managerModel}
                effort={managerEffort}
                onModelChange={v => { setManagerModel(v); savePrefs({ managerModel: v }); }}
                onEffortChange={v => { setManagerEffort(v); savePrefs({ managerEffort: v }); }}
              />
            </div>
          </div>

          {/* Max iterations */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              Max Iterations (auto-pause after this many steps)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={999}
                disabled={maxIterations === 0}
                className="border rounded px-3 py-2 text-sm w-24 disabled:opacity-40 disabled:cursor-not-allowed"
                value={maxIterations === 0 ? '' : maxIterations}
                placeholder="10"
                onChange={e => {
                  const v = Math.max(1, parseInt(e.target.value) || 10);
                  setMaxIterations(v);
                  savePrefs({ maxIterations: v });
                }}
              />
              <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={maxIterations === 0}
                  onChange={e => {
                    const v = e.target.checked ? 0 : 10;
                    setMaxIterations(v);
                    savePrefs({ maxIterations: v });
                  }}
                  className="rounded"
                />
                ∞ Unlimited
              </label>
            </div>
          </div>

          {/* GitHub push */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={pushToGithub}
                onChange={e => {
                  setPushToGithub(e.target.checked);
                  savePrefs({ pushToGithub: e.target.checked });
                }}
                className="rounded"
              />
              <span className="font-medium">Push to GitHub when complete</span>
            </label>
            {pushToGithub && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Remote URL
                  <span className="ml-1 font-normal text-gray-400">(include token for private repos: https://TOKEN@github.com/user/repo.git)</span>
                </label>
                <input
                  type="text"
                  className="w-full border rounded px-3 py-2 text-sm font-mono"
                  placeholder="https://github.com/user/repo.git"
                  value={githubRepo}
                  onChange={e => {
                    setGithubRepo(e.target.value);
                    savePrefs({ githubRepo: e.target.value });
                  }}
                />
              </div>
            )}
          </div>

          {/* Approval mode */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              Approval Mode
            </label>
            <select
              className="border rounded px-3 py-2 text-sm bg-white w-full max-w-xs"
              value={approvalMode}
              onChange={e => {
                const v = e.target.value as typeof approvalMode;
                setApprovalMode(v);
                savePrefs({ approvalMode: v });
              }}
            >
              <option value="approvals">✋ Approvals — pause and ask before each action</option>
              <option value="bypass">⏩ Bypass Approvals — skip confirmations</option>
              <option value="autopilot">✈️ Autopilot — run fully autonomously</option>
            </select>
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded border hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="px-5 py-2 text-sm rounded bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create Run
          </button>
        </div>
      </div>

      {/* Fullscreen spec editor */}
      {specFullscreen && (
        <div className="fixed inset-0 z-[60] bg-white flex flex-col">
          <div className="flex items-center justify-between px-6 py-3 border-b bg-gray-50 shrink-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-800">Specification</span>
              {title && <span className="text-gray-400 text-sm">— {title}</span>}
            </div>
            <button
              onClick={() => setSpecFullscreen(false)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border hover:bg-white text-gray-600 font-medium"
            >
              ⊠ Done
            </button>
          </div>
          <textarea
            className="flex-1 px-6 py-4 text-sm font-mono resize-none outline-none border-0 focus:ring-0"
            placeholder="Describe what you want built. Be specific: features, tech stack, file structure, constraints…"
            value={spec}
            onChange={e => setSpec(e.target.value)}
            autoFocus
          />
        </div>
      )}
    </div>
  );
}
