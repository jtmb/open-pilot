'use client';
import { useState } from 'react';

type Section =
  | 'overview'
  | 'github-oauth-browser'
  | 'github-oauth'
  | 'api-chat'
  | 'api-tools'
  | 'api-format'
  | 'api-models';

const NAV: Array<{ id: Section; label: string; group?: string }> = [
  { id: 'overview',             label: 'Overview' },
  { id: 'github-oauth-browser', label: 'GitHub OAuth (Browser)',  group: '⚙ Setup' },
  { id: 'github-oauth',         label: 'GitHub OAuth (Docker)',   group: '⚙ Setup' },
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
        <p key={`g-${item.group}`} className="mt-4 mb-0.5 px-3 text-sm font-semibold text-gray-700 dark:text-gray-300 select-none">
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
        {active === 'overview'             && <OverviewDocs />}
        {active === 'github-oauth-browser'   && <GitHubOAuthBrowserDocs />}
        {active === 'github-oauth'           && <GitHubOAuthDocs />}
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

function ParamTable({ rows }: { rows: [string, string, string, string][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-400">
            <th className="text-left pb-2 pr-3 font-semibold">Parameter</th>
            <th className="text-left pb-2 pr-3 font-semibold">Type</th>
            <th className="text-left pb-2 pr-3 font-semibold">Default</th>
            <th className="text-left pb-2 font-semibold">Description</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map(([name, type, def, desc]) => (
            <tr key={name} className="align-top">
              <td className="py-1.5 pr-3 font-mono text-blue-700 dark:text-blue-300 whitespace-nowrap">{name}</td>
              <td className="py-1.5 pr-3 text-gray-500 whitespace-nowrap">{type}</td>
              <td className="py-1.5 pr-3 text-gray-400 font-mono whitespace-nowrap">{def}</td>
              <td className="py-1.5 text-gray-600 dark:text-gray-400">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NoteBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-xs text-gray-600 dark:text-gray-400 space-y-1">
      <p className="font-semibold text-gray-900 dark:text-white text-sm mb-1">Notes</p>
      <div>{children}</div>
    </div>
  );
}

export function GitHubOAuthBrowserDocs() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">GitHub OAuth — Browser Setup</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Configure GitHub OAuth directly from the sign-in screen — no Docker restart needed.
        </p>
      </div>

      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 text-sm text-green-800 dark:text-green-300">
        <strong>Recommended for first-time setup.</strong> Credentials are saved inside the container and take effect immediately.
      </div>

      <div className="space-y-6">
        <Step n={1} title="Open the GitHub OAuth app registration page">
          <p>Visit <strong>github.com/settings/applications/new</strong> (you must be signed into GitHub).</p>
        </Step>

        <Step n={2} title="Fill in the app details">
          <p>Use these exact values:</p>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-2 text-xs font-mono">
            <div><span className="text-gray-400">Application name:</span> <span className="text-gray-900 dark:text-white">OpenPilot</span></div>
            <div><span className="text-gray-400">Homepage URL:</span> <span className="text-gray-900 dark:text-white">http://localhost:3000</span></div>
            <div><span className="text-gray-400">Authorization callback URL:</span> <span className="text-green-600 dark:text-green-400">http://localhost:3000/api/auth/callback/github</span></div>
          </div>
          <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 rounded p-2">
            ⚠ If running on a custom domain or port, replace <Code>localhost:3000</Code> with your actual host in both URLs.
          </p>
        </Step>

        <Step n={3} title="Copy your Client ID and generate a Client Secret">
          <p>After clicking <strong>Register application</strong>, GitHub shows you the <strong>Client ID</strong>. Click <em>Generate a new client secret</em> to reveal the secret.</p>
          <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded p-2">
            🔒 Copy the Client Secret immediately — GitHub will not show it again.
          </p>
        </Step>

        <Step n={4} title="Enter credentials on the sign-in screen">
          <p>Open <Code>http://localhost:3000</Code>. You will see a <strong>Connect GitHub</strong> setup screen with two fields:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>GitHub Client ID</strong> — paste the value from step 3</li>
            <li><strong>GitHub Client Secret</strong> — paste the secret from step 3</li>
          </ul>
          <p>Click <strong>Save &amp; Sign in →</strong>. The page immediately transitions to the sign-in view — no container restart required.</p>
        </Step>

        <Step n={5} title="Sign in with GitHub">
          <p>Click <strong>Sign in with GitHub</strong>. GitHub will ask you to authorize OpenPilot. After authorizing, you are redirected back and signed in.</p>
          <p>The app uses your OAuth token to call the Copilot API on your behalf — no extra credentials are stored beyond the session token.</p>
        </Step>

        <Step n={6} title="(Optional) Set an access password">
          <p>To prevent unauthorised sign-ins (e.g. after you sign out, a second person using the same browser clicking the GitHub button), set an access password:</p>
          <Pre>{`# in docker/docker-compose.yml → web → environment:
- ACCESS_PASSWORD=your_strong_password`}</Pre>
          <p>When configured, the sign-in screen requires this password before the GitHub OAuth button becomes active. The password is never stored in the browser.</p>
        </Step>
      </div>
    </div>
  );
}

export function GitHubOAuthDocs() {
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

function OverviewDocs() {
  return (
    <div className="max-w-2xl space-y-4">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">How to Use OpenPilot</h2>
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-3 text-sm text-gray-700 dark:text-gray-300">
        <ul className="list-disc pl-5 space-y-2">
          <li>Use <strong>Chat</strong> to ask questions or get help from GitHub Copilot directly.</li>
          <li>Use <strong>Auto Pilot</strong> to run fully autonomous multi-step agent tasks with a Worker + Manager loop.</li>
          <li>The <strong>Dashboard</strong> shows live stats for your runs, conversations, and API keys.</li>
          <li>Manage SQLite backups and dark mode from the profile menu at the bottom-left.</li>
          <li>Use the <strong>API Keys</strong> tab to generate keys for external app integrations.</li>
        </ul>
      </div>
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 text-sm text-blue-800 dark:text-blue-300">
        <p className="font-semibold mb-1">API Reference</p>
        <p>OpenPilot exposes an OpenAI-compatible REST API at <Code>http://localhost:3000/v1</Code>. See the API Reference sections in the left sidebar.</p>
      </div>
    </div>
  );
}

function ApiChatDocs() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Chat Completions</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          OpenAI-compatible chat endpoint. Supports streaming, vision, tool calling, and JSON mode.
        </p>
      </div>

      <div className="bg-gray-900 rounded-xl p-3 text-xs font-mono text-gray-400 flex gap-3">
        <span className="text-green-400 font-bold">POST</span>
        <span className="text-white">/v1/chat/completions</span>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-5 space-y-3">
        <h3 className="text-base font-bold text-blue-900 dark:text-blue-200">🚀 Get Started in 3 steps</h3>
        <ol className="space-y-2 text-sm text-blue-800 dark:text-blue-300">
          <li className="flex gap-2"><span className="font-bold shrink-0">1.</span><span>Open the <strong>🔑 API Keys</strong> tab → click <em>New App Key</em> → copy the key shown once.</span></li>
          <li className="flex gap-2"><span className="font-bold shrink-0">2.</span><span>Set <Code>base_url</Code> to <Code>http://localhost:3000/v1</Code> in your OpenAI client.</span></li>
          <li className="flex gap-2"><span className="font-bold shrink-0">3.</span><span>Use your <Code>opk_...</Code> key as the API key.</span></li>
        </ol>
      </div>

      <Step n={1} title="Basic request (curl)">
        <Pre>{`curl http://localhost:3000/v1/chat/completions \\
  -H "Authorization: Bearer opk_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'`}</Pre>
      </Step>

      <Step n={2} title="Python OpenAI SDK">
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

      <Step n={3} title="Streaming responses">
        <p>Add <Code>"stream": true</Code> to receive tokens as Server-Sent Events.</p>
        <Pre>{`curl http://localhost:3000/v1/chat/completions \\
  -H "Authorization: Bearer opk_your_key_here" \\
  -H "Content-Type: application/json" \\
  --no-buffer \\
  -d '{"model":"gpt-4o","stream":true,"messages":[{"role":"user","content":"Tell me a story."}]}'`}</Pre>
        <Pre>{`stream = client.chat.completions.create(
    model="gpt-4o",
    stream=True,
    messages=[{"role": "user", "content": "Tell me a story."}],
)
for chunk in stream:
    delta = chunk.choices[0].delta.content or ""
    print(delta, end="", flush=True)`}</Pre>
      </Step>

      <Step n={4} title="Vision (images)">
        <p>Pass a content array with <Code>image_url</Code> parts. Accepts HTTPS URLs and base64 data URIs.</p>
        <Pre>{`response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "What is in this image?"},
            {"type": "image_url", "image_url": {"url": "https://example.com/photo.jpg"}},
        ],
    }],
)`}</Pre>
      </Step>

      <ParamTable rows={[
        ['messages',        'array',   'required', 'Array of message objects with role and content.'],
        ['stream',          'boolean', 'false',     'Enable SSE streaming.'],
        ['temperature',     'number',  '—',         'Sampling temperature 0–2.'],
        ['top_p',           'number',  '—',         'Nucleus sampling 0–1.'],
        ['max_tokens',      'integer', '—',         'Max tokens to generate (capped at 32768).'],
        ['stop',            'string|array', '—',    'Stop sequences.'],
        ['seed',            'integer', '—',         'Reproducibility seed.'],
        ['n',               'integer', '1',         'How many completions (max 4).'],
        ['tools',           'array',   '—',         'Function definitions. See Tools & Functions.'],
        ['tool_choice',     'string|object', '—',   'Tool selection strategy.'],
        ['response_format', 'object',  '—',         'Output format. See Response Format.'],
      ]} />

      <NoteBox>
        The <Code>model</Code> field in the request is ignored — the model is set per API key in the UI.
        Rate limits are determined by your GitHub Copilot subscription.
      </NoteBox>
    </div>
  );
}

function ApiToolsDocs() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Tools &amp; Function Calling</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Provide a list of functions the model can call. The model returns a <Code>tool_calls</Code> array when it wants to invoke a tool.
        </p>
      </div>

      <div className="bg-gray-900 rounded-xl p-3 text-xs font-mono text-gray-400 flex gap-3">
        <span className="text-green-400 font-bold">POST</span>
        <span className="text-white">/v1/chat/completions</span>
        <span className="ml-auto text-gray-500">with <span className="text-yellow-300">tools</span> field</span>
      </div>

      <Step n={1} title="Define tools and send the request">
        <Pre>{`import json
from openai import OpenAI

client = OpenAI(base_url="http://localhost:3000/v1", api_key="opk_your_key_here")

tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get the current weather in a city.",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {"type": "string", "description": "City name, e.g. 'Paris'"},
                "unit":     {"type": "string", "enum": ["celsius", "fahrenheit"]},
            },
            "required": ["location"],
        },
    },
}]

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "What's the weather in Tokyo?"}],
    tools=tools,
    tool_choice="auto",
)

msg = response.choices[0].message
print(msg.tool_calls)  # model wants to call get_weather`}</Pre>
      </Step>

      <Step n={2} title="Execute the tool and continue the conversation">
        <Pre>{`# Extract the call
tool_call = msg.tool_calls[0]
args = json.loads(tool_call.function.arguments)
result = {"temperature": "18°C", "condition": "Cloudy"}  # your real logic here

# Continue with the tool result
messages = [
    {"role": "user",      "content": "What's the weather in Tokyo?"},
    msg,                                                # assistant turn with tool_calls
    {
        "role":         "tool",
        "tool_call_id": tool_call.id,
        "content":      json.dumps(result),
    },
]

final = client.chat.completions.create(
    model="gpt-4o",
    messages=messages,
)
print(final.choices[0].message.content)
# "The current weather in Tokyo is 18°C and cloudy."`}</Pre>
      </Step>

      <Step n={3} title="Controlling which tool the model uses">
        <Pre>{`# Let the model decide (default)
tool_choice = "auto"

# Force a specific tool
tool_choice = {"type": "function", "function": {"name": "get_weather"}}

# Prevent any tool calls
tool_choice = "none"

# Require some tool call (any)
tool_choice = "required"`}</Pre>
      </Step>

      <ParamTable rows={[
        ['tools',       'array',  'required', 'List of tool definitions. Max 64. Each has type "function" and a function object with name, description, parameters.'],
        ['tool_choice', 'string|object', '"auto"', '"auto" | "none" | "required" | {"type":"function","function":{"name":"…"}}'],
      ]} />

      <NoteBox>
        Tool support depends on the model configured for your API key. Most GPT-4o and Claude Sonnet variants support tool calling.
      </NoteBox>
    </div>
  );
}

function ApiFormatDocs() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Response Format (JSON Mode)</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Force the model to always return valid JSON by setting <Code>response_format</Code>.
        </p>
      </div>

      <div className="bg-gray-900 rounded-xl p-3 text-xs font-mono text-gray-400 flex gap-3">
        <span className="text-green-400 font-bold">POST</span>
        <span className="text-white">/v1/chat/completions</span>
        <span className="ml-auto text-gray-500">with <span className="text-yellow-300">response_format</span> field</span>
      </div>

      <Step n={1} title="JSON object mode">
        <p>Guarantees a parseable JSON object in the response. Always instruct the model to produce JSON in the system or user message.</p>
        <Pre>{`response = client.chat.completions.create(
    model="gpt-4o",
    response_format={"type": "json_object"},
    messages=[{
        "role": "user",
        "content": "Return a JSON object with fields: name (string) and age (integer) for a fictional person.",
    }],
)

import json
data = json.loads(response.choices[0].message.content)
print(data)  # {"name": "Alice", "age": 30}`}</Pre>
      </Step>

      <Step n={2} title="JSON schema mode (structured outputs)">
        <p>Constrain the output to a specific schema using <Code>json_schema</Code>.</p>
        <Pre>{`schema = {
    "type": "object",
    "properties": {
        "name":  {"type": "string"},
        "score": {"type": "number"},
        "tags":  {"type": "array", "items": {"type": "string"}},
    },
    "required": ["name", "score"],
    "additionalProperties": False,
}

response = client.chat.completions.create(
    model="gpt-4o",
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name":   "result",
            "strict": True,
            "schema": schema,
        },
    },
    messages=[{"role": "user", "content": "Rate the movie 'Dune' and list 3 tags."}],
)
data = json.loads(response.choices[0].message.content)
print(data)  # {"name": "Dune", "score": 9.1, "tags": ["sci-fi", "epic", "visuals"]}`}</Pre>
      </Step>

      <Step n={3} title="With curl">
        <Pre>{`curl http://localhost:3000/v1/chat/completions \\
  -H "Authorization: Bearer opk_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o",
    "response_format": {"type": "json_object"},
    "messages": [
      {"role": "user", "content": "Give me a JSON object with a random city and its population."}
    ]
  }'`}</Pre>
      </Step>

      <ParamTable rows={[
        ['response_format', 'object', '—', 'Set type to "text" (default), "json_object", or "json_schema".'],
        ['json_schema',     'object', '—', 'Required when type is "json_schema". Contains name, strict, and schema fields.'],
      ]} />

      <NoteBox>
        JSON mode support depends on the model. GPT-4o, GPT-4.1, and Claude Sonnet support both <Code>json_object</Code> and <Code>json_schema</Code>. Always tell the model to output JSON in the prompt — the format constraint does not add instructions automatically.
      </NoteBox>
    </div>
  );
}

function ApiModelsDocs() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">List Models</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Returns the available models in OpenAI-compatible format. Useful for populating model selectors in third-party tools.
        </p>
      </div>

      <div className="bg-gray-900 rounded-xl p-3 text-xs font-mono text-gray-400 flex gap-3">
        <span className="text-blue-400 font-bold">GET</span>
        <span className="text-white">/v1/models</span>
      </div>

      <Step n={1} title="Request">
        <Pre>{`curl http://localhost:3000/v1/models \\
  -H "Authorization: Bearer opk_your_key_here"`}</Pre>
      </Step>

      <Step n={2} title="Response">
        <Pre>{`{
  "object": "list",
  "data": [
    {
      "id":       "gpt-4o",
      "object":   "model",
      "created":  0,
      "owned_by": "github-copilot"
    },
    {
      "id":       "claude-sonnet-4.6",
      "object":   "model",
      "created":  0,
      "owned_by": "github-copilot"
    }
    // ... more models
  ]
}`}</Pre>
      </Step>

      <Step n={3} title="Python SDK">
        <Pre>{`models = client.models.list()
for m in models.data:
    print(m.id)`}</Pre>
      </Step>

      <NoteBox>
        The <Code>owned_by</Code> field is always <Code>github-copilot</Code>. The <Code>created</Code> field is 0 as GitHub Copilot does not expose model creation timestamps. Only chat-capable models are listed.
      </NoteBox>
    </div>
  );
}

function ApiUsageDocs() {
  return <ApiChatDocs />;
}
