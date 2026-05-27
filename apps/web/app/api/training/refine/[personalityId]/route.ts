import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCopilotToken } from '@/services/copilotAuth';
import { readFileSync } from 'fs';
import { join } from 'path';

const CHAT_URL = 'https://api.githubcopilot.com/chat/completions';
const MIN_RUNS_BEFORE_REFINE = 20;
const TOP_N_GOOD = 15;
const BOTTOM_N_POOR = 8;

interface PersonalityDef {
  id: string;
  workerSystem: string;
  managerSystem: string;
}

function loadActiveSystemPrompts(personalityId: string): { workerSystem: string; managerSystem: string } | null {
  // Check DB for an active refined version first
  // (used synchronously only during the refine call — we resolve this via the async wrapper below)
  try {
    const dataPath = join(process.cwd(), 'data', 'personalities.json');
    const json = JSON.parse(readFileSync(dataPath, 'utf-8')) as Record<string, PersonalityDef>;
    const p = json[personalityId];
    if (!p) return null;
    return { workerSystem: p.workerSystem, managerSystem: p.managerSystem };
  } catch {
    return null;
  }
}

/**
 * POST /api/training/refine/[personalityId]
 *
 * Uses successful and poor run histories to meta-prompt Copilot for improved
 * system prompts. Stores a new PersonalityVersion (not yet active — requires
 * manual promotion or the auto-promote logic in the score endpoint).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ personalityId: string }> },
) {
  try {
    const { personalityId } = await params;

    // ── Guard: need minimum run count ───────────────────────────────────────
    const total = await prisma.agentRunRecord.count({
      where: { personalityId, summary: { not: null } },
    });

    if (total < MIN_RUNS_BEFORE_REFINE) {
      return NextResponse.json({
        ok: false,
        reason: `Need at least ${MIN_RUNS_BEFORE_REFINE} scored runs, have ${total}`,
      });
    }

    // ── Load base system prompts ─────────────────────────────────────────────
    // Prefer the active DB version, fall back to static file
    const activeDbVersion = await prisma.personalityVersion.findFirst({
      where: { personalityId, isActive: true },
      orderBy: { version: 'desc' },
    });

    const basePrompts = activeDbVersion
      ? { workerSystem: activeDbVersion.workerSystem, managerSystem: activeDbVersion.managerSystem }
      : loadActiveSystemPrompts(personalityId);

    if (!basePrompts) {
      return NextResponse.json({ ok: false, reason: 'Personality not found' }, { status: 404 });
    }

    // ── Gather good and poor runs ────────────────────────────────────────────
    const goodRuns = await prisma.agentRunRecord.findMany({
      where:   { personalityId, status: 'complete', summary: { not: null } },
      orderBy: { completedAt: 'desc' },
      take:    TOP_N_GOOD,
      select:  { summary: true, title: true, workerHistory: true },
    });

    const poorRuns = await prisma.agentRunRecord.findMany({
      where:   { personalityId, status: { in: ['blocked', 'error'] }, summary: { not: null } },
      orderBy: { completedAt: 'desc' },
      take:    BOTTOM_N_POOR,
      select:  { summary: true, title: true, workerHistory: true },
    });

    // ── Build meta-prompt ────────────────────────────────────────────────────
    const formatRuns = (runs: typeof goodRuns) =>
      runs.map((r, i) => {
        const s = safeJson(r.summary);
        return `Run ${i + 1}: "${r.title}" | score=${s.qualityScore ?? '?'} corrections=${s.corrections ?? '?'}`;
      }).join('\n');

    const metaPrompt = `You are an expert prompt engineer. Your task is to improve the WORKER and MANAGER system prompts for a "${personalityId}" AI agent.

CURRENT WORKER SYSTEM PROMPT:
\`\`\`
${basePrompts.workerSystem}
\`\`\`

CURRENT MANAGER SYSTEM PROMPT:
\`\`\`
${basePrompts.managerSystem}
\`\`\`

EVIDENCE FROM ${goodRuns.length} SUCCESSFUL RUNS:
${formatRuns(goodRuns)}

EVIDENCE FROM ${poorRuns.length} POOR RUNS:
${formatRuns(poorRuns)}

TASK: Analyse the patterns in the evidence. Identify what makes the successful runs work well and what causes the poor runs to fail. Then produce improved system prompts that:
1. Reinforce behaviours present in successful runs
2. Add explicit guidance to prevent the failure modes seen in poor runs
3. Keep all existing token protocol ([NEXT_TASK:], [CORRECTION:], [DONE], [COMPLETE], [BLOCKED:], [EXEC:], [SERVE:], [ANSWER:], [QUESTION:]) exactly as-is
4. Do not add new tokens or change the personality's core domain focus
5. Keep the prompts roughly the same length (±20%)

Respond ONLY with valid JSON in this exact format:
{
  "workerSystem": "<improved worker system prompt>",
  "managerSystem": "<improved manager system prompt>",
  "changesSummary": "<2-3 sentence summary of what you changed and why>"
}`;

    // ── Call Copilot API ─────────────────────────────────────────────────────
    const token = await getCopilotToken();
    const res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization:           `Bearer ${token}`,
        'Content-Type':          'application/json',
        'User-Agent':            'GitHubCopilotChat/0.49.0',
        'editor-version':        'vscode/1.99.0',
        'editor-plugin-version': 'copilot-chat/0.49.0',
        'openai-intent':         'conversation-panel',
        'copilot-integration-id':'vscode-chat',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: metaPrompt }],
        temperature: 0.3,
        top_p: 1,
        stream: false,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return NextResponse.json(
        { ok: false, reason: `Copilot API ${res.status}: ${errBody.slice(0, 200)}` },
        { status: res.status },
      );
    }

    const apiData = await res.json() as { choices: Array<{ message: { content: string } }> };
    const content = apiData.choices?.[0]?.message?.content ?? '';

    let refined: { workerSystem: string; managerSystem: string; changesSummary: string };
    try {
      refined = JSON.parse(content) as typeof refined;
    } catch {
      return NextResponse.json({ ok: false, reason: 'Copilot returned malformed JSON', raw: content.slice(0, 500) }, { status: 500 });
    }

    if (!refined.workerSystem || !refined.managerSystem) {
      return NextResponse.json({ ok: false, reason: 'Refined prompts missing required fields' }, { status: 500 });
    }

    // ── Persist new PersonalityVersion ───────────────────────────────────────
    const currentVersion = activeDbVersion?.version ?? 0;
    const newVersion = await prisma.personalityVersion.create({
      data: {
        personalityId,
        version:       currentVersion + 1,
        workerSystem:  refined.workerSystem,
        managerSystem: refined.managerSystem,
        isActive:      false,
        createdAt:     BigInt(Date.now()),
      },
    });

    return NextResponse.json({
      ok: true,
      versionId:      newVersion.id,
      version:        newVersion.version,
      changesSummary: refined.changesSummary,
    });
  } catch (err) {
    console.error('[training/refine]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

function safeJson(s: string | null): Record<string, unknown> {
  try { return JSON.parse(s ?? '{}') as Record<string, unknown>; } catch { return {}; }
}
