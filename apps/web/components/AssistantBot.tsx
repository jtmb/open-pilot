'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadAgentDefaults } from './AgentDefaults';

// ── Types ──────────────────────────────────────────────────────────────────────

type TabName = 'dashboard' | 'chat' | 'docs' | 'autopilot' | 'apikeys';

interface BotMessage {
  role: 'user' | 'assistant';
  content: string;         // raw (may contain action tokens)
  displayContent: string;  // stripped for rendering
  actions: ParsedAction[];
}

interface ParsedAction {
  type: 'nav' | 'new_run' | 'new_chat';
  payload?: string;
}

export interface AssistantBotProps {
  activeTab: TabName;
  onNavigate: (tab: TabName) => void;
  onNewRun: () => void;
  onNewChat: () => void;
}

// ── Action parsing ─────────────────────────────────────────────────────────────

const ACTION_RE = /\[(NAV:[a-z]+|NEW_RUN|NEW_CHAT)\]/g;

function parseActions(text: string): { display: string; actions: ParsedAction[] } {
  const actions: ParsedAction[] = [];
  const display = text.replace(ACTION_RE, (match) => {
    const inner = match.slice(1, -1);
    if (inner.startsWith('NAV:')) {
      actions.push({ type: 'nav', payload: inner.slice(4) });
    } else if (inner === 'NEW_RUN') {
      actions.push({ type: 'new_run' });
    } else if (inner === 'NEW_CHAT') {
      actions.push({ type: 'new_chat' });
    }
    return '';
  }).replace(/\s{2,}/g, ' ').trim();
  return { display, actions };
}

// ── System prompt ──────────────────────────────────────────────────────────────

const TAB_NAMES: Record<TabName, string> = {
  dashboard: 'Dashboard',
  chat:      'Chat',
  docs:      'API Documentation',
  autopilot: 'Auto Pilot (agent runs)',
  apikeys:   'API Keys',
};

function buildSystemPrompt(activeTab: TabName): string {
  return `You are OpenPilot Assistant, a helpful AI built into the OpenPilot app — a web interface for using GitHub Copilot to build software autonomously.

The app has these sections:
- Chat (tab: chat): Conversational AI chat with GitHub Copilot models.
- Auto Pilot (tab: autopilot): Launches autonomous agent runs that build full software projects end-to-end using a worker + manager AI loop.
- Dashboard (tab: dashboard): Stats on agent runs, conversations, model usage, billing, and training data.
- API Docs (tab: docs): Documentation for the OpenPilot REST API.
- API Keys (tab: apikeys): Create and manage API keys for external access.
- Agent Defaults: Accessible via the profile menu (bottom-left) — configure default AI models and chat personality.

The user is currently on: **${TAB_NAMES[activeTab]}**

You can take actions to help the user by including action tokens anywhere in your response:
- [NAV:dashboard] [NAV:chat] [NAV:autopilot] [NAV:docs] [NAV:apikeys] — navigate to a section
- [NEW_RUN] — open the New Agent Run dialog
- [NEW_CHAT] — start a new chat conversation

When navigating, mention what you're doing (e.g. "I'll take you to the API Keys page now [NAV:apikeys]").
Always explain context-relevant tips for the page the user is on.
Be concise. Answer in 1–4 short sentences unless the user asks for more detail.`;
}

// ── Component ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'openpilot:assistant-chat';

const DRAG_STORAGE_KEY = 'openpilot:assistant-drag-pos';

export default function AssistantBot({ activeTab, onNavigate, onNewRun, onNewChat }: AssistantBotProps) {
  const [open, setOpen]           = useState(false);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(DRAG_STORAGE_KEY) : null;
      if (raw) return JSON.parse(raw) as { x: number; y: number };
    } catch { /* ignore */ }
    return { x: 0, y: 0 };
  });
  const draggingRef    = useRef(false);
  const dragOriginRef  = useRef({ mx: 0, my: 0, ox: 0, oy: 0 });
  const [messages, setMessages]   = useState<BotMessage[]>(() => {
    // Hydrate from localStorage on first render
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (raw) return JSON.parse(raw) as BotMessage[];
    } catch { /* ignore */ }
    return [];
  });
  const [input, setInput]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [model, setModel]         = useState('');
  const historyRef                = useRef<Array<{ role: string; content: string }>>([]);
  const bottomRef                 = useRef<HTMLDivElement>(null);
  const inputRef                  = useRef<HTMLInputElement>(null);

  // Persist drag position
  useEffect(() => {
    try { localStorage.setItem(DRAG_STORAGE_KEY, JSON.stringify(dragOffset)); } catch { /* ignore */ }
  }, [dragOffset]);

  // Global mouse drag handlers
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const newX = dragOriginRef.current.ox + (e.clientX - dragOriginRef.current.mx);
      const newY = dragOriginRef.current.oy + (e.clientY - dragOriginRef.current.my);
      // Clamp so at least 80px stays on screen
      const clampedX = Math.min(window.innerWidth - 80, Math.max(-(window.innerWidth - 80), newX));
      const clampedY = Math.min(window.innerHeight - 80, Math.max(-(window.innerHeight - 80), newY));
      setDragOffset({ x: clampedX, y: clampedY });
    };
    const onUp = () => { draggingRef.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const handleDragStart = (e: React.MouseEvent) => {
    draggingRef.current = true;
    dragOriginRef.current = { mx: e.clientX, my: e.clientY, ox: dragOffset.x, oy: dragOffset.y };
    e.preventDefault();
  };

  // Rebuild historyRef from persisted messages on mount
  useEffect(() => {
    historyRef.current = messages.map(m => ({ role: m.role, content: m.content }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch { /* quota exceeded or SSR — ignore */ }
  }, [messages]);

  // Load model from agent defaults, fall back to empty string (server will use best free)
  useEffect(() => {
    const defaults = loadAgentDefaults();
    if (defaults.assistantModel) setModel(defaults.assistantModel);
  }, [open]); // re-read on open in case user just changed settings

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Show a context-aware greeting when first opened
  useEffect(() => {
    if (!open || messages.length > 0) return;
    const greeting = `Hi! I'm your OpenPilot assistant. You're on the **${TAB_NAMES[activeTab]}** page. How can I help?`;
    const { display, actions } = parseActions(greeting);
    setMessages([{ role: 'assistant', content: greeting, displayContent: display, actions }]);
  }, [open, activeTab, messages.length]);

  const executeActions = useCallback((actions: ParsedAction[]) => {
    for (const action of actions) {
      if (action.type === 'nav' && action.payload) {
        const tab = action.payload as TabName;
        const valid: TabName[] = ['dashboard', 'chat', 'docs', 'autopilot', 'apikeys'];
        if (valid.includes(tab)) onNavigate(tab);
      } else if (action.type === 'new_run') {
        onNewRun();
      } else if (action.type === 'new_chat') {
        onNewChat();
      }
    }
  }, [onNavigate, onNewRun, onNewChat]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    setInput('');
    setLoading(true);

    const userMsg: BotMessage = { role: 'user', content: text, displayContent: text, actions: [] };
    setMessages(prev => [...prev, userMsg]);

    // Build history for API — include current system context
    const systemMsg = { role: 'system', content: buildSystemPrompt(activeTab) };
    historyRef.current = [...historyRef.current, { role: 'user', content: text }];
    const history = [systemMsg, ...historyRef.current];

    try {
      const res = await fetch('/api/agents/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history,
          model: model || undefined,
        }),
      });
      const data = await res.json() as { reply?: string; error?: string };
      const raw = data.reply ?? `Sorry, I couldn't get a response: ${data.error ?? 'unknown error'}`;
      const { display, actions } = parseActions(raw);

      historyRef.current = [...historyRef.current, { role: 'assistant', content: raw }];

      const botMsg: BotMessage = { role: 'assistant', content: raw, displayContent: display, actions };
      setMessages(prev => [...prev, botMsg]);

      // Small delay so message renders before navigation
      if (actions.length > 0) {
        setTimeout(() => executeActions(actions), 150);
      }
    } catch (err) {
      const errMsg: BotMessage = {
        role: 'assistant',
        content: `Error: ${(err as Error).message}`,
        displayContent: `Error: ${(err as Error).message}`,
        actions: [],
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [loading, activeTab, model, executeActions]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setOpen(v => !v)}
        title="OpenPilot Assistant"
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        className={`fixed bottom-14 right-4 z-50 w-10 h-10 rounded-full shadow-lg flex items-center justify-center transition-colors duration-200 select-none ${
          open
            ? 'bg-gray-800 border border-gray-700 shadow-md hover:bg-gray-700'
            : 'bg-blue-600 hover:bg-blue-700'
        }`}
        style={{ transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }}
      >
        {open ? (
          /* Close X */
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          /* Chat bubble */
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-4 4v-4z" />
          </svg>
        )}
      </button>

      {/* Chat panel */}
      <div
        className={`fixed bottom-[6.5rem] right-4 z-40 w-80 sm:w-96 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden transition-opacity duration-300 ease-out ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{
          maxHeight: 'min(720px, calc(100vh - 5rem))',
          transform: `translate(${dragOffset.x}px, ${dragOffset.y}px) translateY(${open ? '0' : '1rem'})`,
          transition: 'opacity 0.3s ease-out, transform 0.3s ease-out',
        }}
      >
        {/* Header — drag handle */}
        <div
          className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-700 bg-blue-600 text-white rounded-t-2xl shrink-0 cursor-grab active:cursor-grabbing select-none"
          onMouseDown={handleDragStart}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-4 4v-4z" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-tight">OpenPilot Assistant</p>
            <p className="text-xs text-blue-200 truncate">{TAB_NAMES[activeTab]}</p>
          </div>
          <button
            onClick={() => {
              setMessages([]);
              historyRef.current = [];
              try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
            }}
            title="Clear conversation"
            className="text-blue-200 hover:text-white transition-colors text-xs"
          >
            Clear
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100 rounded-bl-sm'
                }`}
              >
                {renderMarkdown(msg.displayContent)}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-bl-sm px-4 py-2.5">
                <span className="inline-flex gap-1">
                  {[0, 1, 2].map(i => (
                    <span
                      key={i}
                      className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: `${i * 100}ms` }}
                    />
                  ))}
                </span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Quick suggestions */}
        {messages.length <= 1 && !loading && (
          <div className="px-4 pb-2 flex flex-wrap gap-1.5 shrink-0">
            {QUICK_SUGGESTIONS[activeTab]?.map(suggestion => (
              <button
                key={suggestion}
                onClick={() => void sendMessage(suggestion)}
                className="text-xs px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="px-3 pb-3 shrink-0">
          <div className="flex gap-2 items-center bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask me anything…"
              disabled={loading}
              className="flex-1 bg-transparent text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 outline-none min-w-0"
            />
            <button
              onClick={() => void sendMessage(input)}
              disabled={loading || !input.trim()}
              className="text-blue-600 dark:text-blue-400 hover:text-blue-800 disabled:opacity-30 transition-opacity shrink-0"
              aria-label="Send"
            >
              ➤
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Quick suggestions per tab ──────────────────────────────────────────────────

const QUICK_SUGGESTIONS: Partial<Record<TabName, string[]>> = {
  dashboard: ['What do my stats mean?', 'How do I lower costs?', 'Open agent defaults'],
  chat:      ['Start a new conversation', 'What models are available?', 'How do I use agents?'],
  autopilot: ['Start a new agent run', 'What agent types are there?', 'How do I use Auto Pilot?'],
  docs:      ['How do I use the API?', 'Show me chat examples', 'How do I get an API key?'],
  apikeys:   ['Take me to API keys', 'How do API keys work?', 'What can I use the API for?'],
};

// ── Minimal inline markdown renderer ──────────────────────────────────────────

function renderMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\`[^`]+\`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="bg-gray-200 dark:bg-gray-700 px-1 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}
