// Parsing and validation of @name character mentions in user-authored custom
// options. Names are matched against the named characters available in the
// current story context only (no global character library in Pack 1).

export interface CharacterMention {
  /** The literal mention text including the leading '@', e.g. '@Captain Barnaby'. */
  displayText: string;
  /** The matched (or attempted) character name without the '@'. */
  characterName: string;
  /** Start index of the mention (position of '@') in the source text. */
  start: number;
  /** End index (exclusive) of the mention in the source text. */
  end: number;
  valid: boolean;
}

export interface MentionParseResult {
  mentions: CharacterMention[];
  unknownMentions: string[];
}

// A single fallback token when no known name matches: letters, digits,
// underscore, hyphen (no spaces — multi-word matching only applies to known
// character names).
const FALLBACK_TOKEN = /^[\p{L}\p{N}_-]+/u;

/**
 * Parse `@name` mentions in `text`, matching against `knownNames`.
 *
 * Known names are matched case-insensitively with longest-name-first
 * priority so multi-word names ('Captain Barnaby') win over shorter
 * prefixes ('Captain'). Unmatched mentions fall back to a single token and
 * are marked invalid.
 */
export function parseCharacterMentions(text: string, knownNames: string[]): MentionParseResult {
  const mentions: CharacterMention[] = [];
  const sortedNames = [...knownNames]
    .map((name) => name.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const lowerText = text.toLowerCase();

  let index = 0;
  while (index < text.length) {
    const at = text.indexOf('@', index);
    if (at === -1) break;

    const rest = lowerText.slice(at + 1);
    let matched: string | null = null;
    for (const name of sortedNames) {
      const lowerName = name.toLowerCase();
      if (!rest.startsWith(lowerName)) continue;
      // Reject partial-word matches: '@Milo' must not match inside '@Milos'.
      const after = rest.charAt(lowerName.length);
      if (after && /[\p{L}\p{N}]/u.test(after)) continue;
      matched = name;
      break;
    }

    if (matched) {
      const end = at + 1 + matched.length;
      mentions.push({
        displayText: text.slice(at, end),
        characterName: matched,
        start: at,
        end,
        valid: true,
      });
      index = end;
      continue;
    }

    const fallback = FALLBACK_TOKEN.exec(text.slice(at + 1));
    if (fallback) {
      const end = at + 1 + fallback[0].length;
      mentions.push({
        displayText: text.slice(at, end),
        characterName: fallback[0],
        start: at,
        end,
        valid: false,
      });
      index = end;
      continue;
    }

    // Bare '@' with nothing usable after it — skip it.
    index = at + 1;
  }

  return {
    mentions,
    unknownMentions: mentions.filter((m) => !m.valid).map((m) => m.displayText),
  };
}

/**
 * For autocomplete: if the cursor sits inside/just after an `@query` being
 * typed, return the query text and where the mention starts. Returns null
 * when the cursor is not in a mention context.
 */
export function extractMentionQueryAtCursor(
  text: string,
  cursor: number
): { query: string; start: number } | null {
  const before = text.slice(0, cursor);
  const at = before.lastIndexOf('@');
  if (at === -1) return null;
  const query = before.slice(at + 1);
  // Mentions being typed may contain spaces (multi-word names) but a
  // paragraph-ish gap (two spaces or newline) ends the mention context.
  if (/\n/.test(query) || /\s{2,}/.test(query)) return null;
  if (query.length > 40) return null;
  return { query, start: at };
}
