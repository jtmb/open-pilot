// services/codeServerAutomation.ts
// Calls GitHub Copilot's chat completions API directly.

import { getCopilotToken } from './copilotAuth';

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
}

export async function sendToCodeServerChatBox(
  message: string,
  { model = 'gpt-4o', mode = 'ask', reasoningEffort }: CopilotOptions = {},
): Promise<string> {
  log(`sending [model=${model} mode=${mode} effort=${reasoningEffort ?? 'default'}]:`, message.slice(0, 80));
  const token = await getCopilotToken();

  const systemText = MODE_SYSTEM[mode] ?? '';
  const messages: Array<{ role: string; content: string }> = [];
  if (systemText) messages.push({ role: 'system', content: systemText });
  messages.push({ role: 'user', content: message });

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0,
    top_p: 1,
    stream: false,
  };
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;

  const res = await fetch(CHAT_URL, {
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
  });

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
