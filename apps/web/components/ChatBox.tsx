'use client';
import { useEffect, useRef, useState } from 'react';
import type { Mode } from './ModelSelector';

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
}

export default function ChatBox({ conversation, model, mode, reasoningEffort, onUpdate }: Props) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('approvals');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation.messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMsg: Message = {
      id: Date.now() + '-user',
      role: 'user',
      content: input.trim(),
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

    try {
      const res = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userMsg.content, model, mode, reasoningEffort: reasoningEffort || undefined }),
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

  return (
    <div className="flex flex-col h-full">
      {/* Badge showing active model / mode + approval mode */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-gray-50 dark:bg-gray-800 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
        <span className="bg-gray-200 rounded px-2 py-0.5">{model}</span>
        <span className="bg-gray-200 rounded px-2 py-0.5 capitalize">{mode}</span>
        {reasoningEffort && (
          <span className="bg-purple-100 text-purple-700 rounded px-2 py-0.5 capitalize">🧠 {reasoningEffort}</span>
        )}
        <span className="ml-auto">
          <select
            className="border rounded px-2 py-0.5 text-xs bg-white text-gray-700 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-400"
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

      {/* Messages */}
      <div className="flex-1 overflow-auto p-6 space-y-4 bg-white dark:bg-gray-900">
        {conversation.messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
            <span className="text-4xl">💬</span>
            <p className="text-sm">Start a new conversation</p>
          </div>
        )}
        {conversation.messages.map(msg => (
          <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div
              className={`rounded-2xl px-4 py-2 max-w-2xl whitespace-pre-wrap text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
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
          </div>
        ))}
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
        className="flex p-4 border-t bg-gray-50 dark:bg-gray-800 dark:border-gray-700 gap-2"
        onSubmit={e => { e.preventDefault(); sendMessage(); }}
      >
        <textarea
          className="flex-1 border rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-400"
          placeholder="Type your message…"
          rows={2}
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
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50 transition-colors"
          disabled={loading || !input.trim()}
        >
          Send
        </button>
      </form>
    </div>
  );
}
