// English-detection helper for the image composer's language rule (Unit 3):
// every string value the composer returns must be English, translated from the
// story's own language, except a character's canonical name which may stay in
// its native script. `ignore` lets a caller carve those canonical names out of a
// description before judging whether the rest of it is English.
//
// Pure and isomorphic on purpose -- lib/ai/storyboard-plan.shared.ts calls this
// for every string field in a composer plan, both on the server and (via the
// browser story-store path) in the client bundle.

/** Escapes a string for literal use inside a RegExp source. No lookbehind is used
 * anywhere in this module -- it must keep working in older browsers. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface IsEnglishTextOptions {
  /** Strings to strip out (case-insensitive, every occurrence) before judging the
   * remaining text -- typically the story's own canonical character names, which
   * may legitimately stay in a non-Latin script inside an otherwise-English string. */
  ignore?: string[];
}

/**
 * True when `text` reads as English: at least 90% of its Unicode letters are
 * Latin-script. Text with no letters at all (numbers, punctuation, empty string)
 * is vacuously English. `ignore` entries are removed first so a Devanagari
 * character name embedded in an English sentence does not fail the check.
 */
export function isEnglishText(text: string, options?: IsEnglishTextOptions): boolean {
  let normalized = text.normalize('NFC');

  const ignoreEntries = (options?.ignore ?? [])
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.normalize('NFC'));

  for (const entry of ignoreEntries) {
    const pattern = new RegExp(escapeForRegExp(entry), 'giu');
    normalized = normalized.replace(pattern, '');
  }

  const letters = normalized.match(/\p{L}/gu);
  if (!letters || letters.length === 0) return true;

  const latinLetters = normalized.match(/\p{Script=Latin}/gu) ?? [];
  return latinLetters.length / letters.length >= 0.9;
}
