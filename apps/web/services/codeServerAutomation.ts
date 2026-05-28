// services/codeServerAutomation.ts
// Calls GitHub Copilot's chat completions API directly.

import { fetchWithCopilotToken } from './copilotAuth';

const log = (...args: unknown[]) => console.log('[COPILOT]', ...args);

const CHAT_URL = 'https://api.githubcopilot.com/chat/completions';

const MODE_SYSTEM: Record<string, string> = {
  ask:   '',
  plan:  'You are a technical planner and architect. Analyze the requirements and produce a clear, structured implementation plan with numbered steps, key considerations, and best practices.',
  agent: 'You are an autonomous AI coding agent. Break the task into concrete sub-tasks and address each one systematically, producing working code and explanations.',
};

export interface CopilotOptions {
  model?: string;
  mode?:  'ask' | 'plan' | 'agent';
  reasoningEffort?: string;
  /** Extra system prompt prepended after the mode-based system prompt (e.g. personality) */
  systemPrompt?: string;
  /** Previous conversation messages for multi-turn context */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export async function sendToCodeServerChatBox(
  message: string,
  { model = 'gpt-4o', mode = 'ask', reasoningEffort, systemPrompt, history }: CopilotOptions = {},
): Promise<string> {
  log(`sending [model=${model} mode=${mode} effort=${reasoningEffort ?? 'default'}]:`, message.slice(0, 80));

  const baseSystem = MODE_SYSTEM[mode] ?? '';
  const fullSystem = [baseSystem, systemPrompt].filter(Boolean).join('\n\n');
  const messages: Array<{ role: string; content: string }> = [];
  if (fullSystem) messages.push({ role: 'system', content: fullSystem });
  // Include prior conversation turns for context
  for (const h of (history ?? [])) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: 'user', content: message });

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0,
    top_p: 1,
    stream: false,
  };
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;

  const res = await fetchWithCopilotToken(CHAT_URL, (token) => ({
    method: 'POST',
    headers: {
      Authorization:           `Bearer ${token}`,
      'Content-Type':          'application/json',
      'User-Agent':            'GitHubCopilotChat/0.49.0',
      'editor-version':        'vscode/1.99.0',
      'editor-plugin-version': 'copilot-chat/0.49.0',
      'openai-intent':         'conversation-panel',
      'copilot-integration-id':'vscode-chat',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  }));

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Copilot API ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>;
  };
  const result = data.choices?.[0]?.message?.content ?? '';
  log('result:', result.slice(0, 200));
  return result;
}
