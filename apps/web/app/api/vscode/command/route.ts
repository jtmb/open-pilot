import { NextRequest, NextResponse } from 'next/server';
import { sendVSCodeCommand } from '@/services/vscodeService';

// POST /api/vscode/command
// Body: { command: string, args?: any[] }
export async function POST(req: NextRequest) {
  try {
    const { command, args } = await req.json();
    if (!command) {
      return NextResponse.json({ error: 'Command is required' }, { status: 400 });
    }
    const result = await sendVSCodeCommand(command, args);
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
