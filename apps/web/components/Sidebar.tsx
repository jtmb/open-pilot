'use client';
import { FC, useCallback, useEffect, useRef, useState } from 'react';
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

const ALPHA_LETTERS = ['#', 'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'] as const;

function getLetterKey(title: string): string {
  const first = title.trim()[0]?.toUpperCase() ?? '';
  return /[A-Z]/.test(first) ? first : '#';
}

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
  backendStatus?: { db: boolean; codeServer: boolean } | null;
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
  backendStatus,
}) => {
  const dbOk         = backendStatus === null ? true : (backendStatus?.db ?? true);
  const codeServerOk = backendStatus === null ? true : (backendStatus?.codeServer ?? true);

  const tabDisabled: Partial<Record<Tab, { disabled: boolean; reason: string }>> = {
    chat:      { disabled: !dbOk,                  reason: 'Database offline' },
    apikeys:   { disabled: !dbOk,                  reason: 'Database offline' },
    autopilot: { disabled: !dbOk || !codeServerOk, reason: !dbOk ? 'Database offline' : 'code-server offline' },
  };

  const scrollRef   = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [activeLetter, setActiveLetter] = useState<string | null>(null);

  const sortedRuns = [...agentRuns].sort((a, b) => a.title.localeCompare(b.title));
  const runGroups: { letter: string; runs: AgentRun[] }[] = [];
  const runLetterSet = new Set<string>();
  for (const run of sortedRuns) {
    const letter = getLetterKey(run.title);
    runLetterSet.add(letter);
    const g = runGroups.find(x => x.letter === letter);
    if (g) g.runs.push(run);
    else runGroups.push({ letter, runs: [run] });
  }

  const sortedConvs = [...conversations].sort((a, b) => a.title.localeCompare(b.title));
  const convGroups: { letter: string; items: Conversation[] }[] = [];
  const convLetterSet = new Set<string>();
  for (const conv of sortedConvs) {
    const letter = getLetterKey(conv.title);
    convLetterSet.add(letter);
    const g = convGroups.find(x => x.letter === letter);
    if (g) g.items.push(conv);
    else convGroups.push({ letter, items: [conv] });
  }

  const activeLetterSet = activeTab === 'autopilot' ? runLetterSet : convLetterSet;

  const scrollToLetter = useCallback((letter: string) => {
    const el = sectionRefs.current.get(letter);
    if (el && scrollRef.current) {
      scrollRef.current.scrollTo({ top: el.offsetTop - 4, behavior: 'smooth' });
      setActiveLetter(letter);
      setTimeout(() => setActiveLetter(null), 1200);
    }
  }, []);

  useEffect(() => {
    sectionRefs.current.clear();
    setActiveLetter(null);
  }, [activeTab]);

  return (
    <aside className="w-64 bg-gray-900 text-white flex flex-col select-none">
      <div className="h-14 flex items-center px-4 border-b border-gray-800 font-bold text-lg shrink-0">
        OpenPilot
      </div>

      <nav className="flex flex-col gap-1 px-2 pt-3 pb-2 border-b border-gray-800 shrink-0">
        {(['dashboard', 'chat', 'autopilot', 'docs', 'apikeys'] as const).map(tab => {
          const restriction = tabDisabled[tab];
          const isDisabled  = restriction?.disabled ?? false;
          return (
            <button
              key={tab}
              disabled={isDisabled}
              title={isDisabled ? restriction!.reason : undefined}
              className={`text-left py-2 px-3 rounded text-sm capitalize transition-colors flex items-center justify-between gap-1 ${
                isDisabled
                  ? 'opacity-40 cursor-not-allowed text-gray-400'
                  : activeTab === tab
                    ? 'bg-gray-700'
                    : 'hover:bg-gray-800'
              }`}
              onClick={() => !isDisabled && setActiveTab(tab)}
            >
              <span>
                {tab === 'dashboard' ? '\uD83D\uDDC2 Dashboard'
                  : tab === 'chat' ? '\uD83D\uDCAC Chat'
                  : tab === 'autopilot' ? '\u2708\uFE0F Auto Pilot'
                  : tab === 'apikeys' ? '\uD83D\uDD11 API Keys'
                  : '\uD83D\uDCC4 Docs'}
              </span>
              {isDisabled && (
                <span className="text-[9px] font-bold text-red-400 uppercase tracking-wide shrink-0">offline</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="px-2 pt-3 shrink-0">
        {activeTab !== 'autopilot' ? (
          <button
            onClick={onNew}
            disabled={!dbOk}
            title={!dbOk ? 'Database offline' : undefined}
            className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm bg-gray-800 hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="text-lg leading-none">+</span> New chat
          </button>
        ) : (
          <button
            onClick={onNewRun}
            disabled={!dbOk || !codeServerOk}
            title={!dbOk ? 'Database offline' : !codeServerOk ? 'code-server offline' : undefined}
            className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm bg-blue-700 hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="text-lg leading-none">+</span> New run
          </button>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div ref={scrollRef} className="flex-1 overflow-y-auto pt-2 pb-4 min-w-0">
          {activeTab !== 'autopilot' ? (
            <>
              {convGroups.length === 0 && (
                <p className="text-xs text-gray-500 px-3 pt-2">No conversations yet.</p>
              )}
              {convGroups.map(group => (
                <div
                  key={group.letter}
                  ref={el => { if (el) sectionRefs.current.set(group.letter, el); else sectionRefs.current.delete(group.letter); }}
                >
                  <p className="text-[10px] text-gray-500 px-3 pt-3 pb-0.5 font-bold tracking-widest uppercase">{group.letter}</p>
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
                      >x</button>
                    </div>
                  ))}
                </div>
              ))}
            </>
          ) : (
            <>
              {runGroups.length === 0 && (
                <p className="text-xs text-gray-500 px-3 pt-2">No runs yet. Create one above.</p>
              )}
              {runGroups.map(group => (
                <div
                  key={group.letter}
                  ref={el => { if (el) sectionRefs.current.set(group.letter, el); else sectionRefs.current.delete(group.letter); }}
                >
                  <p className="text-[10px] text-gray-500 px-3 pt-3 pb-0.5 font-bold tracking-widest uppercase">{group.letter}</p>
                  {group.runs.map(run => {
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
                        <span className="text-gray-500 text-xs">{run.currentIteration}/{run.config.maxIterations === 0 ? '\u221E' : run.config.maxIterations}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </>
          )}
        </div>

        <div className="flex flex-col w-4 shrink-0 pt-2 pb-2 overflow-hidden">
          {ALPHA_LETTERS.map(letter => {
            const hasItems = activeLetterSet.has(letter);
            const isActive = activeLetter === letter;
            return (
              <button
                key={letter}
                onClick={() => scrollToLetter(letter)}
                disabled={!hasItems}
                className="flex flex-col items-end w-full disabled:cursor-default focus:outline-none"
                title={hasItems ? `Jump to ${letter}` : undefined}
              >
                <span className={`w-full text-right text-[8px] font-bold leading-none pr-0.5 py-px transition-colors ${
                  isActive ? 'text-amber-400' :
                  hasItems ? 'text-gray-300 hover:text-white' :
                             'text-gray-700'
                }`}>
                  {letter}
                </span>
                <span className="w-full block border-t border-gray-700/60" />
              </button>
            );
          })}
        </div>
      </div>

      <ProfileMenu />
    </aside>
  );
};

export default Sidebar;
