'use client';
import { useEffect, useState } from 'react';
import type { AgentRun, RunStatus } from '@/services/agentOrchestrator';
import type { ConversationData } from './ChatBox';
import type { CopilotModel } from './ModelSelector';
import { multiplierLabel } from './ModelSelector';

interface Props {
  agentRuns: AgentRun[];
  conversations: ConversationData[];
  onSelectRun?: (id: string) => void;
  onSelectConv?: (id: string) => void;
}

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  model: string;
  enabled: boolean;
  usageCount: number;
  lastUsedAt: number | null;
}

const STATUS_COLORS: Record<RunStatus, string> = {
  idle:     'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  running:  'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  paused:   'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400',
  complete: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  error:    'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

const PREMIUM_COST_USD = 0.04; // GitHub Copilot rate per premium request

function fmtDate(ms: number) {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">{label}</p>
      <p className="text-3xl font-bold text-gray-900 dark:text-white">{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{title}</h3>
      {children}
    </div>
  );
}

export default function Dashboard({ agentRuns, conversations, onSelectRun, onSelectConv }: Props) {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [models, setModels] = useState<CopilotModel[]>([]);

  useEffect(() => {
    fetch('/api/apikeys')
      .then(r => r.json())
      .then((d: { keys?: ApiKey[] }) => setApiKeys(d.keys ?? []))
      .catch(() => {});
    fetch('/api/models')
      .then(r => r.json())
      .then((d: { models?: CopilotModel[] }) => setModels(d.models ?? []))
      .catch(() => {});
  }, []);

  // ── Agent run stats ──────────────────────────────────────────────────────
  const runsByStatus = agentRuns.reduce<Record<RunStatus, number>>(
    (acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; },
    { idle: 0, running: 0, paused: 0, complete: 0, error: 0 },
  );
  const totalIterations  = agentRuns.reduce((s, r) => s + (r.currentIteration ?? 0), 0);
  const totalCheckpoints = agentRuns.reduce((s, r) => s + (r.checkpoints?.length ?? 0), 0);
  const recentRuns = [...agentRuns].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);

  // ── Conversation stats (exclude blank "New chat") ────────────────────────
  const meaningfulConvs = conversations.filter(c => !(c.title === 'New chat' && c.messages.length === 0));
  const totalMessages = meaningfulConvs.reduce((s, c) => s + (c.messages?.length ?? 0), 0);
  const recentConvs = [...meaningfulConvs].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);

  // ── Model usage: chat messages + agent iterations ────────────────────────
  const modelUsage = new Map<string, number>();
  for (const conv of conversations) {
    for (const msg of conv.messages ?? []) {
      if (msg.role === 'ai' && msg.model) {
        modelUsage.set(msg.model, (modelUsage.get(msg.model) ?? 0) + 1);
      }
    }
  }
  for (const run of agentRuns) {
    const iters = run.currentIteration ?? 0;
    if (iters > 0 && run.config) {
      const wm = run.config.workerModel;
      const mm = run.config.managerModel;
      if (wm) modelUsage.set(wm, (modelUsage.get(wm) ?? 0) + iters);
      if (mm) modelUsage.set(mm, (modelUsage.get(mm) ?? 0) + iters);
    }
  }
  const rankedModels = [...modelUsage.entries()].sort((a, b) => b[1] - a[1]);
  const maxModelCount = rankedModels[0]?.[1] ?? 1;

  // ── Billing ───────────────────────────────────────────────────────────────
  const billingRows = rankedModels.map(([modelId, count]) => {
    const meta = models.find(m => m.id === modelId);
    const mult = meta?.multiplier ?? 1;
    const premiumReqs = mult === 'free' ? 0 : count * (mult as number);
    return { modelId, name: meta?.name ?? modelId, count, mult, premiumReqs, cost: premiumReqs * PREMIUM_COST_USD };
  });
  const totalPremiumReqs = billingRows.reduce((s, r) => s + r.premiumReqs, 0);
  const totalCost        = billingRows.reduce((s, r) => s + r.cost, 0);
  const totalRequests    = billingRows.reduce((s, r) => s + r.count, 0);

  // ── API key usage ─────────────────────────────────────────────────────────
  const keysByUsage = [...apiKeys].sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0));
  const totalApiCalls = apiKeys.reduce((s, k) => s + (k.usageCount ?? 0), 0);
  const maxKeyUsage   = keysByUsage[0]?.usageCount ?? 1;

  return (
    <div className="overflow-y-auto h-full bg-gray-50 dark:bg-gray-900 p-6 space-y-6">
      <h2 className="text-xl font-bold text-gray-900 dark:text-white">Dashboard</h2>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Agent Runs"     value={agentRuns.length}         sub={`${runsByStatus.running} running`} />
        <StatCard label="Conversations"  value={meaningfulConvs.length}   sub={`${totalMessages} messages`} />
        <StatCard label="Iterations"     value={totalIterations}          sub={`${totalCheckpoints} checkpoints`} />
        <StatCard label="API Keys"       value={apiKeys.length}           sub={`${totalApiCalls} total calls`} />
      </div>

      {/* Run status + recent rows */}
      <Card title="Agent Run Status">
        <div className="flex flex-wrap gap-2">
          {(Object.entries(runsByStatus) as [RunStatus, number][]).map(([status, count]) => (
            <span key={status} className={`px-3 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[status]}`}>
              {status} · {count}
            </span>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Recent agent runs */}
        <Card title="Recent Agent Runs">
          {recentRuns.length === 0 ? (
            <p className="text-xs text-gray-400">No agent runs yet.</p>
          ) : (
            <ul className="space-y-1">
              {recentRuns.map(r => (
                <li
                  key={r.id}
                  onClick={() => onSelectRun?.(r.id)}
                  className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 -mx-2 transition-colors ${
                    onSelectRun ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 dark:text-gray-200 truncate font-medium">{r.title}</p>
                    <p className="text-xs text-gray-400">{fmtDate(r.updatedAt)} · iter {r.currentIteration ?? 0}</p>
                  </div>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[r.status]}`}>
                    {r.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Recent conversations */}
        <Card title="Recent Conversations">
          {recentConvs.length === 0 ? (
            <p className="text-xs text-gray-400">No conversations yet.</p>
          ) : (
            <ul className="space-y-1">
              {recentConvs.map(c => (
                <li
                  key={c.id}
                  onClick={() => onSelectConv?.(c.id)}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 -mx-2 transition-colors ${
                    onSelectConv ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-800 dark:text-gray-200 truncate font-medium">{c.title}</p>
                    <p className="text-xs text-gray-400">{fmtDate(c.createdAt)} · {c.messages?.length ?? 0} msgs</p>
                  </div>
                  {onSelectConv && (
                    <span className="text-gray-300 dark:text-gray-600 text-xs shrink-0">→</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Model usage ranking */}
      {rankedModels.length > 0 && (
        <Card title="Model Usage">
          <div className="space-y-3">
            {rankedModels.map(([modelId, count], i) => {
              const meta = models.find(m => m.id === modelId);
              const pct  = Math.round((count / maxModelCount) * 100);
              return (
                <div key={modelId} className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-4 shrink-0 text-right font-semibold">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                        {meta?.name ?? modelId}
                      </span>
                      <span className="text-xs text-gray-500 shrink-0 ml-2">{count.toLocaleString()}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-700">
                      <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0 w-10 text-right">
                    {meta ? multiplierLabel(meta.multiplier) : '?'}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* API key usage by app */}
      {keysByUsage.length > 0 && (
        <Card title="API Usage by App">
          <div className="space-y-3">
            {keysByUsage.map(k => {
              const pct = maxKeyUsage > 0 ? Math.round(((k.usageCount ?? 0) / maxKeyUsage) * 100) : 0;
              return (
                <div key={k.id} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{k.name}</span>
                        <span className={`text-[9px] px-1.5 rounded-full font-semibold shrink-0 ${
                          k.enabled
                            ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-500'
                        }`}>{k.enabled ? 'active' : 'off'}</span>
                      </div>
                      <span className="text-xs text-gray-500 shrink-0 ml-2">{(k.usageCount ?? 0).toLocaleString()} calls</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-700">
                      <div className="h-1.5 rounded-full bg-purple-500" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-[10px] text-gray-400 font-mono mt-0.5">{k.keyPrefix} · {k.model}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Billing estimate */}
      {billingRows.length > 0 && (
        <Card title="Billing Estimate">
          <div className="flex items-start justify-between mb-4">
            <p className="text-xs text-gray-400">Based on GitHub Copilot premium request rates</p>
            <div className="text-right shrink-0 ml-4">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">${totalCost.toFixed(2)}</p>
              <p className="text-xs text-gray-400">{totalPremiumReqs.toLocaleString()} premium req</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-100 dark:border-gray-700">
                  <th className="text-left pb-2 font-semibold">Model</th>
                  <th className="text-right pb-2 font-semibold">Req</th>
                  <th className="text-right pb-2 font-semibold">Rate</th>
                  <th className="text-right pb-2 font-semibold">Premium Req</th>
                  <th className="text-right pb-2 font-semibold">Est. Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                {billingRows.map(row => (
                  <tr key={row.modelId} className="text-gray-700 dark:text-gray-300">
                    <td className="py-1.5 truncate max-w-[140px]">{row.name}</td>
                    <td className="py-1.5 text-right">{row.count.toLocaleString()}</td>
                    <td className="py-1.5 text-right">{row.mult === 'free' ? '0x' : `${row.mult}x`}</td>
                    <td className="py-1.5 text-right">{row.premiumReqs.toLocaleString()}</td>
                    <td className="py-1.5 text-right font-medium">
                      {row.cost === 0
                        ? <span className="text-green-600 dark:text-green-400">free</span>
                        : `$${row.cost.toFixed(2)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 dark:border-gray-600 font-bold text-gray-900 dark:text-white">
                  <td className="pt-2">Total</td>
                  <td className="pt-2 text-right font-normal text-gray-600 dark:text-gray-400">{totalRequests.toLocaleString()}</td>
                  <td />
                  <td className="pt-2 text-right font-normal text-gray-600 dark:text-gray-400">{totalPremiumReqs.toLocaleString()}</td>
                  <td className="pt-2 text-right">${totalCost.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2.5 mt-3">
            ⚠ Estimated at $0.04 per premium request (GitHub Copilot rate). Your plan's included quota is not deducted from this total. Models marked 0× never consume premium requests.
          </p>
        </Card>
      )}

      {/* ── Agent Training ──────────────────────────────────────────────────── */}
      <TrainingPanel />
    </div>
  );
}

// ── Training panel ─────────────────────────────────────────────────────────────

interface TrainingStat {
  personalityId: string;
  total: number;
  complete: number;
  blocked: number;
  completionRate: number;
  thumbsUp: number;
  thumbsDown: number;
  avgCorrections: string;
}

const PERSONALITIES = [
  { id: 'developer',     icon: '⚙️',  label: 'Developer'      },
  { id: 'designer',      icon: '🎨',  label: 'Designer'       },
  { id: 'gamedev',       icon: '🎮',  label: 'Game Dev'       },
  { id: 'writer',        icon: '✍️',  label: 'Writer'         },
  { id: 'secops',        icon: '🔒',  label: 'SecOps'         },
  { id: 'devops',        icon: '🚀',  label: 'DevOps'         },
  { id: 'qa',            icon: '🧪',  label: 'QA Engineer'    },
  { id: 'datascientist', icon: '📊',  label: 'Data Scientist' },
];

function TrainingPanel() {
  const [stats, setStats]       = useState<TrainingStat[]>([]);
  const [loading, setLoading]   = useState(false);
  const [refining, setRefining] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});

  useEffect(() => {
    setLoading(true);
    Promise.all(
      PERSONALITIES.map(p =>
        fetch(`/api/training/score?personalityId=${p.id}`)
          .then(r => r.json() as Promise<TrainingStat>)
          .catch(() => null),
      ),
    ).then(results => {
      setStats(results.filter((r): r is TrainingStat => r !== null));
      setLoading(false);
    });
  }, []);

  const handleRefine = async (personalityId: string) => {
    setRefining(personalityId);
    setMessages(m => ({ ...m, [personalityId]: '' }));
    try {
      const res = await fetch(`/api/training/refine/${personalityId}`, { method: 'POST' });
      const data = await res.json() as { ok: boolean; reason?: string; version?: number; changesSummary?: string };
      if (data.ok) {
        setMessages(m => ({ ...m, [personalityId]: `✅ v${data.version} created. ${data.changesSummary ?? ''}` }));
      } else {
        setMessages(m => ({ ...m, [personalityId]: `ℹ️ ${data.reason ?? 'Could not refine'}` }));
      }
    } catch (e) {
      setMessages(m => ({ ...m, [personalityId]: `❌ Error: ${(e as Error).message}` }));
    } finally {
      setRefining(null);
    }
  };

  return (
    <Card title="Agent Training">
      {loading ? (
        <p className="text-xs text-gray-400">Loading training stats…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 dark:text-gray-500 border-b dark:border-gray-700">
                <th className="text-left pb-2 font-semibold">Personality</th>
                <th className="text-right pb-2 font-semibold">Runs</th>
                <th className="text-right pb-2 font-semibold">Complete%</th>
                <th className="text-right pb-2 font-semibold">Avg Corrections</th>
                <th className="text-right pb-2 font-semibold">👍 / 👎</th>
                <th className="text-right pb-2 font-semibold">Refine</th>
              </tr>
            </thead>
            <tbody>
              {PERSONALITIES.map(p => {
                const s = stats.find(st => st.personalityId === p.id);
                const msg = messages[p.id];
                return [
                  <tr key={p.id} className="border-b last:border-0 dark:border-gray-700/50">
                    <td className="py-2 font-medium text-gray-700 dark:text-gray-200">
                      {p.icon} {p.label}
                    </td>
                    <td className="py-2 text-right text-gray-600 dark:text-gray-400">{s?.total ?? 0}</td>
                    <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                      {s ? `${(s.completionRate * 100).toFixed(0)}%` : '—'}
                    </td>
                    <td className="py-2 text-right text-gray-600 dark:text-gray-400">{s?.avgCorrections ?? '—'}</td>
                    <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                      {s ? `${s.thumbsUp} / ${s.thumbsDown}` : '—'}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => void handleRefine(p.id)}
                        disabled={refining === p.id || (s?.total ?? 0) < 20}
                        title={(s?.total ?? 0) < 20 ? 'Need 20+ scored runs to refine' : `Refine ${p.label} prompts`}
                        className="px-2 py-0.5 rounded text-xs font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {refining === p.id ? '…' : '✨ Refine'}
                      </button>
                    </td>
                  </tr>,
                  msg ? (
                    <tr key={`${p.id}-msg`}>
                      <td colSpan={6} className="pb-2 text-xs text-gray-500 dark:text-gray-400 italic">{msg}</td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
          <p className="text-xs text-gray-400 mt-3">
            ✨ Refine analyses successful and poor runs, then asks Copilot to improve the personality's system prompts. Requires 20+ scored runs per personality.
          </p>
        </div>
      )}
    </Card>
  );
}
