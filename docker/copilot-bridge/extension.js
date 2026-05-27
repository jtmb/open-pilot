// copilot-bridge/extension.js
// Exposes GitHub Copilot LM API on HTTP :3001 so the web service can query it
// without needing UI automation (Playwright).
//
// Routes:
//   GET  /health  → { status: 'ok', models: [...] }
//   POST /chat    → { prompt: string } → { result: string, modelUsed: string }

const vscode = require('vscode');
const http = require('http');

const PORT = 3001;
const log = (...a) => console.log('[copilot-bridge]', ...a);

/** Return the best available Copilot model, preferring gpt-4o for speed. */
async function pickModel() {
  for (const family of ['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4-5', 'claude-3-7-sonnet']) {
    const ms = await vscode.lm.selectChatModels({ vendor: 'copilot', family });
    if (ms.length) return ms[0];
  }
  // Fall back to any copilot model
  const any = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  return any[0] ?? null;
}

/** Send a single user message and collect the full response text. */
async function chat(prompt) {
  const model = await pickModel();
  if (!model) throw new Error('No Copilot LM model available — is Copilot signed in?');

  const messages = [vscode.LanguageModelChatMessage.User(prompt)];
  const cts = new vscode.CancellationTokenSource();
  const response = await model.sendRequest(messages, {}, cts.token);

  let result = '';
  for await (const chunk of response.text) {
    result += chunk;
  }
  return { result, modelUsed: model.id || model.family || 'unknown' };
}

let server;

function activate(context) {
  server = http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      try {
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        send(200, { status: 'ok', models: models.map(m => m.id || m.family) });
      } catch (e) {
        send(503, { status: 'error', error: e.message });
      }
      return;
    }

    // Chat endpoint
    if (req.method === 'POST' && req.url === '/chat') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', async () => {
        try {
          const { prompt } = JSON.parse(body);
          if (!prompt) return send(400, { error: 'prompt is required' });
          log('prompt:', prompt.slice(0, 80));
          const data = await chat(prompt);
          log('response:', data.result.slice(0, 80), '| model:', data.modelUsed);
          send(200, data);
        } catch (e) {
          log('ERROR:', e.message);
          send(500, { error: e.message || String(e) });
        }
      });
      return;
    }

    send(404, { error: 'Not found' });
  });

  server.listen(PORT, '0.0.0.0', () => log(`listening on :${PORT}`));
  context.subscriptions.push({ dispose: () => server?.close() });
  log('activated');
}

function deactivate() {
  server?.close();
}

module.exports = { activate, deactivate };
