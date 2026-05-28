'use client';
import { useEffect, useRef, useState } from 'react';
import { createAgentRun, personalities, type AgentRun, type AgentRunConfig, type PersonalityDef, type PersonalityId } from '@/services/agentOrchestrator';
import { bestFreeModel, multiplierLabel, type CopilotModel } from './ModelSelector';

const RUN_PREFS_KEY = 'openpilot_run_prefs';
const _pList = Object.values(personalities) as PersonalityDef[];
const _pLen = _pList.length;

interface SavedRunPrefs {
  workerModel?: string;
  workerEffort?: string;
  managerModel?: string;
  managerEffort?: string;
  fillModel?: string;
  maxIterations?: number;
  approvalMode?: 'approvals' | 'bypass' | 'autopilot';
  pushToGithub?: boolean;
  githubRepo?: string;
  category?: PersonalityId;
  continueFromRepo?: boolean;
  existingRepoUrl?: string;
  featureBranch?: string;
}

interface Props {
  onStart: (run: AgentRun) => void;
  onClose: () => void;
  initialSpec?: string;
  initialTitle?: string;
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

export default function NewRunModal({ onStart, onClose, initialSpec, initialTitle }: Props) {
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
  const [aiChooseRepo, setAiChooseRepo] = useState(false);
  const [category, setCategory] = useState<PersonalityId>('developer');
  const [specFullscreen, setSpecFullscreen] = useState(false);
  const [continueFromRepo, setContinueFromRepo] = useState(false);
  const [existingRepoUrl, setExistingRepoUrl] = useState('');
  const [featureBranch, setFeatureBranch] = useState('');

  // Pre-fill spec and title when coming from a completed run
  useEffect(() => {
    if (initialSpec) setSpec(initialSpec);
    if (initialTitle) setTitle(initialTitle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSpec, initialTitle]);

  // Fill with AI
  const [fillModel, setFillModel] = useState('');
  const [fillLoading, setFillLoading] = useState(false);
  const fillAbortRef = useRef<AbortController | null>(null);

  // Abort any in-flight fill request when the modal unmounts
  useEffect(() => {
    return () => { fillAbortRef.current?.abort(); };
  }, []);

  // Track whether we've applied saved prefs so we don't overwrite them on model reload
  const prefsApplied = useRef(false);

  // Infinite center-locked carousel
  const [centerIdx, setCenterIdx] = useState(() => Math.max(0, _pList.findIndex(p => p.id === 'developer')));
  const [nextCenterIdx, setNextCenterIdx] = useState<number | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const isAnimRef = useRef(false);

  // Sync center when category is restored from prefs
  useEffect(() => {
    const idx = _pList.findIndex(p => p.id === category);
    if (idx >= 0 && idx !== centerIdx) setCenterIdx(idx);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  // Restore strip to resting position (hide far-left card) after each center change
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const first = strip.children[0] as HTMLElement | undefined;
    if (!first) return;
    strip.style.transition = 'none';
    strip.style.transform = `translateX(${-(first.offsetWidth + 8)}px)`;
  }, [centerIdx]);

  const navigate = (dir: 1 | -1) => {
    if (isAnimRef.current) return;
    const strip = stripRef.current;
    if (!strip) return;
    const first = strip.children[0] as HTMLElement | undefined;
    const cardW = (first?.offsetWidth ?? 110) + 8;
    const restX = -cardW;
    const newIdx = (centerIdx + dir + _pLen * 100) % _pLen;
    isAnimRef.current = true;
    setNextCenterIdx(newIdx);
    strip.style.transition = 'transform 220ms cubic-bezier(0.4,0,0.2,1)';
    strip.style.transform = `translateX(${restX + (dir === -1 ? cardW : -cardW)}px)`;
    setTimeout(() => {
      const p = _pList[newIdx];
      strip.style.transition = 'none';
      strip.style.transform = `translateX(${restX}px)`;
      setCenterIdx(newIdx);
      setNextCenterIdx(null);
      setCategory(p.id as PersonalityId);
      savePrefs({ category: p.id as PersonalityId });
      isAnimRef.current = false;
    }, 225);
  };

  const jumpTo = (idx: number) => {
    if (isAnimRef.current || idx === centerIdx) return;
    const p = _pList[idx];
    setCenterIdx(idx);
    setCategory(p.id as PersonalityId);
    savePrefs({ category: p.id as PersonalityId });
  };

  const stripCards = Array.from({ length: 5 }, (_, i) => _pList[(centerIdx + i - 2 + _pLen * 100) % _pLen]);

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
          if (saved.pushToGithub  !== undefined) setPushToGithub(saved.pushToGithub);
          if (saved.githubRepo    !== undefined) setGithubRepo(saved.githubRepo);
          if (saved.category      !== undefined) setCategory(saved.category);
          if (saved.continueFromRepo !== undefined) setContinueFromRepo(saved.continueFromRepo);
          if (saved.existingRepoUrl  !== undefined) setExistingRepoUrl(saved.existingRepoUrl);
          if (saved.featureBranch    !== undefined) setFeatureBranch(saved.featureBranch);
        }
      })
      .catch(() => {});
  }, []);

  const canSubmit = title.trim().length > 0 && spec.trim().length > 0 && models.length > 0;

  const fillWithAI = async () => {
    if (!title.trim() || fillLoading) return;
    fillAbortRef.current?.abort();
    const ctrl = new AbortController();
    fillAbortRef.current = ctrl;
    setFillLoading(true);
    try {
      const prompt =
        `You are a software architect. Write a detailed technical specification for the following project in plan mode.\n\nProject title: ${title.trim()}\n\nProvide: goals, tech stack, file structure, key features, constraints, and acceptance criteria. Be specific and actionable.`;
      const res = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model: fillModel, mode: 'plan' }),
        signal: ctrl.signal,
      });
      const data = await res.json() as { result?: string; error?: string };
      if (data.result) setSpec(data.result);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    } finally {
      setFillLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const slugify = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'new-feature';
    const computedBranch = featureBranch.trim() || `feature/${slugify(title.trim())}`;
    const hasExistingRepo = continueFromRepo && existingRepoUrl.trim().length > 0;
    const effectiveSpec = hasExistingRepo
      ? spec.trim() + `\n\n---\n\n**Note: This run continues from an existing repository.** The codebase has been cloned into your workspace on branch \`${computedBranch}\`. Read and understand the existing code before making any changes. Use \`[EXEC: git add -A && git commit -m "feat: ..." && git push]\` to commit your work to this feature branch.`
      : spec.trim();
    const config: AgentRunConfig = {
      workerModel,
      workerReasoningEffort: workerEffort,
      managerModel,
      managerReasoningEffort: managerEffort,
      maxIterations,
      approvalMode,
      pushToGithub: pushToGithub || undefined,
      githubRepo: pushToGithub && !aiChooseRepo && githubRepo.trim() ? githubRepo.trim() : undefined,
      category,
      existingRepo: hasExistingRepo ? existingRepoUrl.trim() : undefined,
      featureBranch: hasExistingRepo ? computedBranch : undefined,
    };
    savePrefs({ workerModel, workerEffort, managerModel, managerEffort, fillModel, maxIterations, approvalMode, pushToGithub, githubRepo, category, continueFromRepo, existingRepoUrl, featureBranch });
    onStart(createAgentRun(title.trim(), effectiveSpec, config));
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
            <div className="relative flex items-stretch gap-1" style={{ height: '5rem' }}>
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="flex items-center justify-center w-6 shrink-0 text-lg leading-none rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors select-none"
                aria-label="Previous agent type"
              >‹</button>
              <div className="flex-1 overflow-hidden relative h-full">
                {/* Edge fades */}
                <div className="absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none" />
                <div className="absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none" />
                <div ref={stripRef} className="flex gap-2 will-change-transform h-full">
                  {stripCards.map((p, i) => {
                    const isCenter = i === 2;
                    const isEdge = i === 0 || i === 4;
                    const isIncoming = nextCenterIdx !== null && (centerIdx + i - 2 + _pLen * 100) % _pLen === nextCenterIdx;
                    const isBig = isCenter || isIncoming;
                    return (
                      <button
                        key={i}
                        type="button"
                        style={{
                          flexShrink: 0,
                          width: isCenter ? 'calc(44% - 7px)' : 'calc(28% - 4.5px)',
                          transition: 'width 220ms cubic-bezier(0.4,0,0.2,1)',
                        }}
                        onClick={() => { if (i === 1) navigate(-1); else if (i === 3) navigate(1); }}
                        className={`flex flex-col items-center justify-center gap-0.5 p-1.5 rounded-lg border-2 text-center h-full ${
                          isEdge ? 'border-transparent opacity-0 pointer-events-none'
                          : isCenter ? 'border-blue-500 bg-blue-50 shadow-sm'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 opacity-60 cursor-pointer'
                        }`}
                      >
                        <span style={{
                          display: 'inline-block',
                          fontSize: isBig ? '1.625rem' : '1rem',
                          lineHeight: 1,
                          flexShrink: 0,
                          transition: 'font-size 220ms ease',
                        }}>{p.icon}</span>
                        <span
                          className="font-semibold text-gray-800 leading-tight"
                          style={{ fontSize: isBig ? '0.75rem' : '0.625rem', flexShrink: 0, transition: 'font-size 220ms ease' }}
                        >{p.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigate(1)}
                className="flex items-center justify-center w-6 shrink-0 text-lg leading-none rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors select-none"
                aria-label="Next agent type"
              >›</button>
            </div>
            {/* Dot indicators */}
            <div className="flex items-center justify-center gap-1.5 mt-2">
              {_pList.map((_, di) => (
                <button
                  key={di}
                  type="button"
                  onClick={() => jumpTo(di)}
                  aria-label={`Go to ${_pList[di].label}`}
                  className="rounded-full transition-all duration-200"
                  style={{
                    width: di === centerIdx ? '0.625rem' : '0.375rem',
                    height: di === centerIdx ? '0.625rem' : '0.375rem',
                    backgroundColor: di === centerIdx ? '#3b82f6' : '#d1d5db',
                  }}
                />
              ))}
            </div>
            {/* Description — lives outside the strip to avoid height jank */}
            <p
              className="text-xs text-gray-500 text-center leading-snug mt-1.5 min-h-[2rem] px-2"
              style={{
                opacity: nextCenterIdx !== null ? 0 : 1,
                transition: 'opacity 180ms ease',
              }}
            >
              {_pList[centerIdx].description}
            </p>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              Run Title
            </label>
            <input
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder={personalities[category]?.titlePlaceholder ?? 'e.g. Build something new'}
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
              placeholder={personalities[category]?.specPlaceholder ?? 'Describe what you want built. Be specific: features, tech stack, file structure, constraints…'}
              value={spec}
              onChange={e => setSpec(e.target.value)}
              rows={7}
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

          {/* GitHub push — handled post-completion via the workspace toolbar */}

          {/* Create GitHub repo */}
          <div className={`space-y-2 transition-opacity ${continueFromRepo ? 'opacity-50 pointer-events-none' : ''}`}>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={pushToGithub}
                disabled={continueFromRepo}
                onChange={e => {
                  const checked = e.target.checked;
                  setPushToGithub(checked);
                  savePrefs({ pushToGithub: checked });
                }}
                className="rounded"
              />
              <span className="font-medium">Create GitHub repo when complete</span>
            </label>
            {pushToGithub && (
              <div className="ml-5 space-y-2">
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={aiChooseRepo}
                    onChange={e => setAiChooseRepo(e.target.checked)}
                    className="rounded"
                  />
                  <span>Let AI choose a name based on the specification</span>
                </label>
                {!aiChooseRepo && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Repository name</label>
                    <input
                      type="text"
                      className="w-full border rounded px-3 py-1.5 text-sm"
                      placeholder={title.trim() ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'my-project' : 'my-project'}
                      value={githubRepo}
                      onChange={e => {
                        setGithubRepo(e.target.value);
                        savePrefs({ githubRepo: e.target.value });
                      }}
                    />
                  </div>
                )}
                {aiChooseRepo && title.trim() && (
                  <p className="text-xs text-indigo-600 bg-indigo-50 rounded px-3 py-1.5">
                    Will create: <span className="font-mono font-semibold">{title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'my-project'}</span>
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Continue from existing repo */}
          <div className={`space-y-2 transition-opacity ${pushToGithub ? 'opacity-50 pointer-events-none' : ''}`}>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={continueFromRepo}
                disabled={pushToGithub}
                onChange={e => { const checked = e.target.checked; setContinueFromRepo(checked); savePrefs({ continueFromRepo: checked }); }}
                className="rounded"
              />
              <span className="font-medium">Continue from existing repo</span>
            </label>
            {continueFromRepo && (
              <div className="ml-5 space-y-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Repository URL</label>
                  <input
                    type="text"
                    className="w-full border rounded px-3 py-1.5 text-sm font-mono"
                    placeholder="https://github.com/user/my-project.git"
                    value={existingRepoUrl}
                    onChange={e => { setExistingRepoUrl(e.target.value); savePrefs({ existingRepoUrl: e.target.value }); }}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Feature branch name</label>
                  <input
                    type="text"
                    className="w-full border rounded px-3 py-1.5 text-sm font-mono"
                    placeholder={`feature/${title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'new-feature'}`}
                    value={featureBranch}
                    onChange={e => { setFeatureBranch(e.target.value); savePrefs({ featureBranch: e.target.value }); }}
                  />
                  <p className="text-xs text-gray-400 mt-0.5">Leave blank to auto-generate from run title</p>
                </div>
                <p className="text-xs text-indigo-600 bg-indigo-50 rounded px-3 py-1.5">
                  The repo will be cloned and branch{' '}
                  <span className="font-mono font-semibold">
                    {featureBranch.trim() || `feature/${title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'new-feature'}`}
                  </span>{' '}
                  will be created and published at run start.
                </p>
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
            placeholder={personalities[category]?.specPlaceholder ?? 'Describe what you want built. Be specific: features, tech stack, file structure, constraints…'}
            value={spec}
            onChange={e => setSpec(e.target.value)}
            autoFocus
          />
        </div>
      )}
    </div>
  );
}
