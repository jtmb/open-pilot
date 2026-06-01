'use client';
import { useEffect, useRef, useState } from 'react';
import ModelSelector, { type Mode, type CopilotModel } from './ModelSelector';
import { personalities, type PersonalityDef, type PersonalityId } from '@/services/agentOrchestrator';
import { loadAgentDefaults } from './AgentDefaults';

/**
 * Converts a build-oriented workerSystem prompt into a clean conversational
 * system prompt, preserving the personality's domain expertise and description.
 */
function buildChatSystemPrompt(p: PersonalityDef): string {
  const identity = p.workerSystem
    .split(/\n\n/)[0]
    .replace(/\s*A [^.]+?agent assigns[^.]*\.\s*/g, ' ')
    .replace(/\s+working autonomously on [^.]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return `${identity}\n\nYour expertise: ${p.description}.\n\nYou are having a direct conversation with the user. Be helpful, concise, and natural. Do not output any special protocol tokens or markers.`;
}

// ── Group chat ─────────────────────────────────────────────────────────────
const AGENT_COLORS = [
  { bubble: 'bg-green-100 dark:bg-green-900/30 text-green-900 dark:text-green-100',  badge: 'bg-green-500',  label: 'text-green-600 dark:text-green-400'  },
  { bubble: 'bg-purple-100 dark:bg-purple-900/30 text-purple-900 dark:text-purple-100', badge: 'bg-purple-500', label: 'text-purple-600 dark:text-purple-400' },
  { bubble: 'bg-orange-100 dark:bg-orange-900/30 text-orange-900 dark:text-orange-100', badge: 'bg-orange-500', label: 'text-orange-600 dark:text-orange-400' },
  { bubble: 'bg-pink-100 dark:bg-pink-900/30 text-pink-900 dark:text-pink-100',      badge: 'bg-pink-500',   label: 'text-pink-600 dark:text-pink-400'    },
  { bubble: 'bg-teal-100 dark:bg-teal-900/30 text-teal-900 dark:text-teal-100',      badge: 'bg-teal-500',   label: 'text-teal-600 dark:text-teal-400'    },
] as const;

interface GroupAgent {
  uid: string;
  personalityId: PersonalityId | '';
  colorIdx: number;
}

export type ApprovalMode = 'approvals' | 'bypass' | 'autopilot';

const APPROVAL_OPTIONS: { value: ApprovalMode; label: string; icon: string }[] = [
  { value: 'approvals',  label: 'Approvals',        icon: '✋' },
  { value: 'bypass',     label: 'Bypass Approvals',  icon: '⏩' },
  { value: 'autopilot',  label: 'Autopilot',         icon: '✈️' },
];

export interface Message {
  id: string;
  role: 'user' | 'ai';
  content: string;
  model?: string;
  mode?: string;
  reasoningEffort?: string;
  personality?: string;
  // group chat
  agentLabel?: string;
  colorIdx?: number;
}

export interface ConversationData {
  id: string;
  title: string;
  createdAt: number;
  messages: Message[];
}

interface Props {
  conversation: ConversationData;
  model: string;
  mode: Mode;
  reasoningEffort: string;
  onUpdate: (updated: ConversationData) => void;
  onModelChange?: (id: string, meta: CopilotModel | undefined) => void;
  onModeChange?: (mode: Mode) => void;
  onReasoningEffortChange?: (effort: string) => void;
}

export default function ChatBox({ conversation, model, mode, reasoningEffort, onUpdate, onModelChange, onModeChange, onReasoningEffortChange }: Props) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('approvals');
  const [personality, setPersonality] = useState<PersonalityDef | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Group chat state
  const [groupMode, setGroupMode] = useState(false);
  const [groupAgents, setGroupAgents] = useState<GroupAgent[]>([]);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [converseMode, setConverseMode] = useState(false);
  const [converseRounds, setConverseRounds] = useState(2);

  // Load default personality from agent defaults on mount
  useEffect(() => {
    const defaults = loadAgentDefaults();
    if (defaults.chatPersonality) {
      const p = personalities[defaults.chatPersonality as PersonalityId];
      if (p) setPersonality(p);
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation.messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMsg: Message = {
      id: Date.now() + '-user',
      role: 'user',
      content: input.trim(),
      personality: personality ? `${personality.icon} ${personality.label}` : undefined,
    };

    // Derive title from first user message
    const isFirst = conversation.messages.length === 0;
    const title = isFirst
      ? userMsg.content.slice(0, 50) + (userMsg.content.length > 50 ? '…' : '')
      : conversation.title;

    const withUser: ConversationData = {
      ...conversation,
      title,
      messages: [...conversation.messages, userMsg],
    };
    onUpdate(withUser);
    setInput('');
    setLoading(true);

    // ── Group mode: each agent responds in sequence ──────────────────────────
    if (groupMode && groupAgents.length > 0) {
      let current = withUser;

      // Helper: call one agent, appending the response to `state` and returning it
      const callAgent = async (
        agent: GroupAgent,
        prompt: string,
        state: ConversationData,
        labelHistory: boolean,
      ): Promise<ConversationData> => {
        const p = agent.personalityId ? personalities[agent.personalityId] : null;
        const history = state.messages.map(m => ({
          role: m.role === 'user' ? 'user' as const : 'assistant' as const,
          // In converse rounds, prefix AI messages with the agent label so the
          // model understands who said what in the multi-agent context.
          content: (labelHistory && m.agentLabel) ? `[${m.agentLabel}] ${m.content}` : m.content,
        }));
        const res = await fetch('/api/copilot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            model,
            mode,
            reasoningEffort: reasoningEffort || undefined,
            systemPrompt: p ? buildChatSystemPrompt(p) : undefined,
            history,
          }),
        });
        const data = await res.json() as { result?: string; error?: string };
        const agentLabel = p ? `${p.icon} ${p.label}` : '💬 General';
        const aiMsg: Message = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}-ai`,
          role: 'ai',
          content: data.result ?? data.error ?? 'No response',
          model,
          mode,
          reasoningEffort: reasoningEffort || undefined,
          agentLabel,
          colorIdx: agent.colorIdx,
        };
        return { ...state, messages: [...state.messages, aiMsg] };
      };

      try {
        // Round 0 — every agent responds to the user's message
        for (const agent of groupAgents) {
          current = await callAgent(agent, userMsg.content, current, false);
          onUpdate(current);
        }

        // Converse rounds — agents respond to each other
        if (converseMode && converseRounds > 0 && groupAgents.length >= 2) {
          const conversePrompt =
            '(Continue the group discussion — engage directly with what the other agents said above, building on their points or respectfully disagreeing. Do not repeat what you already said.)';
          for (let round = 0; round < converseRounds; round++) {
            for (const agent of groupAgents) {
              current = await callAgent(agent, conversePrompt, current, true);
              onUpdate(current);
            }
          }
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    // ── Single agent mode ────────────────────────────────────────────────────
    try {
      const history = conversation.messages.map(m => ({
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content,
      }));

      const res = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: userMsg.content,
          model,
          mode,
          reasoningEffort: reasoningEffort || undefined,
          systemPrompt: personality ? buildChatSystemPrompt(personality) : undefined,
          history,
        }),
      });
      const data = await res.json() as { result?: string; error?: string };
      const aiMsg: Message = {
        id: Date.now() + '-ai',
        role: 'ai',
        content: data.result ?? data.error ?? 'No response',
        model,
        mode,
        reasoningEffort: reasoningEffort || undefined,
      };
      onUpdate({ ...withUser, messages: [...withUser.messages, aiMsg] });
    } catch (err: unknown) {
      const aiMsg: Message = {
        id: Date.now() + '-ai',
        role: 'ai',
        content: (err instanceof Error ? err.message : String(err)) || 'Network error',
        model,
        mode,
        reasoningEffort: reasoningEffort || undefined,
      };
      onUpdate({ ...withUser, messages: [...withUser.messages, aiMsg] });
    } finally {
      setLoading(false);
    }
  };

  const addGroupAgent = (personalityId: PersonalityId | '') => {
    const colorIdx = groupAgents.length % AGENT_COLORS.length;
    setGroupAgents(prev => [...prev, { uid: `${Date.now()}`, personalityId, colorIdx }]);
    setShowAddAgent(false);
  };

  const removeGroupAgent = (uid: string) => {
    setGroupAgents(prev => prev.filter(a => a.uid !== uid));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Badge bar — model / mode / personality / approval mode */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-gray-50 dark:bg-gray-800 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
        {onModelChange && onModeChange && onReasoningEffortChange ? (
          <ModelSelector
            model={model}
            mode={mode}
            reasoningEffort={reasoningEffort}
            onModelChange={onModelChange}
            onModeChange={onModeChange}
            onReasoningEffortChange={onReasoningEffortChange}
          />
        ) : (
          <>
            <span className="bg-gray-200 dark:bg-gray-700 rounded px-2 py-0.5">{model}</span>
            <span className="bg-gray-200 dark:bg-gray-700 rounded px-2 py-0.5 capitalize">{mode}</span>
            {reasoningEffort && (
              <span className="bg-purple-100 text-purple-700 rounded px-2 py-0.5 capitalize">🧠 {reasoningEffort}</span>
            )}
          </>
        )}
        {/* Personality picker */}
        <select
          className="border rounded px-2 py-0.5 text-xs bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 text-gray-700 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-400"
          value={personality?.id ?? ''}
          onChange={e => {
            const id = e.target.value as PersonalityId | '';
            setPersonality(id ? personalities[id] : null);
          }}
          title="Chat personality"
        >
          <option value="">💬 General</option>
          {Object.values(personalities).map(p => (
            <option key={p.id} value={p.id}>{p.icon} {p.label}</option>
          ))}
        </select>
        {personality && (
          <span className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 rounded px-2 py-0.5 max-w-[14rem] truncate" title={personality.description}>
            {personality.icon} {personality.label} mode
          </span>
        )}
        {/* Group chat toggle */}
        <button
          onClick={() => { setGroupMode(v => !v); setShowAddAgent(false); }}
          className={`rounded px-2 py-0.5 font-medium transition-colors border ${
            groupMode
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-indigo-400'
          }`}
          title={groupMode ? 'Disable group chat' : 'Enable group chat — add multiple agents'}
        >
          👥 Group
        </button>

        <span className="ml-auto">
          <select
            className="border rounded px-2 py-0.5 text-xs bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 text-gray-700 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-400"
            value={approvalMode}
            onChange={e => setApprovalMode(e.target.value as ApprovalMode)}
            title="Approval mode"
          >
            {APPROVAL_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.icon} {opt.label}
              </option>
            ))}
          </select>
        </span>
      </div>

      {/* ── Group chat agent roster ── */}
      {groupMode && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b bg-indigo-50 dark:bg-indigo-950/30 dark:border-gray-700">
          <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 shrink-0">Agents:</span>
          {groupAgents.map(agent => {
            const p = agent.personalityId ? personalities[agent.personalityId] : null;
            const colors = AGENT_COLORS[agent.colorIdx];
            return (
              <span
                key={agent.uid}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border border-transparent ${colors.bubble}`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${colors.badge}`} />
                {p ? `${p.icon} ${p.label}` : '💬 General'}
                <button
                  onClick={() => removeGroupAgent(agent.uid)}
                  className="ml-0.5 opacity-50 hover:opacity-100 leading-none"
                  title="Remove agent"
                >×</button>
              </span>
            );
          })}

          {/* Add agent */}
          {showAddAgent ? (
            <select
              autoFocus
              className="border rounded px-2 py-0.5 text-xs bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              defaultValue=""
              onChange={e => addGroupAgent(e.target.value as PersonalityId | '')}
              onBlur={() => setShowAddAgent(false)}
            >
              <option value="" disabled>Pick a personality…</option>
              <option value="">💬 General</option>
              {Object.values(personalities).map(p => (
                <option key={p.id} value={p.id}>{p.icon} {p.label}</option>
              ))}
            </select>
          ) : (
            <button
              onClick={() => setShowAddAgent(true)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border border-dashed border-indigo-400 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
            >
              + Add Agent
            </button>
          )}
          {groupAgents.length === 0 && !showAddAgent && (
            <span className="text-xs text-indigo-400">Add agents above to start group chat</span>
          )}

          {/* Converse controls — only meaningful with 2+ agents */}
          {groupAgents.length >= 2 && (
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={() => setConverseMode(v => !v)}
                className={`rounded px-2 py-0.5 text-xs font-medium border transition-colors ${
                  converseMode
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 border-indigo-300 dark:border-indigo-700 hover:border-indigo-500'
                }`}
                title={converseMode ? 'Disable agent-to-agent conversation' : 'Let agents respond to each other after answering you'}
              >
                🔄 Converse
              </button>
              {converseMode && (
                <div className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400">
                  <span>Rounds:</span>
                  <button
                    onClick={() => setConverseRounds(r => Math.max(1, r - 1))}
                    className="w-5 h-5 rounded border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 flex items-center justify-center leading-none"
                  >−</button>
                  <span className="w-4 text-center font-semibold">{converseRounds}</span>
                  <button
                    onClick={() => setConverseRounds(r => Math.min(5, r + 1))}
                    className="w-5 h-5 rounded border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 flex items-center justify-center leading-none"
                  >+</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-auto p-6 space-y-4 bg-white dark:bg-gray-800">
        {conversation.messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
            <span className="text-4xl">💬</span>
            <p className="text-sm">Start a new conversation</p>
          </div>
        )}
        {conversation.messages.map(msg => {
          const isGroupAi = msg.role === 'ai' && msg.agentLabel != null;
          const colors = (isGroupAi && msg.colorIdx != null) ? AGENT_COLORS[msg.colorIdx % AGENT_COLORS.length] : null;
          return (
            <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              {isGroupAi && colors && (
                <span className={`flex items-center gap-1 text-xs font-semibold mb-0.5 ${colors.label}`}>
                  <span className={`w-2 h-2 rounded-full ${colors.badge}`} />
                  {msg.agentLabel}
                </span>
              )}
              <div
                className={`rounded-2xl px-4 py-2 max-w-2xl whitespace-pre-wrap text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : colors
                    ? colors.bubble
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                }`}
              >
                {msg.content}
              </div>
              {msg.role === 'ai' && msg.model && (
                <span className="mt-1 text-xs text-gray-400">
                  {msg.model}{msg.mode && msg.mode !== 'ask' ? ` · ${msg.mode}` : ''}{msg.reasoningEffort ? ` · ${msg.reasoningEffort}` : ''}
                </span>
              )}
              {msg.role === 'user' && msg.personality && (
                <span className="mt-1 text-xs text-gray-400">
                  {msg.personality}
                </span>
              )}
            </div>
          );
        })}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-sm animate-pulse">
              Thinking…
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        className="flex px-4 py-2.5 border-t border-gray-200 dark:border-gray-700 gap-2 bg-white dark:bg-gray-800"
        onSubmit={e => { e.preventDefault(); sendMessage(); }}
      >
        <textarea
          className="flex-1 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400 bg-gray-50 dark:bg-gray-800/60"
          placeholder="Type your message…"
          rows={1}
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={loading}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
        />
        <button
          type="submit"
          className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-xl text-sm font-medium disabled:opacity-50 transition-colors shrink-0"
          disabled={loading || !input.trim()}
        >
          Send
        </button>
      </form>
    </div>
  );
}
