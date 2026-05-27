import { NextRequest, NextResponse } from 'next/server';
import { sendCopilotPrompt } from '@/services/copilotService';

// POST /api/copilot
// Body: { prompt: string; model?: string; mode?: 'ask' | 'plan' | 'agent' }

let busy = false;

const handler = async (req: NextRequest) => {
  if (busy) {
    return NextResponse.json({ error: 'Another Copilot request is in progress' }, { status: 429 });
  }
  busy = true;
  try {
    const { prompt, model, mode, reasoningEffort, systemPrompt, history } = await req.json();
    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const copilotResponse = await sendCopilotPrompt(prompt, { model, mode, reasoningEffort, systemPrompt, history });
    return NextResponse.json({ result: copilotResponse });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  } finally {
    busy = false;
  }
};

export { handler as POST };


