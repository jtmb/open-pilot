'use client';
import { FC } from 'react';
import type { AgentRun, RunStatus } from '@/services/agentOrchestrator';
import ProfileMenu from './ProfileMenu';

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
}

type Tab = 'dashboard' | 'chat' | 'docs' | 'autopilot' | 'apikeys';

const STATUS_DOT: Record<RunStatus, { cls: string; pulse: boolean }> = {
  idle:     { cls: 'bg-gray-400',   pulse: false },
  running:  { cls: 'bg-green-500',  pulse: true  },
  paused:   { cls: 'bg-yellow-400', pulse: false },
  complete: { cls: 'bg-blue-500',   pulse: false },
  error:    { cls: 'bg-red-500',    pulse: false },
};

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  setActiveTab: (tab: Tab) => void;
  activeTab: Tab;
  agentRuns: AgentRun[];
  activeRunId: string | null;
  onSelectRun: (id: string) => void;
  onNewRun: () => void;
}

const Sidebar: FC<Props> = ({
  conversations,
  activeId,
  onNew,
  onSelect,
  onDelete,
  setActiveTab,
  activeTab,
  agentRuns,
  activeRunId,
  onSelectRun,
  onNewRun,
}) => {
  // Group conversations by recency
  const now = Date.now();
  const DAY = 86400_000;
  const groups: { label: string; items: Conversation[] }[] = [];
  const today    = conversations.filter(c => now - c.createdAt < DAY);
  const week     = conversations.filter(c => now - c.createdAt >= DAY && now - c.createdAt < 7 * DAY);
  const older    = conversations.filter(c => now - c.createdAt >= 7 * DAY);
  if (today.length)  groups.push({ label: 'Today',    items: today });
  if (week.length)   groups.push({ label: 'This week', items: week });
  if (older.length)  groups.push({ label: 'Older',     items: older });

  return (
    <aside className="w-64 bg-gray-900 text-white flex flex-col select-none">
      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b border-gray-800 font-bold text-lg shrink-0">
        OpenPilot
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1 px-2 pt-3 pb-2 border-b border-gray-800 shrink-0">
        {(['dashboard', 'chat', 'autopilot', 'docs', 'apikeys'] as const).map(tab => (
          <button
            key={tab}
            className={`text-left py-2 px-3 rounded text-sm capitalize transition-colors ${
              activeTab === tab ? 'bg-gray-700' : 'hover:bg-gray-800'
            }`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'dashboard' ? '🗂 Dashboard'
              : tab === 'chat' ? '💬 Chat'
              : tab === 'autopilot' ? '✈️ Auto Pilot'
              : tab === 'apikeys' ? '🔑 API Keys'
              : '📄 Docs'}
          </button>
        ))}
      </nav>

      {/* Contextual action button */}
      <div className="px-2 pt-3 shrink-0">
        {activeTab !== 'autopilot' ? (
          <button
            onClick={onNew}
            className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm bg-gray-800 hover:bg-gray-700 transition-colors"
          >
            <span className="text-lg leading-none">+</span> New chat
          </button>
        ) : (
          <button
            onClick={onNewRun}
            className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm bg-blue-700 hover:bg-blue-600 transition-colors"
          >
            <span className="text-lg leading-none">+</span> New run
          </button>
        )}
      </div>

      {/* List area — conversations or agent runs */}
      <div className="flex-1 overflow-y-auto px-2 pt-2 pb-4">
        {activeTab !== 'autopilot' ? (
          <>
            {conversations.length === 0 && (
              <p className="text-xs text-gray-500 px-3 pt-2">No conversations yet.</p>
            )}
            {groups.map(group => (
              <div key={group.label}>
                <p className="text-xs text-gray-500 px-3 pt-3 pb-1 uppercase tracking-wide">{group.label}</p>
                {group.items.map(conv => (
                  <div
                    key={conv.id}
                    className={`group relative flex items-center rounded px-3 py-2 text-sm cursor-pointer transition-colors ${
                      activeId === conv.id ? 'bg-gray-700' : 'hover:bg-gray-800'
                    }`}
                    onClick={() => { onSelect(conv.id); setActiveTab('chat'); }}
                  >
                    <span className="flex-1 truncate">{conv.title}</span>
                    <button
                      className="opacity-0 group-hover:opacity-100 ml-1 text-gray-400 hover:text-red-400 transition-opacity shrink-0"
                      onClick={e => { e.stopPropagation(); onDelete(conv.id); }}
                      title="Delete"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </>
        ) : (
          <>
            {agentRuns.length === 0 && (
              <p className="text-xs text-gray-500 px-3 pt-2">No runs yet. Create one above.</p>
            )}
            {agentRuns.map(run => {
              const dot = STATUS_DOT[run.status];
              return (
                <div
                  key={run.id}
                  className={`flex items-center gap-2 rounded px-3 py-2 text-sm cursor-pointer transition-colors ${
                    activeRunId === run.id ? 'bg-gray-700' : 'hover:bg-gray-800'
                  }`}
                  onClick={() => onSelectRun(run.id)}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${dot.cls} ${dot.pulse ? 'animate-pulse' : ''}`} />
                  <span className="flex-1 truncate text-xs">{run.title}</span>
                  <span className="text-gray-500 text-xs">{run.currentIteration}/{run.config.maxIterations === 0 ? '∞' : run.config.maxIterations}</span>
                </div>
              );
            })}
          </>
        )}
      </div>

      <ProfileMenu />
    </aside>
  );
};

export default Sidebar;
