/**
 * =============================================================================
 * TITLE GENERATOR
 * =============================================================================
 *
 * Ported (algorithm only) from NousResearch/hermes-agent `agent/title_generator.py`.
 *
 * Generates a short, human-readable title for a conversation / brief /
 * engagement from the first meaningful content. Uses a cheap model by
 * default (Gemini Flash) so titling is effectively free.
 *
 * Pure logic lives here; the actual LLM call is injected as a
 * `generate(prompt)` callback so this module stays unit-testable without
 * mocking a provider SDK.
 *
 * @module services/model-registry/title-generator
 */

export interface GenerateFn {
  (prompt: string): Promise<string>;
}

const SYSTEM_PROMPT = `You generate titles. Output rules:
- ONE line, max 60 characters
- No surrounding quotes, no trailing punctuation
- Title Case
- Specific, not generic ("Q3 Hiring Review" not "Team Discussion")
- No emojis, no hashtags, no markdown`.trim();

function buildPrompt(source: string): string {
  const truncated = source.length > 4000 ? source.slice(0, 4000) : source;
  return `${SYSTEM_PROMPT}\n\nContent:\n${truncated}\n\nTitle:`;
}

/**
 * Clean up whatever the model produces into a single-line title.
 * Even with a strict system prompt, models sometimes return quotes or
 * trailing periods — those get stripped here.
 */
export function cleanTitle(raw: string): string {
  return raw
    .split('\n')[0]!
    .trim()
    .replace(/^["'""''`]+|["'""''`]+$/g, '')
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 60)
    .trim();
}

/**
 * Generate a title from a transcript, brief, or other document.
 * Returns a fallback when `source` is empty or the generator fails.
 */
export async function generateTitle(
  source: string,
  generate: GenerateFn,
  fallback: string = 'Untitled',
): Promise<string> {
  const trimmed = source.trim();
  if (trimmed.length === 0) return fallback;

  try {
    const raw = await generate(buildPrompt(trimmed));
    const cleaned = cleanTitle(raw);
    return cleaned.length > 0 ? cleaned : fallback;
  } catch {
    return fallback;
  }
}
