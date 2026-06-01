// POST /v1/chat/completions — OpenAI-compatible chat endpoint
// Supports streaming (stream: true), plain text, and multimodal image content.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchWithCopilotToken } from '@/services/copilotAuth';
import { createHash } from 'crypto';

const CHAT_URL = 'https://api.githubcopilot.com/chat/completions';
const AUTO_MODEL_FALLBACK = process.env.COPILOT_AUTO_MODEL_FALLBACK ?? 'gpt-4o-mini';
const AUTO_MODEL_CHAIN = (process.env.COPILOT_AUTO_MODEL_CHAIN ??
  'gpt-5-mini,gpt-4.1,gpt-4o-mini,gpt-4o,gpt-4.1-mini,gpt-3.5-turbo')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const COPILOT_HEADERS = {
  'Content-Type':           'application/json',
  'User-Agent':             'GitHubCopilotChat/0.49.0',
  'editor-version':         'vscode/1.99.0',
  'editor-plugin-version':  'copilot-chat/0.49.0',
  'openai-intent':          'conversation-panel',
  'copilot-integration-id': 'vscode-chat',
};

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function shouldAutoRetry(status: number, body: string): boolean {
  if (status === 429) return true;
  if (status === 403 && /(quota|limit|billing|premium|exhausted|rate)/i.test(body)) return true;
  if (status === 400 && /(model_not_supported|requested model is not supported)/i.test(body)) return true;
  return false;
}

function uniqueModels(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of list) {
    if (!m || seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

// ── Content sanitisation ──────────────────────────────────────────────────
type TextPart     = { type: 'text'; text: string };
type ImagePart    = { type: 'image_url'; image_url: { url: string; detail?: string } };
type ContentPart  = TextPart | ImagePart;

function sanitizeContent(raw: unknown): string | ContentPart[] {
  if (typeof raw === 'string') return raw.slice(0, 100_000);
  if (!Array.isArray(raw))    return String(raw).slice(0, 100_000);

  return (raw as ContentPart[]).flatMap((part): ContentPart[] => {
    if (!part || typeof part !== 'object') return [];

    if ((part as ContentPart).type === 'image_url') {
      const ip  = part as ImagePart;
      const url = String(ip.image_url?.url ?? '');
      // Only pass through https:// and data:image/ URLs — block file:// etc.
      if (!/^(https?:\/\/|data:image\/)/.test(url)) return [];
      return [{
        type: 'image_url',
        image_url: {
          url: url.slice(0, 500_000),
          ...(ip.image_url?.detail ? { detail: String(ip.image_url.detail).slice(0, 32) } : {}),
        },
      }];
    }

    // text part (default)
    return [{ type: 'text', text: String((part as TextPart).text ?? '').slice(0, 100_000) }];
  });
}

interface ChatMessage {
  role: string;
  content: string | ContentPart[];
}

// ── Route handler ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Auth
  const authHeader = req.headers.get('authorization') ?? '';
  const rawKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!rawKey.startsWith('opk_')) {
    return NextResponse.json(
      { error: { message: 'Invalid or missing API key. Include an Authorization: Bearer opk_... header.', type: 'authentication_error', code: 'invalid_api_key' } },
      { status: 401 },
    );
  }

  let apiKey: { id: string; model: string; enabled: boolean } | null;
  try {
    apiKey = await prisma.apiKey.findUnique({
      where: { keyHash: hashKey(rawKey) },
      select: { id: true, model: true, enabled: true },
    });
  } catch {
    return NextResponse.json({ error: { message: 'Database error', type: 'server_error' } }, { status: 500 });
  }

  if (!apiKey || !apiKey.enabled) {
    return NextResponse.json(
      { error: { message: 'API key not found or disabled.', type: 'authentication_error', code: 'invalid_api_key' } },
      { status: 401 },
    );
  }

  // `auto` is an OpenPilot-facing pseudo-model for Copilot billing mode.
  // Upstream Copilot chat/completions requires a concrete model identifier.
  const upstreamModel = apiKey.model === 'auto' ? AUTO_MODEL_FALLBACK : apiKey.model;

  // Parse body
  let messages: ChatMessage[];
  let wantStream: boolean;
  let tools:          unknown[] | undefined;
  let toolChoice:     unknown   | undefined;
  let responseFormat: unknown   | undefined;
  let temperature:    number    | undefined;
  let topP:           number    | undefined;
  let maxTokens:      number    | undefined;
  let stop:           unknown   | undefined;
  let seed:           number    | undefined;
  let n:              number    | undefined;

  try {
    const body = await req.json() as {
      messages?: unknown[];
      stream?: boolean;
      tools?: unknown[];
      tool_choice?: unknown;
      response_format?: unknown;
      temperature?: number;
      top_p?: number;
      max_tokens?: number;
      stop?: unknown;
      seed?: number;
      n?: number;
    };
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json(
        { error: { message: 'messages array is required', type: 'invalid_request_error' } },
        { status: 400 },
      );
    }
    wantStream = body.stream === true;
    messages = body.messages.map(m => {
      const msg = m as { role?: unknown; content?: unknown };
      return {
        role:    String(msg.role ?? 'user').slice(0, 32),
        content: sanitizeContent(msg.content),
      };
    });

    if (Array.isArray(body.tools) && body.tools.length > 0) {
      // Limit to 64 tools; each forwarded as-is to Copilot
      tools = body.tools.slice(0, 64);
    }
    if (body.tool_choice !== undefined)     toolChoice     = body.tool_choice;
    if (body.response_format !== undefined) responseFormat = body.response_format;
    if (typeof body.temperature === 'number') temperature = Math.max(0, Math.min(2, body.temperature));
    if (typeof body.top_p === 'number')       topP        = Math.max(0, Math.min(1, body.top_p));
    if (typeof body.max_tokens === 'number')  maxTokens   = Math.min(Math.max(1, body.max_tokens), 32768);
    if (body.stop !== undefined)  stop = body.stop;
    if (typeof body.seed === 'number') seed = body.seed;
    if (typeof body.n === 'number')    n    = Math.min(Math.max(1, body.n), 4);
  } catch {
    return NextResponse.json(
      { error: { message: 'Invalid JSON body', type: 'invalid_request_error' } },
      { status: 400 },
    );
  }

  const copilotBody: Record<string, unknown> = {
    model:    upstreamModel,
    messages,
    stream:   wantStream,
    ...(tools          !== undefined && { tools }),
    ...(toolChoice     !== undefined && { tool_choice: toolChoice }),
    ...(responseFormat !== undefined && { response_format: responseFormat }),
    ...(temperature    !== undefined && { temperature }),
    ...(topP           !== undefined && { top_p: topP }),
    ...(maxTokens      !== undefined && { max_tokens: maxTokens }),
    ...(stop           !== undefined && { stop }),
    ...(seed           !== undefined && { seed }),
    ...(n              !== undefined && { n }),
  };

  // Update lastUsedAt + increment usageCount fire-and-forget
  prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: BigInt(Date.now()), usageCount: { increment: 1 } } }).catch(() => {});

  // ── Streaming ─────────────────────────────────────────────────────────────
  if (wantStream) {
    let upstream: Response | null = null;
    let upstreamErrStatus = 500;
    let upstreamErrText = '';
    const candidates = apiKey.model === 'auto'
      ? uniqueModels([upstreamModel, ...AUTO_MODEL_CHAIN])
      : [upstreamModel];

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      try {
        upstream = await fetchWithCopilotToken(CHAT_URL, (t) => ({
          method:  'POST',
          headers: { Authorization: `Bearer ${t}`, ...COPILOT_HEADERS },
          body:    JSON.stringify({ ...copilotBody, model: candidate }),
          signal:  AbortSignal.timeout(120_000),
        }));
      } catch (err) {
        return NextResponse.json(
          { error: { message: (err as Error).message, type: 'server_error' } },
          { status: 500 },
        );
      }

      if (upstream.ok && upstream.body) break;
      upstreamErrStatus = upstream.status;
      upstreamErrText = await upstream.text();
      if (apiKey.model !== 'auto' || !shouldAutoRetry(upstream.status, upstreamErrText) || i === candidates.length - 1) {
        upstream = null;
        break;
      }
    }

    if (!upstream || !upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: { message: `Upstream error ${upstreamErrStatus}: ${upstreamErrText.slice(0, 200)}`, type: 'server_error' } },
        { status: upstreamErrStatus },
      );
    }

    // Proxy the SSE byte stream directly to the caller
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type':      'text/event-stream; charset=utf-8',
        'Cache-Control':     'no-cache, no-transform',
        'Connection':        'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  // ── Non-streaming ─────────────────────────────────────────────────────────
  try {
    let res: Response | null = null;
    let errStatus = 500;
    let errText = '';
    const candidates = apiKey.model === 'auto'
      ? uniqueModels([upstreamModel, ...AUTO_MODEL_CHAIN])
      : [upstreamModel];

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      res = await fetchWithCopilotToken(CHAT_URL, (t) => ({
        method:  'POST',
        headers: { Authorization: `Bearer ${t}`, ...COPILOT_HEADERS },
        body:    JSON.stringify({ ...copilotBody, model: candidate }),
        signal:  AbortSignal.timeout(120_000),
      }));
      if (res.ok) break;
      errStatus = res.status;
      errText = await res.text();
      if (apiKey.model !== 'auto' || !shouldAutoRetry(res.status, errText) || i === candidates.length - 1) {
        res = null;
        break;
      }
    }

    if (!res || !res.ok) {
      return NextResponse.json(
        { error: { message: `Upstream error ${errStatus}: ${errText.slice(0, 200)}`, type: 'server_error' } },
        { status: errStatus },
      );
    }

    // Proxy the full Copilot response, overriding model to match the key's setting
    const data = await res.json() as Record<string, unknown>;
    return NextResponse.json({ ...data, model: apiKey.model });
  } catch (err) {
    return NextResponse.json(
      { error: { message: (err as Error).message, type: 'server_error' } },
      { status: 500 },
    );
  }
}
