import { NextRequest, NextResponse } from 'next/server';
import { getCopilotToken } from '@/services/copilotAuth';

const CHAT_URL = 'https://api.githubcopilot.com/chat/completions';

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

    const body: Record<string, unknown> = {
      model,
      messages: history,
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
      // Agents may produce long outputs — allow 2 min
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return NextResponse.json(
        { error: `Copilot API ${res.status}: ${errBody.slice(0, 200)}` },
        { status: res.status },
      );
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    const reply = data.choices?.[0]?.message?.content ?? '';

    return NextResponse.json({ reply });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
