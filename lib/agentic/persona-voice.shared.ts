import type { AgentPersona } from './personas.shared';
import type { NarrationGenderBucket } from '@/lib/ai/narration-voices';

// ── Agentic Creator System: a persona's narration voice, pure half ─────
//
// No `server-only`, no `'use client'`, no Supabase, no network -- everything
// here is deterministic and operates on plain data the caller already has.
// `lib/ai/narration-voice-settings.ts` (which IS `server-only`) is where the
// live male/female voice lists actually come from (feature flags, defaulting
// to DEFAULT_MALE_NARRATION_VOICES / DEFAULT_FEMALE_NARRATION_VOICES in
// lib/ai/narration-voices.ts); this module never reads a flag or touches the
// database, it only reasons about the lists once a caller has fetched them.
//
// PHASE 8 DECISION THIS MODULE IMPLEMENTS: one persona has one fixed
// narration voice, chosen from exactly the voices the consumer "advanced
// settings" picker exposes. `agent_personas.preferred_voice` (migration 103)
// has carried a value since the 104 seed, but until this unit nothing in the
// codebase read it -- every persona's narration silently fell back to
// automatic, model-chosen voice selection regardless of what the column said.
// `resolvePersonaVoice` is the one place that column gets turned into an
// actual voice id, and it is written so that an UNSET voice STAYS unset --
// see its docstring for why inventing a default here would be the exact bug
// this unit exists to close.
//
// WHY UNIQUENESS IS DELIBERATELY NOT ENFORCED. There are 15 seed personas and
// only 12 exposed voices (6 male + 6 female from lib/ai/narration-voices.ts).
// Enforcing "no two personas may share a voice" is arithmetically impossible
// to satisfy for at least 3 of them, which would make those personas
// unsavable in the admin editor. So `approved_voice_pool` -- the older
// per-persona shortlist concept -- is being retired unread rather than
// replaced with a stricter rule; the column stays in the schema (other rows
// still populate it, and dropping a column is a separate, unrelated
// migration) but nothing here consults it.
//
// THE ONE CASE WORTH FLAGGING: SAME-LANGUAGE SHARING. Two personas sharing a
// voice is normal and expected given 15-into-12. It only actually matters
// when both personas write in the SAME language, because then a listener
// hears the identical voice narrate two different "authors" back to back.
// Two personas sharing a voice across different languages never collide in
// a listener's ear -- a Hindi persona and an English persona never narrate
// side by side in the same language. `buildPersonaVoiceOptions` below names
// every sharer either way (so an admin always has the full picture) but only
// calls out the same-language case distinctly; cross-language sharing is
// informational, not a warning.

/** The two voice lists the consumer "advanced settings" picker exposes, resolved by the caller (server-side) from feature flags. */
export interface PersonaVoiceLists {
  maleVoiceList: string[];
  femaleVoiceList: string[];
}

/** A dropdown option shape structurally compatible with FilterDropdownOption (components/ui/FilterDropdown.tsx), defined locally so this module stays free of any 'use client' import. */
export interface PersonaVoiceOption {
  value: string;
  label: string;
  hint?: string;
}

type PersonaVoiceGenderBucket = NarrationGenderBucket | null;

export interface ResolvedPersonaVoice {
  voiceId: string;
  genderBucket: PersonaVoiceGenderBucket;
}

/**
 * Resolves a persona's fixed narration voice against the current voice lists.
 *
 * Returns `null` when `preferredVoice` is null, empty, or whitespace-only --
 * and that is the end of it. This function MUST NEVER fall back to a list
 * default for an unset voice: an unset `preferred_voice` has to stay legible
 * as "this persona has no fixed voice yet" so a caller can record that fact
 * (and narration can fall back to automatic selection, visibly), rather than
 * silently inventing a voice that was never actually configured. Silently
 * inventing one is precisely the bug Phase 8 exists to fix -- the column has
 * held real values since migration 104 while every code path ignored it.
 *
 * Matching is case-sensitive first (the lists and the Gemini TTS provider are
 * both case-sensitive), because that is the common case and it is cheap to
 * check. When an exact match fails, it falls back to a case-insensitive
 * match and returns the CANONICAL casing from the list as `voiceId` -- so a
 * value that drifted case (e.g. a hand-edited row reading "leda") still
 * resolves to a name the TTS provider will actually accept.
 *
 * `genderBucket` is derived from which list currently contains the voice.
 * It is `null` when the (trimmed) voice matches neither list even
 * case-insensitively -- a value configured before the exposed lists changed.
 * In that case `voiceId` is returned as the trimmed original text verbatim,
 * since there is no canonical casing to recover it from.
 */
export function resolvePersonaVoice(
  persona: Pick<AgentPersona, 'preferredVoice'>,
  lists: PersonaVoiceLists
): ResolvedPersonaVoice | null {
  const trimmed = persona.preferredVoice?.trim();
  if (!trimmed) return null;

  if (lists.maleVoiceList.includes(trimmed)) {
    return { voiceId: trimmed, genderBucket: 'male' };
  }
  if (lists.femaleVoiceList.includes(trimmed)) {
    return { voiceId: trimmed, genderBucket: 'female' };
  }

  const lower = trimmed.toLowerCase();
  const maleMatch = lists.maleVoiceList.find((voice) => voice.toLowerCase() === lower);
  if (maleMatch) {
    return { voiceId: maleMatch, genderBucket: 'male' };
  }
  const femaleMatch = lists.femaleVoiceList.find((voice) => voice.toLowerCase() === lower);
  if (femaleMatch) {
    return { voiceId: femaleMatch, genderBucket: 'female' };
  }

  return { voiceId: trimmed, genderBucket: null };
}

export interface PersonaVoiceSharer {
  slug: string;
  language: string;
}

/**
 * Groups every persona's fixed voice into "who else uses this voice", for the
 * admin editor's dropdown hints. Personas with no voice set are omitted --
 * there is nothing to group them under.
 *
 * Keyed by the LOWERCASED trimmed voice id, not by whatever casing happened
 * to be stored, so that casing variants of the same voice (e.g. "Leda" and a
 * hand-edited "leda") group under one entry instead of silently splitting
 * into two. This function has no access to the voice lists (it only takes
 * personas), so it cannot recover a canonical display casing the way
 * `resolvePersonaVoice` can -- callers that need to look a voice up by its
 * canonical list casing (e.g. `buildPersonaVoiceOptions`) do so by
 * lowercasing their own lookup key before calling `.get()`.
 */
export function buildPersonaVoiceUsage(
  personas: Array<Pick<AgentPersona, 'slug' | 'language' | 'preferredVoice'>>
): Map<string, PersonaVoiceSharer[]> {
  const usage = new Map<string, PersonaVoiceSharer[]>();

  for (const persona of personas) {
    const trimmed = persona.preferredVoice?.trim();
    if (!trimmed) continue;

    const key = trimmed.toLowerCase();
    const entry: PersonaVoiceSharer = { slug: persona.slug, language: persona.language };
    const existing = usage.get(key);
    if (existing) {
      existing.push(entry);
    } else {
      usage.set(key, [entry]);
    }
  }

  return usage;
}

function describeSharer(sharer: PersonaVoiceSharer): string {
  return `${sharer.slug} (${sharer.language})`;
}

/**
 * Builds the hint line for one list voice: its gender bucket, plus -- when
 * other personas already use it -- who they are. Same-language sharers are
 * called out distinctly ("will sound identical") because that is the only
 * sharing pattern that actually matters to a listener; cross-language
 * sharers are named too, but phrased as plain information, never a warning.
 */
function buildVoiceHint(
  genderBucket: NarrationGenderBucket,
  sharers: PersonaVoiceSharer[],
  currentSlug: string,
  currentLanguage: string
): string {
  const bucketLabel = genderBucket === 'male' ? 'Male voice' : 'Female voice';
  const others = sharers.filter((sharer) => sharer.slug !== currentSlug);
  if (others.length === 0) return bucketLabel;

  const sameLanguage = others.filter((sharer) => sharer.language === currentLanguage);
  const crossLanguage = others.filter((sharer) => sharer.language !== currentLanguage);

  const segments = [bucketLabel];
  if (sameLanguage.length > 0) {
    segments.push(
      `Same language as ${sameLanguage.map(describeSharer).join(', ')} -- narration will sound identical`
    );
  }
  if (crossLanguage.length > 0) {
    segments.push(`Also used by ${crossLanguage.map(describeSharer).join(', ')}`);
  }
  return segments.join('. ');
}

export interface BuildPersonaVoiceOptionsArgs {
  lists: PersonaVoiceLists;
  /** The persona's own raw stored value, so a value that has fallen out of both lists is never silently dropped from the dropdown. */
  storedVoice: string | null | undefined;
  /** Usage across every persona, from buildPersonaVoiceUsage -- pass the full roster, including the persona being edited; it is excluded from its own sharer list by currentSlug. */
  usage: Map<string, PersonaVoiceSharer[]>;
  currentSlug: string;
  currentLanguage: string;
}

/**
 * Builds the full option list for the persona editor's voice dropdown:
 *
 * 1. An unset option (`value: ''`) first, whose label spells out the
 *    consequence of leaving it unset -- automatic, model-chosen voice
 *    selection -- rather than just naming the absence.
 * 2. Every male voice, then every female voice, each labeled by its id and
 *    hinted with its gender bucket plus any other personas already using it.
 * 3. When `storedVoice` is set but matches neither list (case-insensitively),
 *    one trailing option for it, so the editor never silently blanks a
 *    stored value it no longer recognizes.
 *
 * This never blocks a selection and never enforces uniqueness -- see the
 * file header for why 15-into-12 makes that the only workable rule.
 */
export function buildPersonaVoiceOptions({
  lists,
  storedVoice,
  usage,
  currentSlug,
  currentLanguage,
}: BuildPersonaVoiceOptionsArgs): PersonaVoiceOption[] {
  const options: PersonaVoiceOption[] = [
    {
      value: '',
      label: 'No fixed voice',
      hint: 'Narration falls back to automatic, model-chosen voice selection for every beat.',
    },
  ];

  const appendListVoice = (voiceId: string, genderBucket: NarrationGenderBucket) => {
    const sharers = usage.get(voiceId.toLowerCase()) ?? [];
    options.push({
      value: voiceId,
      label: voiceId,
      hint: buildVoiceHint(genderBucket, sharers, currentSlug, currentLanguage),
    });
  };

  for (const voiceId of lists.maleVoiceList) appendListVoice(voiceId, 'male');
  for (const voiceId of lists.femaleVoiceList) appendListVoice(voiceId, 'female');

  const resolvedStored = resolvePersonaVoice({ preferredVoice: storedVoice ?? null }, lists);
  if (resolvedStored && resolvedStored.genderBucket === null) {
    options.push({
      value: resolvedStored.voiceId,
      label: resolvedStored.voiceId,
      hint: 'Not in the current voice list -- kept from an earlier configuration.',
    });
  }

  return options;
}
