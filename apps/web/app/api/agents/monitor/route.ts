import { NextRequest, NextResponse } from 'next/server';
import { fetchWithCopilotToken } from '@/services/copilotAuth';

const CHAT_URL = 'https://api.githubcopilot.com/chat/completions';

const MONITOR_SYSTEM = `You are an AI orchestration quality monitor. You observe a Worker agent / Manager agent loop that builds software autonomously.

Identify bugs, loop conditions, and concrete optimizations in their interaction.

Respond ONLY with a raw JSON array — no markdown, no explanation. Max 4 findings per call.

Schema: [{"severity":"error"|"warning"|"info","category":"loop"|"compliance"|"task-quality"|"suggestion","message":"concise finding under 120 chars"}]

Severity guide:
- "error":   Run will stall or produce wrong output (same correction repeated, manager emits no token, token content truncated)
- "warning": Reduces quality or efficiency (task too vague, worker ignoring spec, correction too broad)
- "info":    Minor improvement opportunity

Return [] if the interaction looks healthy.`;

export interface ApiMonitorFinding {
  severity: 'error' | 'warning' | 'info';
  category: 'loop' | 'compliance' | 'task-quality' | 'suggestion';
  message: string;
}

export async function POST(req: NextRequest) {
  try {
    const {
      iteration,
      status,
      recentLog,
      correctionCount,
      questionCount,
      workerModel,
      managerModel,
      model = 'gpt-4o',
    } = await req.json() as {
      iteration:       number;
      status:          string;
      recentLog:       Array<{ from: string; type: string; content: string }>;
      correctionCount: number;
      questionCount:   number;
      workerModel:     string;
      managerModel:    string;
      model?:          string;
    };

    const userMsg = [
      `Run: iteration ${iteration}, status: ${status}`,
      `Worker model: ${workerModel}  |  Manager model: ${managerModel}`,
      `Total corrections so far: ${correctionCount}  |  Total questions so far: ${questionCount}`,
      '',
      'Recent interactions (newest last):',
      recentLog
        .map(e =>
          `[${e.from}/${e.type}]\n${e.content.slice(0, 500)}${e.content.length > 500 ? '…' : ''}`,
        )
        .join('\n\n---\n\n'),
      '',
      'Reply with a JSON array of findings only.',
    ].join('\n');

    const monitorBody = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: MONITOR_SYSTEM },
        { role: 'user',   content: userMsg },
      ],
      temperature: 0,
      top_p:       1,
      stream:      false,
    });

    const res = await fetchWithCopilotToken(CHAT_URL, (token) => ({
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
      body: monitorBody,
      signal: AbortSignal.timeout(30_000),
    }));

    if (!res.ok) {
      return NextResponse.json({ findings: [] });
    }

    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    const raw = data.choices?.[0]?.message?.content ?? '[]';
    // Strip markdown fences the model might add
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    const findings: ApiMonitorFinding[] = JSON.parse(cleaned);

    return NextResponse.json({ findings: Array.isArray(findings) ? findings : [] });
  } catch {
    // Never let monitor errors surface to the client — just return empty
    return NextResponse.json({ findings: [] });
  }
}
