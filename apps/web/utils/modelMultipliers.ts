/**
 * Premium-request multipliers for GitHub Copilot models.
 * Sourced from: https://docs.github.com/en/copilot/reference/ai-models/supported-models#model-multipliers
 * Category fallback: powerful=10x, versatile=1x, fast/lightweight=free.
 *
 * Shared between the API route (server) and the billing UI (client) so both
 * use the same data — the live /api/models response is used when available;
 * this map is the static fallback.
 */
export const MODEL_MULTIPLIERS: Record<string, number | 'free'> = {
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

export const CATEGORY_MULTIPLIER: Record<string, number | 'free'> = {
  fast: 'free', lightweight: 'free', versatile: 1, powerful: 10,
};
