// ── Agentic Creator: Persona Test Lab, pure half ─────────────────────────
//
// The server half (lib/agentic/test-lab.ts) needs a live Supabase client, the
// orchestrator, and paid model calls, so it cannot be unit tested in this
// repo. The one piece of this feature that can be decided without any of
// that -- composing the agent_tasks.brief text a test run is commissioned
// with -- lives here instead, deterministic and isomorphic like every other
// *.shared.ts sibling in this directory.

import type { AgentPersona } from './personas.shared';

/** Keeps a pathological operator-supplied theme from producing an unbounded brief. */
export const TEST_LAB_BRIEF_MAX_LENGTH = 2000;

/** The slice of AgentPersona buildTestLabBrief needs. Reused rather than re-declared. */
export type TestLabBriefPersona = Pick<AgentPersona, 'displayName' | 'speciality' | 'genres' | 'ageGroup' | 'language'>;

/**
 * Composes the `agent_tasks.brief` text for a Persona Test Lab run: the persona's
 * own identity (name, speciality, genres, audience, language) plus an optional
 * operator-supplied theme layered on top.
 *
 * Deterministic on purpose -- no randomness, no `Date` -- so the same persona and
 * theme always produce the same brief and this is trivially testable. `theme` is
 * trimmed and ignored entirely when blank or whitespace-only, so a test run left
 * with an empty theme field reads as "no theme requested," never as a brief
 * containing a stray blank sentence. The result is capped at
 * TEST_LAB_BRIEF_MAX_LENGTH so an operator pasting an essay into the theme field
 * cannot blow out the brief this pipeline sends to the model.
 */
export function buildTestLabBrief(persona: TestLabBriefPersona, theme?: string | null): string {
  const trimmedTheme = typeof theme === 'string' ? theme.trim() : '';

  const sentences: string[] = [
    `Persona Test Lab run for ${persona.displayName}.`,
  ];

  if (persona.speciality) {
    sentences.push(`Speciality: ${persona.speciality}.`);
  }

  if (persona.genres.length > 0) {
    sentences.push(`Preferred genres: ${persona.genres.join(', ')}.`);
  }

  sentences.push(`Write for a ${persona.ageGroup} audience in ${persona.language}.`);

  sentences.push(
    trimmedTheme
      ? `Operator-supplied theme for this test run: ${trimmedTheme}.`
      : 'No theme was supplied for this test run; choose one that best demonstrates this persona\'s range.'
  );

  return sentences.join(' ').slice(0, TEST_LAB_BRIEF_MAX_LENGTH);
}
