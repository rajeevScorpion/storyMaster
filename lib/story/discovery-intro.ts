const MAX_INTRO_CHARS = 160;
const MAX_STORED_INTRO_CHARS = 240;

type DiscoveryIntroBeat = {
  storyText?: unknown;
  storyTextParts?: unknown;
  sceneSummary?: unknown;
};

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Sentence split that also honours Devanagari/Arabic/CJK terminators. */
function splitSentences(text: string): string[] {
  return text
    .match(/[^.!?।؟۔。]+[.!?।؟۔。]*/gu)
    ?.map((part) => cleanText(part))
    .filter((part): part is string => Boolean(part))
    ?? [];
}

/** Trim to a length limit on a word boundary, never mid-word. */
function truncateAtBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const clipped = text.slice(0, maxChars);
  const lastSpace = clipped.lastIndexOf(' ');
  const base = (lastSpace > maxChars * 0.6 ? clipped.slice(0, lastSpace) : clipped).replace(
    /[\s,;:—-]+$/u,
    ''
  );
  return `${base}…`;
}

/**
 * Normalize an AI-written intro before it is stored: single line, no markup,
 * bounded length. Returns null when nothing usable is left.
 */
export function normalizeDiscoveryIntro(value: unknown): string | null {
  const cleaned = cleanText(value);
  if (!cleaned) return null;

  const stripped = cleaned
    .replace(/[*_`#>]/g, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();

  if (stripped.length === 0) return null;
  return truncateAtBoundary(stripped, MAX_STORED_INTRO_CHARS);
}

/**
 * Deterministic fallback intro for storylines published before the generator
 * existed (or where it failed). Derived from the opening beat that every
 * storyline row carries, so a gallery read never needs an LLM call.
 */
export function deriveDiscoveryIntro(beat: unknown): string | null {
  if (!beat || typeof beat !== 'object') return null;

  const source = beat as DiscoveryIntroBeat;
  const parts = Array.isArray(source.storyTextParts)
    ? source.storyTextParts.map(cleanText).filter((part): part is string => Boolean(part))
    : [];

  const body =
    cleanText(source.storyText)
    ?? (parts.length > 0 ? parts.join(' ') : null)
    ?? cleanText(source.sceneSummary);

  if (!body) return null;

  const sentences = splitSentences(body);
  const candidate = sentences.length > 0
    ? sentences.slice(0, 2).join(' ')
    : body;

  // One sentence already over budget reads better trimmed than a two-sentence
  // run-on that gets cut anyway.
  const preferred = candidate.length > MAX_INTRO_CHARS && sentences.length > 1
    ? sentences[0]
    : candidate;

  return truncateAtBoundary(preferred, MAX_INTRO_CHARS);
}
