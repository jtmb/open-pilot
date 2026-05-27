import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

export interface SetupResult {
  success: boolean;
  deviceCode?: string;
  verificationUri?: string;
  alreadySignedIn?: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Token injection — writes hosts.json to the shared Docker volume then restarts
// code-server so it picks up the new Copilot credentials on next boot.
// ---------------------------------------------------------------------------

const COPILOT_AUTH_PATH = process.env.COPILOT_AUTH_PATH ?? '/copilot-auth/hosts.json';

export async function injectCopilotToken(accessToken: string, username: string): Promise<void> {
  const hostsData = { 'github.com': { user: username, oauth_token: accessToken } };
  const dir = path.dirname(COPILOT_AUTH_PATH);

  fs.mkdirSync(dir, { recursive: true });
  try { fs.chmodSync(dir, 0o777); } catch { /* ignore if already correct */ }
  fs.writeFileSync(COPILOT_AUTH_PATH, JSON.stringify(hostsData), 'utf8');
  try { fs.chmodSync(COPILOT_AUTH_PATH, 0o666); } catch { /* ignore */ }

  await restartCodeServerContainer();
}

function dockerRequest(method: string, urlPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: '/var/run/docker.sock', path: urlPath, method },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function restartCodeServerContainer(): Promise<void> {
  const encoded = encodeURIComponent(JSON.stringify({ name: ['code-server'] }));
  const listRes = await dockerRequest('GET', `/containers/json?filters=${encoded}`);
  const containers: Array<{ Id: string; Names: string[] }> = JSON.parse(listRes.body);
  if (!containers.length) throw new Error('code-server container not found via Docker socket');
  await dockerRequest('POST', `/containers/${containers[0].Id}/restart`);
}


/**
 * @deprecated No longer used — device flow now initiated server-side via copilotDeviceFlow.ts
 */
export async function triggerCopilotSignIn(): Promise<SetupResult> {
  const CODE_SERVER_URL = process.env.CODE_SERVER_URL || 'http://code-server:8080';
  const CODE_SERVER_PASSWORD = process.env.CODE_SERVER_PASSWORD || 'changeme';

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  try {
    await page.goto(CODE_SERVER_URL, { timeout: 30000 });

    // Log in if password screen is shown
    const passwordInput = page.locator('input[type="password"]');
    if (await passwordInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await passwordInput.fill(CODE_SERVER_PASSWORD);
      await page.locator('button[type="submit"]').click();
      await page.waitForLoadState('networkidle', { timeout: 20000 });
    }

    // Wait for the VS Code workbench
    await page.waitForSelector('.monaco-workbench', { timeout: 30000 });
    await page.waitForTimeout(3000);

    // Check if Copilot is already signed in by looking for the Copilot icon in status bar
    const statusBarCopilot = page.locator('.statusbar-item[id*="GitHub.copilot"] .codicon-copilot, .statusbar-item[id*="GitHub.copilot"] .codicon-copilot-warning').first();
    const copilotActive = await statusBarCopilot.isVisible({ timeout: 2000 }).catch(() => false);
    if (copilotActive) {
      // Check if it's warning (not signed in) or normal (signed in)
      const warning = await page.locator('.statusbar-item[id*="GitHub.copilot"] .codicon-copilot-warning').isVisible({ timeout: 500 }).catch(() => false);
      if (!warning) {
        await browser.close();
        return { success: true, alreadySignedIn: true };
      }
    }

    // Trigger GitHub Copilot sign-in via command palette
    await page.keyboard.press('F1');
    await page.waitForTimeout(600);

    const commandInput = page.locator('.quick-input-widget input[type="text"]').first();
    await commandInput.waitFor({ timeout: 5000 });
    await commandInput.fill('GitHub Copilot: Sign In');
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(4000);

    // Try to capture the device code from a notification or dialog
    const deviceCode = await extractDeviceCode(page);

    await browser.close();

    if (deviceCode) {
      return {
        success: true,
        deviceCode,
        verificationUri: 'https://github.com/login/device',
      };
    }

    return {
      success: false,
      error: 'Could not capture device code. The Copilot extension may need to be installed first — restart code-server and try again.',
    };
  } catch (err: any) {
    await browser.close().catch(() => { /* ignore */ });
    return { success: false, error: err.message };
  }
}

async function extractDeviceCode(page: any): Promise<string | null> {
  // VS Code shows device code in: notification toast, dialog, or quick pick
  const textSources = [
    '.notification-list-item-message',
    '.dialog-message-detail',
    '.dialog-message-text',
    '.monaco-dialog-message-detail',
    '.quick-input-widget .label-description',
    '.notifications-toasts .notification-list-item-message',
  ];

  for (const selector of textSources) {
    try {
      const elements = await page.locator(selector).all();
      for (const el of elements) {
        const text = await el.textContent().catch(() => '');
        // Device code format: XXXX-XXXX
        const match = text?.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/);
        if (match) return match[1];
      }
    } catch { /* try next */ }
  }

  // Also try scanning the entire notification area
  try {
    const notifArea = page.locator('.notifications-toasts, .notification-center');
    const fullText = await notifArea.textContent({ timeout: 3000 }).catch(() => '');
    const match = fullText?.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/);
    if (match) return match[1];
  } catch { /* ignore */ }

  return null;
}
