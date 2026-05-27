import { NextResponse } from 'next/server';
import { getCopilotToken } from '@/services/copilotAuth';

const MODELS_URL = 'https://api.githubcopilot.com/models';

// Friendly display names — unknown IDs fall back to the raw id
const DISPLAY: Record<string, string> = {
  'gpt-4o':                  'GPT-4o',
  'gpt-4o-2024-05-13':       'GPT-4o (May 2024)',
  'gpt-4o-2024-08-06':       'GPT-4o (Aug 2024)',
  'gpt-4o-2024-11-20':       'GPT-4o (Nov 2024)',
  'gpt-4o-mini':             'GPT-4o Mini',
  'gpt-4o-mini-2024-07-18':  'GPT-4o Mini (Jul 2024)',
  'gpt-4.1':                 'GPT-4.1',
  'gpt-4.1-2025-04-14':      'GPT-4.1 (Apr 2025)',
  'gpt-4.1-mini':            'GPT-4.1 Mini',
  'gpt-4.1-nano':            'GPT-4.1 Nano',
  'gpt-4':                   'GPT-4',
  'gpt-4-0613':              'GPT-4 (0613)',
  'gpt-4-0125-preview':      'GPT-4 Preview',
  'gpt-4-o-preview':         'GPT-4o Preview',
  'gpt-3.5-turbo':           'GPT-3.5 Turbo',
  'gpt-3.5-turbo-0613':      'GPT-3.5 Turbo (0613)',
  'gpt-5':                   'GPT-5',
  'gpt-5-mini':              'GPT-5 Mini',
  'gpt-5.2':                 'GPT-5.2',
  'gpt-5.2-codex':           'GPT-5.2 Codex',
  'gpt-5.3-codex':           'GPT-5.3 Codex',
  'gpt-5.4':                 'GPT-5.4',
  'gpt-5.4-mini':            'GPT-5.4 Mini',
  'gpt-5.5':                 'GPT-5.5',
  'o1':                      'o1',
  'o1-mini':                 'o1 Mini',
  'o1-preview':              'o1 Preview',
  'o3-mini':                 'o3 Mini',
  'o3':                      'o3',
  'o4-mini':                 'o4 Mini',
  'claude-sonnet-4-5':       'Claude Sonnet 4.5',
  'claude-sonnet-4.5':       'Claude Sonnet 4.5',
  'claude-sonnet-4.6':       'Claude Sonnet 4.6',
  'claude-opus-4.5':         'Claude Opus 4.5',
  'claude-opus-4.7':         'Claude Opus 4.7',
  'claude-haiku-4.5':        'Claude Haiku 4.5',
  'claude-3-7-sonnet':       'Claude 3.7 Sonnet',
  'claude-3-5-sonnet':       'Claude 3.5 Sonnet',
  'gemini-2.5-pro':          'Gemini 2.5 Pro',
  'gemini-2.0-flash-001':    'Gemini 2.0 Flash',
  'gemini-3-flash-preview':  'Gemini 3 Flash Preview',
  'gemini-3.1-pro-preview':  'Gemini 3.1 Pro Preview',
  'gemini-3.5-flash':        'Gemini 3.5 Flash',
};

// IDs that are internal/routing models — hide from the selector
const HIDDEN = /^(accounts\/|trajectory-compaction|lark-secondary|lark$|oswe-)/;

// Premium-request multipliers — sourced from:
// https://docs.github.com/en/copilot/reference/ai-models/supported-models#model-multipliers
// Category fallback: powerful=10x, versatile=1x, fast=free.
const MULTIPLIERS: Record<string, number | 'free'> = {
  // 0x — included models, no premium requests consumed on paid plans
  'gpt-4o': 'free', 'gpt-4o-2024-05-13': 'free', 'gpt-4o-2024-08-06': 'free', 'gpt-4o-2024-11-20': 'free',
  'gpt-4.1': 'free', 'gpt-4.1-2025-04-14': 'free',
  'gpt-5-mini': 'free',
  'gpt-4o-mini': 'free', 'gpt-4o-mini-2024-07-18': 'free',
  'gpt-4.1-mini': 'free', 'gpt-4.1-nano': 'free',
  'gpt-3.5-turbo': 'free', 'gpt-3.5-turbo-0613': 'free',
  'gemini-2.0-flash-001': 'free',
  // 0.25x
  'gpt-5.4-nano': 0.25,
  // 0.33x
  'claude-haiku-4.5': 0.33,
  'gpt-5.4-mini': 0.33,
  'gemini-3-flash-preview': 0.33,
  // 1x
  'gpt-4': 1, 'gpt-4-0613': 1, 'gpt-4-0125-preview': 1, 'gpt-4-o-preview': 1,
  'claude-sonnet-4.5': 1, 'claude-sonnet-4.6': 1, 'claude-sonnet-4-5': 1,
  'gemini-2.5-pro': 1,
  'gemini-3.1-pro-preview': 1,
  'o1-mini': 1, 'o3-mini': 1, 'o4-mini': 1,
  'gpt-5.2': 1, 'gpt-5.2-codex': 1, 'gpt-5.3-codex': 1,
  'gpt-5.4': 1,
  // 3x
  'claude-opus-4.5': 3, 'claude-opus-4.6': 3,
  // 7.5x
  'gpt-5.5': 7.5,
  // 10x
  'claude-3-7-sonnet': 10, 'claude-3-5-sonnet': 10,
  'o1': 10, 'o3': 10,
  'gpt-5': 10,
  // 14x
  'gemini-3.5-flash': 14,
  // 15x
  'claude-opus-4.7': 15,
};

const CATEGORY_MULTIPLIER: Record<string, number | 'free'> = {
  fast: 'free', lightweight: 'free', versatile: 1, powerful: 10,
};

interface RawModel {
  id: string;
  name?: string;
  model_picker_category?: string;
  capabilities?: {
    type?: string;
    supports?: { reasoning_effort?: string[] };
  };
}

export async function GET() {
  try {
    const token = await getCopilotToken();

    const res = await fetch(MODELS_URL, {
      headers: {
        Authorization:           `Bearer ${token}`,
        'User-Agent':            'GitHubCopilotChat/0.49.0',
        'editor-version':        'vscode/1.99.0',
        'editor-plugin-version': 'copilot-chat/0.49.0',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json(
        { error: `Copilot models API ${res.status}: ${body.slice(0, 200)}` },
        { status: res.status },
      );
    }

    const raw = await res.json() as { data?: RawModel[] };

    const models = (raw.data ?? [])
      .filter(m => !HIDDEN.test(m.id))
      .filter(m => !m.capabilities?.type || m.capabilities.type === 'chat')
      .map(m => {
        const category = m.model_picker_category ?? '';
        const multiplier =
          m.id in MULTIPLIERS
            ? MULTIPLIERS[m.id]
            : CATEGORY_MULTIPLIER[category] ?? 1;
        return {
          id: m.id,
          name: DISPLAY[m.id] ?? m.name ?? m.id,
          multiplier,
          category,
          reasoningEffort: m.capabilities?.supports?.reasoning_effort ?? [],
        };
      })
      .sort((a, b) => {
        const val = (m: number | 'free') => m === 'free' ? 0 : m;
        return val(a.multiplier) - val(b.multiplier);
      });

    return NextResponse.json({ models });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}



