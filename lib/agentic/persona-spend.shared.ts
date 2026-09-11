import { COINS_PER_BEAT } from '@/lib/types/pricing';

// ── Agentic Creator System: what each persona has spent ──────────────────
//
// Pure aggregation, kept separate from the queries that feed it so the arithmetic
// can be unit-tested. The admin page is the only consumer.
//
// Attribution runs through the story, not through the billing call. Agent stories
// carry the persona that wrote them, and every charge records the story it was for,
// so "which persona spent this" is a join rather than a new column threaded down
// through the billing layer. A charge with no story attached cannot be attributed to
// anyone, and is reported as an explicit unattributed total rather than silently
// dropped or quietly folded into some persona's number.

/** One recorded charge, already narrowed to the agentic account. */
export interface PersonaSpendRow {
  relatedStoryId: string | null;
  actionKey: string;
  beatCost: number;
  /** True when the agentic bypass meant no balance actually moved. */
  wasBypassed: boolean;
}

export interface PersonaSpendTotals {
  personaId: string;
  displayName: string;
  slug: string | null;
  status: string | null;
  beats: number;
  coins: number;
  operations: number;
  /** Beats per action key, highest first -- what the spend actually went on. */
  byAction: Array<{ actionKey: string; beats: number; operations: number }>;
  storiesCharged: number;
}

export interface PersonaSpendReport {
  personas: PersonaSpendTotals[];
  totalBeats: number;
  totalCoins: number;
  totalOperations: number;
  /** Charges whose story is missing, deleted, or not an agent story. */
  unattributedBeats: number;
  unattributedOperations: number;
  /**
   * How much of the total was never actually deducted because the billing bypass
   * was on. Shown so a reader does not mistake this report for money that left an
   * account -- it is what the agents cost, not what was collected.
   */
  bypassedBeats: number;
}

export function beatsToCoins(beats: number): number {
  return Number((beats * COINS_PER_BEAT).toFixed(2));
}

export function buildPersonaSpendReport(input: {
  rows: readonly PersonaSpendRow[];
  /** story id -> persona id, for agent-owned stories only. */
  storyPersona: ReadonlyMap<string, string>;
  personas: ReadonlyArray<{ id: string; displayName: string; slug: string | null; status: string | null }>;
}): PersonaSpendReport {
  const byPersona = new Map<string, {
    beats: number;
    operations: number;
    actions: Map<string, { beats: number; operations: number }>;
    stories: Set<string>;
  }>();

  let unattributedBeats = 0;
  let unattributedOperations = 0;
  let totalBeats = 0;
  let totalOperations = 0;
  let bypassedBeats = 0;

  for (const row of input.rows) {
    const beats = Number.isFinite(row.beatCost) ? row.beatCost : 0;
    totalBeats += beats;
    totalOperations += 1;
    if (row.wasBypassed) bypassedBeats += beats;

    const personaId = row.relatedStoryId ? input.storyPersona.get(row.relatedStoryId) : undefined;
    if (!personaId) {
      unattributedBeats += beats;
      unattributedOperations += 1;
      continue;
    }

    let entry = byPersona.get(personaId);
    if (!entry) {
      entry = { beats: 0, operations: 0, actions: new Map(), stories: new Set() };
      byPersona.set(personaId, entry);
    }
    entry.beats += beats;
    entry.operations += 1;
    if (row.relatedStoryId) entry.stories.add(row.relatedStoryId);

    const action = entry.actions.get(row.actionKey) ?? { beats: 0, operations: 0 };
    action.beats += beats;
    action.operations += 1;
    entry.actions.set(row.actionKey, action);
  }

  // Every persona appears, including ones that have spent nothing -- "this persona has
  // cost us nothing yet" is a real answer, and omitting the row makes it look missing.
  const personas: PersonaSpendTotals[] = input.personas.map((persona) => {
    const entry = byPersona.get(persona.id);
    const beats = round(entry?.beats ?? 0);
    return {
      personaId: persona.id,
      displayName: persona.displayName,
      slug: persona.slug,
      status: persona.status,
      beats,
      coins: beatsToCoins(beats),
      operations: entry?.operations ?? 0,
      storiesCharged: entry?.stories.size ?? 0,
      byAction: [...(entry?.actions ?? new Map())]
        .map(([actionKey, value]) => ({ actionKey, beats: round(value.beats), operations: value.operations }))
        .sort((a, b) => b.beats - a.beats || a.actionKey.localeCompare(b.actionKey)),
    };
  });

  // Biggest spender first; ties broken by name so the order is stable between loads.
  personas.sort((a, b) => b.beats - a.beats || a.displayName.localeCompare(b.displayName));

  return {
    personas,
    totalBeats: round(totalBeats),
    totalCoins: beatsToCoins(round(totalBeats)),
    totalOperations,
    unattributedBeats: round(unattributedBeats),
    unattributedOperations,
    bypassedBeats: round(bypassedBeats),
  };
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
