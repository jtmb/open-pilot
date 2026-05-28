import { NextRequest, NextResponse } from 'next/server';
import { sendCopilotPrompt } from '@/services/copilotService';

// POST /api/copilot
// Body: { prompt: string; model?: string; mode?: 'ask' | 'plan' | 'agent' }

const handler = async (req: NextRequest) => {
  try {
    const { prompt, model, mode, reasoningEffort, systemPrompt, history } = await req.json();
    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const copilotResponse = await sendCopilotPrompt(prompt, { model, mode, reasoningEffort, systemPrompt, history });
    return NextResponse.json({ result: copilotResponse });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
};

export { handler as POST };


