/**
 * GitHub Copilot device authorization flow.
 * Initiates and polls GitHub's OAuth device flow using the Copilot extension's
 * public client ID — produces a token that the Copilot VS Code extension accepts.
 */
const COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';

export interface DeviceFlowStart {
  deviceCode: string;
  userCode: string;
  /** Plain verification URL */
  verificationUri: string;
  /** Verification URL with user code pre-filled — open this in the browser */
  verificationUriComplete: string;
  /** Minimum seconds between poll requests */
  interval: number;
  expiresIn: number;
}

export async function startCopilotDeviceFlow(): Promise<DeviceFlowStart> {
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: COPILOT_CLIENT_ID,
      scope: 'copilot user:email gist',
    }),
  });

  if (!res.ok) {
    throw new Error(`GitHub device/code failed: ${res.status} ${await res.text()}`);
  }

  const d = await res.json();
  const verificationUri: string = d.verification_uri ?? 'https://github.com/login/device';
  const userCode: string = d.user_code ?? '';

  return {
    deviceCode: d.device_code,
    userCode,
    verificationUri,
    verificationUriComplete:
      d.verification_uri_complete ?? `${verificationUri}?user_code=${userCode}`,
    interval: d.interval ?? 5,
    expiresIn: d.expires_in ?? 900,
  };
}

export type PollResult =
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'authorized'; accessToken: string }
  | { status: 'expired' | 'error'; error: string };

export async function pollCopilotToken(deviceCode: string): Promise<PollResult> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: COPILOT_CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });

  if (!res.ok) return { status: 'error', error: `HTTP ${res.status}` };

  const d = await res.json();

  if (d.access_token) return { status: 'authorized', accessToken: d.access_token };
  if (d.error === 'authorization_pending') return { status: 'pending' };
  if (d.error === 'slow_down') return { status: 'slow_down', interval: d.interval ?? 10 };
  if (d.error === 'expired_token')
    return { status: 'expired', error: 'Authorization code expired — please try again.' };
  return { status: 'error', error: d.error_description ?? d.error ?? 'Unknown error' };
}
