// GET /v1/models — OpenAI-compatible model list, authenticated with opk_ API key
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchWithCopilotToken } from '@/services/copilotAuth';
import { createHash } from 'crypto';

const MODELS_URL = 'https://api.githubcopilot.com/models';
const HIDDEN = /^(accounts\/|trajectory-compaction|lark-secondary|lark$|oswe-)/;

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

interface RawModel {
  id: string;
  name?: string;
  model_picker_category?: string;
  capabilities?: { type?: string };
}

export async function GET(req: NextRequest) {
  // Auth
  const authHeader = req.headers.get('authorization') ?? '';
  const rawKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!rawKey.startsWith('opk_')) {
    return NextResponse.json(
      { error: { message: 'Invalid or missing API key.', type: 'authentication_error', code: 'invalid_api_key' } },
      { status: 401 },
    );
  }

  let valid = false;
  try {
    const key = await prisma.apiKey.findUnique({
      where: { keyHash: hashKey(rawKey) },
      select: { enabled: true },
    });
    valid = key?.enabled === true;
  } catch {
    return NextResponse.json({ error: { message: 'Database error', type: 'server_error' } }, { status: 500 });
  }

  if (!valid) {
    return NextResponse.json(
      { error: { message: 'API key not found or disabled.', type: 'authentication_error', code: 'invalid_api_key' } },
      { status: 401 },
    );
  }

  let res: Response;
  try {
    res = await fetchWithCopilotToken(MODELS_URL, (token) => ({
      headers: {
        Authorization:           `Bearer ${token}`,
        'User-Agent':            'GitHubCopilotChat/0.49.0',
        'editor-version':        'vscode/1.99.0',
        'editor-plugin-version': 'copilot-chat/0.49.0',
      },
      signal: AbortSignal.timeout(10_000),
    }));
  } catch (err) {
    return NextResponse.json(
      { error: { message: (err as Error).message, type: 'server_error' } },
      { status: 500 },
    );
  }

  if (!res.ok) {
    const body = await res.text();
    return NextResponse.json(
      { error: { message: `Upstream error ${res.status}: ${body.slice(0, 200)}`, type: 'server_error' } },
      { status: res.status },
    );
  }

  const raw = await res.json() as { data?: RawModel[] };

  const data = (raw.data ?? [])
    .filter(m => !HIDDEN.test(m.id))
    .filter(m => !m.capabilities?.type || m.capabilities.type === 'chat')
    .map(m => ({
      id:       m.id,
      object:   'model',
      created:  0,
      owned_by: 'github-copilot',
    }));

  return NextResponse.json({ object: 'list', data });
}
