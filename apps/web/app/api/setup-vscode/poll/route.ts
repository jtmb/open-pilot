import { NextRequest, NextResponse } from 'next/server';
import { pollCopilotToken } from '@/services/copilotDeviceFlow';
import { injectCopilotToken } from '@/services/codeServerSetup';

export const dynamic = 'force-dynamic';

/**
 * Poll GitHub to see if the user has authorized the device code.
 * When authorized: injects the Copilot token into code-server and restarts it.
 *
 * Query params:
 *   device_code  – the device_code returned by POST /api/setup-vscode
 *   username     – the GitHub username (from session.user.name on the client)
 */
export async function GET(req: NextRequest) {
  const deviceCode = req.nextUrl.searchParams.get('device_code');
  const username = req.nextUrl.searchParams.get('username') ?? 'user';

  if (!deviceCode) {
    return NextResponse.json({ status: 'error', error: 'Missing device_code' }, { status: 400 });
  }

  const result = await pollCopilotToken(deviceCode);

  if (result.status === 'authorized') {
    try {
      await injectCopilotToken(result.accessToken, username);
    } catch (e: any) {
      console.error('[setup-vscode/poll] injection failed:', e?.message);
      return NextResponse.json({ status: 'error', error: `Token injection failed: ${e?.message}` });
    }
    return NextResponse.json({ status: 'authorized' });
  }

  return NextResponse.json(result);
}
