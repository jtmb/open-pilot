'use client';
import { useState } from 'react';

type Section =
  | 'overview'
  | 'github-oauth'
  | 'api-chat'
  | 'api-tools'
  | 'api-format'
  | 'api-models';

const NAV: Array<{ id: Section; label: string; group?: string }> = [
  { id: 'overview',     label: '📖 Overview' },
  { id: 'github-oauth', label: '🔐 GitHub OAuth' },
  { id: 'api-chat',     label: 'Chat Completions',   group: '🔌 API Reference' },
  { id: 'api-tools',    label: 'Tools & Functions',  group: '🔌 API Reference' },
  { id: 'api-format',   label: 'Response Format',    group: '🔌 API Reference' },
  { id: 'api-models',   label: 'List Models',        group: '🔌 API Reference' },
];

export default function Documentation() {
  const [active, setActive] = useState<Section>('overview');

  // Build nav with group headers
  const rendered: JSX.Element[] = [];
  let lastGroup: string | undefined;
  for (const item of NAV) {
    if (item.group && item.group !== lastGroup) {
      lastGroup = item.group;
      rendered.push(
        <p key={`g-${item.group}`} className="mt-3 mb-1 px-3 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 select-none">
          {item.group}
        </p>,
      );
    }
    const indented = !!item.group;
    rendered.push(
      <button
        key={item.id}
        onClick={() => setActive(item.id)}
        className={`w-full text-left text-sm px-3 py-1.5 rounded transition-colors ${indented ? 'pl-5 text-xs' : ''} ${
          active === item.id
            ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium'
            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
        }`}
      >
        {indented ? `└ ${item.label}` : item.label}
      </button>,
    );
  }

  return (
    <div className="flex h-full overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Left nav — page tree */}
      <nav className="w-52 shrink-0 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 overflow-y-auto">
        {rendered}
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8">
        {active === 'overview'     && <OverviewDocs />}
        {active === 'github-oauth' && <GitHubOAuthDocs />}
        {active === 'api-chat'     && <ApiChatDocs />}
        {active === 'api-tools'    && <ApiToolsDocs />}
        {active === 'api-format'   && <ApiFormatDocs />}
        {active === 'api-models'   && <ApiModelsDocs />}
      </div>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <code className="bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-1.5 py-0.5 font-mono text-xs">
      {children}
    </code>
  );
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="bg-gray-900 text-green-300 rounded-xl p-4 text-xs font-mono overflow-x-auto whitespace-pre">
      {children}
    </pre>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
        {n}
      </div>
      <div className="space-y-2 flex-1">
        <h4 className="font-semibold text-gray-900 dark:text-white text-sm">{title}</h4>
        <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">{children}</div>
      </div>
    </div>
  );
}

function GitHubOAuthDocs() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Setting up GitHub OAuth</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          GitHub OAuth lets users sign in with their GitHub account and gives the app access to their GitHub Copilot token.
        </p>
      </div>

      <div className="space-y-6">
        <Step n={1} title="Create a GitHub OAuth App">
          <p>Go to <strong>GitHub → Settings → Developer settings → OAuth Apps → New OAuth App</strong>.</p>
          <p>Or visit: <code className="text-blue-600 dark:text-blue-400 text-xs">https://github.com/settings/applications/new</code></p>
          <p>Fill in the fields:</p>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-2 text-xs font-mono">
            <div><span className="text-gray-400">Application name:</span> <span className="text-gray-900 dark:text-white">OpenPilot (or any name)</span></div>
            <div><span className="text-gray-400">Homepage URL:</span> <span className="text-gray-900 dark:text-white">http://localhost:3000</span></div>
            <div><span className="text-gray-400">Authorization callback URL:</span> <span className="text-green-600 dark:text-green-400">http://localhost:3000/api/auth/callback/github</span></div>
          </div>
          <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 rounded p-2">
            ⚠ If deploying on a custom domain, replace <Code>localhost:3000</Code> with your domain in all URLs above.
          </p>
        </Step>

        <Step n={2} title="Copy your credentials">
          <p>After creating the app, GitHub shows you:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Client ID</strong> — visible on the app page</li>
            <li><strong>Client Secret</strong> — click <em>Generate a new client secret</em></li>
          </ul>
          <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded p-2">
            🔒 Keep your Client Secret private — never commit it to version control.
          </p>
        </Step>

        <Step n={3} title="Configure the app environment">
          <p>Edit (or create) <Code>docker/docker-compose.yml</Code> and add these environment variables under the <Code>web</Code> service:</p>
          <Pre>{`environment:
  - GITHUB_ID=<your_client_id>
  - GITHUB_SECRET=<your_client_secret>
  - NEXTAUTH_SECRET=<random_32_char_string>
  - NEXTAUTH_URL=http://localhost:3000`}</Pre>
          <p>Generate a secure <Code>NEXTAUTH_SECRET</Code> with:</p>
          <Pre>{`openssl rand -base64 32`}</Pre>
        </Step>

        <Step n={4} title="Restart the app">
          <Pre>{`cd docker
docker compose down
docker compose up -d`}</Pre>
          <p>Navigate to <Code>http://localhost:3000</Code> — you should now see a <em>Sign in with GitHub</em> button.</p>
        </Step>

        <Step n={5} title="Grant Copilot access (first sign-in)">
          <p>After signing in, the app will prompt you to authorize GitHub Copilot access. Click <strong>Authorize</strong> on the GitHub consent screen.</p>
          <p>The app uses your OAuth token to call the Copilot API on your behalf — no extra credentials are stored.</p>
        </Step>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 text-sm text-blue-800 dark:text-blue-300">
        <strong>Scopes requested:</strong> <Code>read:user</Code>, <Code>user:email</Code>, <Code>read:org</Code> — the same scopes used by the official VS Code Copilot extension.
      </div>
    </div>
  );
}

function ApiUsageDocs() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Using the OpenPilot API</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          The API is OpenAI-compatible. Any client that works with the OpenAI SDK can talk to OpenPilot.
          Supports streaming, text, and image (vision) inputs.
        </p>
      </div>

      {/* Get Started card */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-5 space-y-3">
        <h3 className="text-base font-bold text-blue-900 dark:text-blue-200">🚀 Get Started in 3 steps</h3>
        <ol className="space-y-2 text-sm text-blue-800 dark:text-blue-300">
          <li className="flex gap-2"><span className="font-bold shrink-0">1.</span><span>Open the <strong>🔑 API Keys</strong> tab in the sidebar → click <em>New App Key</em> → copy the key shown once.</span></li>
          <li className="flex gap-2"><span className="font-bold shrink-0">2.</span><span>Set <Code>base_url</Code> to <Code>http://localhost:3000/v1</Code> in your OpenAI client.</span></li>
          <li className="flex gap-2"><span className="font-bold shrink-0">3.</span><span>Use your <Code>opk_...</Code> key as the API key — the model is determined by the key's configured model, not the request.</span></li>
        </ol>
        <p className="text-xs text-blue-600 dark:text-blue-400">
          The Quick Usage snippet in the API Keys tab auto-fills your key after creation.
        </p>
      </div>

      <Step n={1} title="Create an API key">
        <p>Go to <strong>API Keys</strong> in the sidebar, click <em>New App Key</em>, choose a name and model, and copy the key shown once.</p>
      </Step>

      <Step n={2} title="Set the base URL">
        <p>Point your OpenAI client at your OpenPilot instance:</p>
        <Pre>{`base_url = "http://localhost:3000/v1"
api_key  = "opk_your_key_here"`}</Pre>
      </Step>

      <Step n={3} title="Send a chat completion request">
        <p>Using <Code>curl</Code>:</p>
        <Pre>{`curl http://localhost:3000/v1/chat/completions \\
  -H "Authorization: Bearer opk_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'`}</Pre>
        <p>Using the Python OpenAI SDK:</p>
        <Pre>{`from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="opk_your_key_here",
)

response = client.chat.completions.create(
    model="gpt-4o",   # overridden by the key's configured model
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)`}</Pre>
      </Step>

      <Step n={4} title="Streaming responses">
        <p>Add <Code>"stream": true</Code> to receive tokens as they are generated (Server-Sent Events, same format as the OpenAI API).</p>
        <p>With <Code>curl</Code>:</p>
        <Pre>{`curl http://localhost:3000/v1/chat/completions \\
  -H "Authorization: Bearer opk_your_key_here" \\
  -H "Content-Type: application/json" \\
  --no-buffer \\
  -d '{
    "model": "gpt-4o",
    "stream": true,
    "messages": [
      {"role": "user", "content": "Tell me a story."}
    ]
  }'`}</Pre>
        <p>With the Python SDK:</p>
        <Pre>{`stream = client.chat.completions.create(
    model="gpt-4o",
    stream=True,
    messages=[{"role": "user", "content": "Tell me a story."}],
)
for chunk in stream:
    delta = chunk.choices[0].delta.content or ""
    print(delta, end="", flush=True)`}</Pre>
      </Step>

      <Step n={5} title="Sending images (vision)">
        <p>Pass a content array with <Code>image_url</Code> parts to send images alongside text. Both public HTTPS URLs and base64 data URIs are supported.</p>
        <p>With the Python SDK:</p>
        <Pre>{`import base64

# Option A — public URL
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "What is in this image?"},
            {"type": "image_url", "image_url": {"url": "https://example.com/photo.jpg"}},
        ],
    }],
)
print(response.choices[0].message.content)

# Option B — base64 data URI
with open("photo.jpg", "rb") as f:
    b64 = base64.b64encode(f.read()).decode()

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "Describe this image."},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
        ],
    }],
)`}</Pre>
        <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 rounded p-2">
          ⚠ Vision support depends on the model configured for your API key. Use a vision-capable model such as <Code>gpt-4o</Code> or <Code>claude-3-5-sonnet</Code>.
        </p>
      </Step>

      <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-sm text-gray-700 dark:text-gray-300 space-y-1">
        <p className="font-semibold text-gray-900 dark:text-white">Notes</p>
        <ul className="list-disc pl-5 space-y-1 text-xs">
          <li>The <Code>model</Code> field in the request is ignored — the model is set per API key in the UI.</li>
          <li>Streaming is supported via <Code>"stream": true</Code> — tokens are returned as SSE chunks.</li>
          <li>Image inputs accept HTTPS URLs or <Code>data:image/…</Code> base64 data URIs.</li>
          <li>Rate limits are determined by your GitHub Copilot subscription.</li>
        </ul>
      </div>
    </div>
  );
}

