import { NextResponse } from 'next/server';
import { startCopilotDeviceFlow } from '@/services/copilotDeviceFlow';
import { existsSync, readFileSync } from 'fs';

export const dynamic = 'force-dynamic';

const HOSTS_FILE = process.env.COPILOT_HOSTS_FILE || '/copilot-auth/hosts.json';

/** Check whether Copilot credentials already exist. */
export async function GET() {
  try {
    if (!existsSync(HOSTS_FILE)) {
      return NextResponse.json({ authorized: false });
    }
    const raw = readFileSync(HOSTS_FILE, 'utf8');
    const hosts = JSON.parse(raw) as Record<string, { oauth_token?: string }>;
    const hasToken = !!hosts['github.com']?.oauth_token;
    return NextResponse.json({ authorized: hasToken });
  } catch {
    return NextResponse.json({ authorized: false });
  }
}

/** Start a GitHub Copilot device authorization flow. */
export async function POST() {
  try {
    const flow = await startCopilotDeviceFlow();
    return NextResponse.json({
      success: true,
      userCode: flow.userCode,
      verificationUri: flow.verificationUriComplete,
      deviceCode: flow.deviceCode,
      interval: flow.interval,
      expiresIn: flow.expiresIn,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
