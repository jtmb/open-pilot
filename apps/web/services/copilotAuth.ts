// services/copilotAuth.ts
// Shared utility for obtaining a GitHub Copilot Bearer token.
// Reads the OAuth token from the copilot-auth Docker volume and exchanges it
// for a short-lived Copilot API token (valid ~30 min).

import { readFileSync } from 'fs';

const HOSTS_FILE = process.env.COPILOT_HOSTS_FILE || '/copilot-auth/hosts.json';
const TOKEN_URL  = 'https://api.github.com/copilot_internal/v2/token';

let cachedToken: string | null = null;
let tokenExpiry = 0;

export function getOAuthToken(): string {
  const raw = readFileSync(HOSTS_FILE, 'utf8');
  const hosts = JSON.parse(raw) as Record<string, { oauth_token?: string }>;
  const token = hosts['github.com']?.oauth_token;
  if (!token) throw new Error(`No oauth_token found in ${HOSTS_FILE}`);
  return token;
}

/** Clears the cached token so the next call to getCopilotToken() forces a refresh.
 *  Call this whenever the Copilot API returns 401 so expired tokens don't persist. */
export function invalidateCopilotToken(): void {
  cachedToken = null;
  tokenExpiry = 0;
}

export async function getCopilotToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const oauthToken = getOAuthToken();
  console.log('[copilot-auth] refreshing Copilot API token');

  const res = await fetch(TOKEN_URL, {
    headers: {
      Authorization: `token ${oauthToken}`,
      'User-Agent':  'GitHubCopilotChat/0.49.0',
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as { token: string; refresh_in?: number };
  cachedToken = data.token;
  tokenExpiry = Date.now() + ((data.refresh_in ?? 1800) - 60) * 1000;
  return cachedToken;
}

/**
 * Fetches a URL using a cached Copilot token, automatically retrying once on
 * 401 (token expired server-side before our local clock expired it).
 *
 * Usage:
 *   const res = await fetchWithCopilotToken(CHAT_URL, (token) => ({
 *     method: 'POST',
 *     headers: { Authorization: `Bearer ${token}`, ... },
 *     body: JSON.stringify(payload),
 *   }));
 */
export async function fetchWithCopilotToken(
  url: string,
  optsFn: (token: string) => RequestInit,
): Promise<Response> {
  const token = await getCopilotToken();
  const res = await fetch(url, optsFn(token));
  if (res.status !== 401) return res;
  // Token rejected — clear cache and retry once with a fresh token
  invalidateCopilotToken();
  const freshToken = await getCopilotToken();
  return fetch(url, optsFn(freshToken));
}
