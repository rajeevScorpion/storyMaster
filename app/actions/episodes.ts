'use server';

// Pack 2 episodic-continuity server actions: preparing a Continue-as-Episode
// seed (branch + bible + journal + carried characters), recording a started
// episode, episode navigation links, and series bible read/edit. All actions
// verify story ownership and enforce feature flags server-side.

import { GoogleGenAI } from '@google/genai';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFeatureFlag, getModelConfig } from '@/lib/ai/model-config';
import { getPublishedPrompt } from '@/lib/ai/prompt-config';
import { resolvePromptTemplate, LOCKED_PROMPT_GUARDRAILS } from '@/lib/ai/prompt-config.shared';
import { storyBibleGenerationSchema } from '@/lib/ai/generation-schemas';
import { buildEpisodeConfig, getEpisodeAuthoringDefaults } from '@/lib/episodes/continuity';
import { normalizeStoryConfig } from '@/lib/ai/story-config';
import { signCharacterRosterReferenceSheetUrls } from '@/lib/media/storage-url-signing';
import { collectNamedCharactersForNode, getBeatsToNode } from '@/lib/utils/story-map';
import type {
  EpisodeContinuationSeed,
  EpisodeJournalEvent,
  EpisodeNavigation,
  SeriesBible,
} from '@/lib/types/episodes';
import type { DbEpisodeBranch, DbEpisodeJournalEvent, DbStoryBible } from '@/lib/types/database';
import type { Character, StoryConfig, StoryMap } from '@/lib/types/story';

const BIBLE_TEXT_MAX_CHARS = 6000;
const JOURNAL_SUMMARY_EVENT_LIMIT = 5;
const STORY_DIGEST_BEAT_TEXT_CHARS = 400;

class EpisodesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EpisodesError';
  }
}

async function requireFeature(flagKey: string, label: string): Promise<void> {
  if (!(await getFeatureFlag(flagKey, false))) {
    throw new EpisodesError(`${label} is currently disabled.`);
  }
}

interface OwnedEpisodeStory {
  userId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
  story: {
    id: string;
    title: string;
    story_map: StoryMap;
    characters: Character[] | null;
    story_config: Record<string, unknown> | null;
    episode_branch_id: string | null;
    episode_number: number | null;
  };
}

async function requireOwnedStory(storyId: string): Promise<OwnedEpisodeStory> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new EpisodesError('Not authenticated.');

  const { data: story, error } = await supabase
    .from('stories')
    .select('id, title, story_map, characters, story_config, episode_branch_id, episode_number')
    .eq('id', storyId)
    .eq('user_id', user.id)
    .single();
  if (error || !story?.story_map) throw new EpisodesError('Story not found.');

  return {
    userId: user.id,
    supabase,
    story: story as OwnedEpisodeStory['story'],
  };
}

function rowToBible(row: DbStoryBible): SeriesBible {
  return {
    id: row.id,
    branchId: row.branch_id,
    title: row.title,
    bibleText: row.bible_text,
    configSnapshot: row.config_snapshot && Object.keys(row.config_snapshot).length > 0
      ? normalizeStoryConfig(row.config_snapshot)
      : null,
    generatedModelId: row.generated_model_id,
    lastGeneratedAt: row.last_generated_at,
    lastEditedAt: row.last_edited_at,
  };
}

function rowToJournalEvent(row: DbEpisodeJournalEvent): EpisodeJournalEvent {
  return {
    id: row.id,
    branchId: row.branch_id,
    storyId: row.story_id,
    eventType: row.event_type as EpisodeJournalEvent['eventType'],
    summary: row.summary,
    payload: row.payload ?? {},
    sequenceNo: row.sequence_no,
    createdAt: row.created_at,
  };
}

// ── Bible + journal generation (Story Bible Writer) ─────────────────

interface GeneratedBible {
  title: string;
  bibleText: string;
  episodeSummary: string;
  modelId: string;
}

function formatBibleText(parsed: {
  title?: string;
  worldSummary?: string;
  toneRules?: string;
  styleRules?: string;
  characterRules?: string[];
  relationshipRules?: string[];
  settingRules?: string[];
  openThreads?: string[];
}): string {
  const section = (heading: string, body: string | undefined | null) =>
    body?.trim() ? `${heading}\n${body.trim()}` : null;
  const listSection = (heading: string, items: string[] | undefined | null) =>
    items?.length ? `${heading}\n${items.map((item) => `- ${item}`).join('\n')}` : null;

  return [
    section('WORLD', parsed.worldSummary),
    section('TONE', parsed.toneRules),
    section('STYLE', parsed.styleRules),
    listSection('CHARACTERS', parsed.characterRules),
    listSection('RELATIONSHIPS', parsed.relationshipRules),
    listSection('SETTING', parsed.settingRules),
    listSection('OPEN THREADS', parsed.openThreads),
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, BIBLE_TEXT_MAX_CHARS);
}

async function generateSeriesBibleAndSummary(input: {
  language: string;
  storyConfig: StoryConfig;
  storyDigest: string;
  characters: Character[];
  previousBibleText: string;
  previousJournal: string;
  episodeNumber: number;
}): Promise<GeneratedBible | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    const [promptBody, { model, temperature }] = await Promise.all([
      getPublishedPrompt('story_bible_generation'),
      getModelConfig('story_bible_generation'),
    ]);

    const prompt = resolvePromptTemplate(promptBody, {
      language: input.language,
      storyConfig: JSON.stringify({
        ageGroup: input.storyConfig.ageGroup,
        language: input.storyConfig.language,
        settingCountry: input.storyConfig.settingCountry,
        visualSettings: input.storyConfig.visualSettings,
      }),
      storyDigest: input.storyDigest,
      characters: JSON.stringify(
        input.characters.map((character) => ({
          name: character.name,
          type: character.type,
          appearanceSummary: character.appearanceSummary,
          personalitySummary: character.personalitySummary,
        }))
      ),
      previousBible: input.previousBibleText,
      previousJournal: input.previousJournal,
      episodeNumber: String(input.episodeNumber),
    });

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: LOCKED_PROMPT_GUARDRAILS.story_bible_generation,
        responseMimeType: 'application/json',
        responseSchema: storyBibleGenerationSchema,
        temperature: temperature ?? 0.35,
      },
    });
    if (!response.text) return null;
    const parsed = JSON.parse(response.text) as Parameters<typeof formatBibleText>[0] & {
      episodeSummary?: string;
    };
    const bibleText = formatBibleText(parsed);
    if (!bibleText || !parsed.episodeSummary?.trim()) return null;
    return {
      title: parsed.title?.trim() || '',
      bibleText,
      episodeSummary: parsed.episodeSummary.trim(),
      modelId: model,
    };
  } catch (error) {
    console.error('Series bible generation failed:', error);
    return null;
  }
}

function buildStoryDigest(storyMap: StoryMap, endingNodeId: string): string {
  const beats = getBeatsToNode(storyMap, endingNodeId);
  return beats
    .map((beat, index) => {
      const summary = beat.sceneSummary?.trim() || beat.storyText.slice(0, STORY_DIGEST_BEAT_TEXT_CHARS);
      const ending = beat.isEnding ? ' (ending)' : '';
      return `Beat ${index + 1} — ${beat.title}${ending}: ${summary}`;
    })
    .join('\n');
}

function buildJournalSummary(events: EpisodeJournalEvent[]): string {
  const summaries = events
    .filter((event) => event.eventType === 'episode_summary' && event.summary.trim())
    .slice(0, JOURNAL_SUMMARY_EVENT_LIMIT)
    .reverse();
  return summaries
    .map((event) => {
      const episodeNumber = typeof event.payload.episodeNumber === 'number' ? event.payload.episodeNumber : null;
      return episodeNumber ? `Episode ${episodeNumber}: ${event.summary}` : event.summary;
    })
    .join('\n\n');
}

// ── Continue as Episode ─────────────────────────────────────────────

export async function prepareEpisodeContinuation(input: {
  storyId: string;
  nodeId: string;
}): Promise<EpisodeContinuationSeed> {
  await requireFeature('episodes_enabled', 'Episodes');
  const { userId, supabase, story } = await requireOwnedStory(input.storyId);
  const admin = createAdminClient();

  const endingNode = story.story_map.nodes[input.nodeId];
  if (!endingNode) throw new EpisodesError('Beat not found in this story.');
  if (!endingNode.data.isEnding) {
    throw new EpisodesError('Episodes can only be continued from a finished story ending.');
  }

  const parentConfig = normalizeStoryConfig(story.story_config ?? undefined);
  const parentEpisodeNumber = story.episode_number ?? 1;

  // 1. Branch: attach to the existing one or create it (server-orchestrated).
  let branch: DbEpisodeBranch;
  if (story.episode_branch_id) {
    const { data, error } = await admin
      .from('episode_branches')
      .select('*')
      .eq('id', story.episode_branch_id)
      .single();
    if (error || !data) throw new EpisodesError('Episode series not found.');
    branch = data as DbEpisodeBranch;
  } else {
    const { data, error } = await admin
      .from('episode_branches')
      .insert({
        user_id: userId,
        root_story_id: story.id,
        branch_name: story.title,
        latest_story_id: story.id,
        latest_episode_number: 1,
      })
      .select('*')
      .single();
    if (error || !data) throw new EpisodesError('Could not create the episode series.');
    branch = data as DbEpisodeBranch;
    // Backfill the origin story as episode 1 of the new branch.
    await admin
      .from('stories')
      .update({ episode_branch_id: branch.id, episode_number: 1 })
      .eq('id', story.id);
  }

  // 2. Carried characters: everything named on the ending path, freshest
  //    roster visuals winning, stamped with their origin.
  const pathCharacters = collectNamedCharactersForNode(story.story_map, input.nodeId);
  const rosterById = new Map((story.characters ?? []).map((character) => [character.id, character]));
  const nowIso = new Date().toISOString();
  const carried = pathCharacters.map((character) => {
    const roster = rosterById.get(character.id);
    const merged: Character = {
      ...character,
      ...(roster?.portraitUrl ? { portraitUrl: roster.portraitUrl } : {}),
      ...(roster?.referenceSheetUrl
        ? {
            referenceSheetUrl: roster.referenceSheetUrl,
            ...(roster.referenceSheetStorageKey
              ? { referenceSheetStorageKey: roster.referenceSheetStorageKey }
              : {}),
          }
        : {}),
      ...(roster?.masterId ? { masterId: roster.masterId } : {}),
      sourceStoryId: character.sourceStoryId ?? story.id,
      importedAt: nowIso,
    };
    delete merged.portraitBase64;
    delete merged.referenceSheetGallery;
    return merged;
  });

  // 3. Journal context (existing events, before this episode's summary).
  const journalEnabled = await getFeatureFlag('episode_journal_enabled', false);
  let journalEvents: EpisodeJournalEvent[] = [];
  if (journalEnabled) {
    const { data } = await admin
      .from('episode_journal_events')
      .select('*')
      .eq('branch_id', branch.id)
      .order('sequence_no', { ascending: false })
      .limit(25);
    journalEvents = ((data ?? []) as DbEpisodeJournalEvent[]).map(rowToJournalEvent);
  }
  const hasSummaryForStory = journalEvents.some(
    (event) => event.eventType === 'episode_summary' && event.storyId === story.id
  );

  // 4. Bible: load existing, generate/update via the Story Bible Writer once
  //    per completed story (re-opening the dialog reuses the stored result).
  const bibleEnabled = await getFeatureFlag('story_bible_enabled', false);
  let bible: SeriesBible | null = null;
  if (bibleEnabled) {
    const { data: bibleRow } = await admin
      .from('story_bibles')
      .select('*')
      .eq('branch_id', branch.id)
      .maybeSingle();
    bible = bibleRow ? rowToBible(bibleRow as DbStoryBible) : null;

    if (!hasSummaryForStory) {
      const generated = await generateSeriesBibleAndSummary({
        language: parentConfig.language,
        storyConfig: parentConfig,
        storyDigest: buildStoryDigest(story.story_map, input.nodeId),
        characters: carried,
        previousBibleText: bible?.bibleText ?? '',
        previousJournal: buildJournalSummary(journalEvents),
        episodeNumber: parentEpisodeNumber,
      });

      if (generated) {
        const bibleFields = {
          title: generated.title || bible?.title || story.title,
          bible_text: generated.bibleText,
          generated_model_id: generated.modelId,
          last_generated_at: nowIso,
          updated_at: nowIso,
        };
        if (bible) {
          const { data: updated } = await admin
            .from('story_bibles')
            .update(bibleFields)
            .eq('id', bible.id)
            .select('*')
            .single();
          if (updated) bible = rowToBible(updated as DbStoryBible);
        } else {
          const { data: inserted } = await admin
            .from('story_bibles')
            .insert({
              branch_id: branch.id,
              user_id: userId,
              // The origin story's full Advanced settings travel with the
              // bible so every episode inherits the same universe setup.
              config_snapshot: parentConfig as unknown as Record<string, unknown>,
              ...bibleFields,
            })
            .select('*')
            .single();
          if (inserted) bible = rowToBible(inserted as DbStoryBible);
        }

        if (journalEnabled) {
          const { data: summaryEvent } = await admin
            .from('episode_journal_events')
            .insert({
              branch_id: branch.id,
              user_id: userId,
              story_id: story.id,
              event_type: 'episode_summary',
              summary: generated.episodeSummary,
              payload: { endingNodeId: input.nodeId, episodeNumber: parentEpisodeNumber },
            })
            .select('*')
            .single();
          if (summaryEvent) {
            journalEvents = [rowToJournalEvent(summaryEvent as DbEpisodeJournalEvent), ...journalEvents];
          }
        }
      }
    }
  }

  // 5. Signed URLs so carried portraits are fetchable as reference images.
  const signedCarried = await signCharacterRosterReferenceSheetUrls(supabase, carried);

  const seriesConfig = bible?.configSnapshot ?? parentConfig;
  const inheritedConfig = buildEpisodeConfig(seriesConfig);

  return {
    branchId: branch.id,
    nextEpisodeNumber: Math.max(branch.latest_episode_number, parentEpisodeNumber) + 1,
    parentStoryId: story.id,
    parentStoryTitle: story.title,
    carriedCharacters: signedCarried,
    bible,
    journalSummary: buildJournalSummary(journalEvents),
    inheritedConfig,
    authoringDefaults: getEpisodeAuthoringDefaults(seriesConfig),
  };
}

export async function recordEpisodeStarted(input: { storyId: string }): Promise<void> {
  try {
    await requireFeature('episodes_enabled', 'Episodes');
    const { userId, story } = await requireOwnedStory(input.storyId);
    if (!story.episode_branch_id || !story.episode_number) return;
    const admin = createAdminClient();

    await admin
      .from('episode_branches')
      .update({
        latest_story_id: story.id,
        latest_episode_number: story.episode_number,
        updated_at: new Date().toISOString(),
      })
      .eq('id', story.episode_branch_id)
      .lt('latest_episode_number', story.episode_number);

    if (await getFeatureFlag('episode_journal_enabled', false)) {
      const { data: existing } = await admin
        .from('episode_journal_events')
        .select('id')
        .eq('branch_id', story.episode_branch_id)
        .eq('story_id', story.id)
        .eq('event_type', 'episode_created')
        .maybeSingle();
      if (!existing) {
        const carriedNames = (story.characters ?? [])
          .map((character) => character.name)
          .filter(Boolean);
        await admin.from('episode_journal_events').insert([
          {
            branch_id: story.episode_branch_id,
            user_id: userId,
            story_id: story.id,
            event_type: 'episode_created',
            summary: `Episode ${story.episode_number} started: ${story.title}`,
            payload: { episodeNumber: story.episode_number },
          },
          {
            branch_id: story.episode_branch_id,
            user_id: userId,
            story_id: story.id,
            event_type: 'characters_migrated',
            summary: carriedNames.length
              ? `Carried characters: ${carriedNames.join(', ')}`
              : 'No named characters carried.',
            payload: { characterNames: carriedNames, episodeNumber: story.episode_number },
          },
        ]);
      }
    }
  } catch (error) {
    // Fire-and-forget from the client; never block episode generation.
    console.error('Failed to record episode start:', error);
  }
}

// ── Navigation ──────────────────────────────────────────────────────

export async function getEpisodeNavigation(storyId: string): Promise<EpisodeNavigation> {
  // Reads are not flag-gated so existing episode links never dead-end; the UI
  // hides Continue-as-Episode entry points separately.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { parent: null, children: [] };

  const { data: story } = await supabase
    .from('stories')
    .select('id, parent_story_id')
    .eq('id', storyId)
    .maybeSingle();
  if (!story) return { parent: null, children: [] };

  const [parentResult, childrenResult] = await Promise.all([
    story.parent_story_id
      ? supabase
          .from('stories')
          .select('id, title, episode_number')
          .eq('id', story.parent_story_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('stories')
      .select('id, title, episode_number, created_at')
      .eq('parent_story_id', storyId)
      .eq('is_archived', false)
      .order('created_at', { ascending: true }),
  ]);

  const parentRow = parentResult.data as { id: string; title: string; episode_number: number | null } | null;
  const childRows = (childrenResult.data ?? []) as Array<{
    id: string;
    title: string;
    episode_number: number | null;
  }>;

  return {
    parent: parentRow
      ? { storyId: parentRow.id, title: parentRow.title, episodeNumber: parentRow.episode_number }
      : null,
    children: childRows.map((row) => ({
      storyId: row.id,
      title: row.title,
      episodeNumber: row.episode_number,
    })),
  };
}

// ── Series bible read/edit + journal ────────────────────────────────

export async function getSeriesBible(branchId: string): Promise<SeriesBible | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('story_bibles')
    .select('*')
    .eq('branch_id', branchId)
    .maybeSingle();
  return data ? rowToBible(data as DbStoryBible) : null;
}

export async function updateSeriesBible(
  branchId: string,
  patch: { title?: string; bibleText?: string }
): Promise<SeriesBible> {
  await requireFeature('story_bible_enabled', 'The story bible');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new EpisodesError('Not authenticated.');

  const nowIso = new Date().toISOString();
  const updates: Record<string, unknown> = { last_edited_at: nowIso, updated_at: nowIso };
  if (patch.title !== undefined) updates.title = patch.title.trim().slice(0, 200);
  if (patch.bibleText !== undefined) updates.bible_text = patch.bibleText.slice(0, BIBLE_TEXT_MAX_CHARS);

  const { data, error } = await supabase
    .from('story_bibles')
    .update(updates)
    .eq('branch_id', branchId)
    .eq('user_id', user.id)
    .select('*')
    .single();
  if (error || !data) throw new EpisodesError('Could not save the series bible.');

  if (await getFeatureFlag('episode_journal_enabled', false)) {
    const admin = createAdminClient();
    await admin
      .from('episode_journal_events')
      .insert({
        branch_id: branchId,
        user_id: user.id,
        event_type: 'bible_edited',
        summary: 'Series bible edited by the author.',
        payload: {},
      })
      .then(({ error: journalError }) => {
        if (journalError) console.error('Failed to journal bible edit:', journalError.message);
      });
  }

  return rowToBible(data as DbStoryBible);
}

export async function listJournalEvents(branchId: string): Promise<EpisodeJournalEvent[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from('episode_journal_events')
    .select('*')
    .eq('branch_id', branchId)
    .order('sequence_no', { ascending: false })
    .limit(50);
  return ((data ?? []) as DbEpisodeJournalEvent[]).map(rowToJournalEvent);
}
