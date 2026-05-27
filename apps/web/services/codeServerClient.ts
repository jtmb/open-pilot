

const CODE_SERVER_URL = process.env.CODE_SERVER_URL || 'http://localhost:8080';
const CODE_SERVER_PASSWORD = process.env.CODE_SERVER_PASSWORD || 'changeme';


// Authenticates and returns a cookie for code-server
export async function getCodeServerCookie(): Promise<string> {
  const res = await fetch(`${CODE_SERVER_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `password=${encodeURIComponent(CODE_SERVER_PASSWORD)}`
  });
  if (!res.ok) throw new Error('Failed to authenticate with code-server');
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('No cookie received from code-server');
  return setCookie.split(';')[0];
}

// Sends a request to the Copilot extension running in code-server (placeholder)
export async function sendCopilotRequest(prompt: string): Promise<string> {
  // This is a placeholder. Real implementation depends on Copilot extension API.
  // For now, just echo the prompt.
  return `Copilot (code-server) response to: ${prompt}`;
}
