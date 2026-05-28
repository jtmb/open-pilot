import { NextRequest, NextResponse } from 'next/server';
import { getCopilotToken } from '@/services/copilotAuth';
import { trimToContextBudget } from '@/services/agentOrchestrator';

const CHAT_URL = 'https://api.githubcopilot.com/chat/completions';

/** Call the Copilot chat completions endpoint. Returns the raw Response. */
async function callCopilot(
  messages: Array<{ role: string; content: string }>,
  model: string,
  reasoningEffort: string | undefined,
  token: string,
): Promise<Response> {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0,
    top_p: 1,
    stream: false,
  };
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;

  return fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization:            `Bearer ${token}`,
      'Content-Type':           'application/json',
      'User-Agent':             'GitHubCopilotChat/0.49.0',
      'editor-version':         'vscode/1.99.0',
      'editor-plugin-version':  'copilot-chat/0.49.0',
      'openai-intent':          'conversation-panel',
      'copilot-integration-id': 'vscode-chat',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
}

export async function POST(req: NextRequest) {
  try {
    const { history, model = 'gpt-4o', reasoningEffort } = await req.json() as {
      history: Array<{ role: string; content: string }>;
      model?: string;
      reasoningEffort?: string;
    };

    if (!Array.isArray(history) || history.length === 0) {
      return NextResponse.json({ error: 'history array is required' }, { status: 400 });
    }

    const token = await getCopilotToken();

    let res = await callCopilot(history, model, reasoningEffort, token);

    // ── Reactive retry: if the model rejects due to token overflow, trim and retry once ──
    if (!res.ok && res.status === 400) {
      const errText = await res.text();
      if (errText.includes('model_max_prompt_tokens_exceeded') || errText.includes('prompt token count')) {
        // Cast to the AgentMessage shape trimToContextBudget expects
        const typed = history as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
        const { messages: trimmedMessages } = trimToContextBudget(typed);
        if (trimmedMessages.length < history.length) {
          res = await callCopilot(trimmedMessages, model, reasoningEffort, token);
        }
        if (!res.ok) {
          const retryErr = await res.text();
          return NextResponse.json(
            { error: `Copilot API ${res.status}: ${retryErr.slice(0, 200)}` },
            { status: res.status },
          );
        }
      } else {
        return NextResponse.json(
          { error: `Copilot API ${res.status}: ${errText.slice(0, 200)}` },
          { status: res.status },
        );
      }
    } else if (!res.ok) {
      const errBody = await res.text();
      return NextResponse.json(
        { error: `Copilot API ${res.status}: ${errBody.slice(0, 200)}` },
        { status: res.status },
      );
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const reply = data.choices?.[0]?.message?.content ?? '';
    const promptTokens     = data.usage?.prompt_tokens     ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? 0;

    return NextResponse.json({ reply, promptTokens, completionTokens });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
