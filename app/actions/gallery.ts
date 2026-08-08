'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createR2SignedGetUrl } from '@/lib/media/r2-server';
import { parseR2UrlLikeReference } from '@/lib/media/r2-reference';
import { extractStoragePath } from '@/lib/supabase/storage';
import type {
  GalleryStoryline,
  GalleryItem,
  GalleryFilters,
  GalleryLane,
  GalleryPage,
  GalleryRail,
  GalleryRailsResponse,
} from '@/lib/types/database';
import type { StoryAspectRatio } from '@/lib/types/story';
import { getMediaPipelineSettings } from '@/lib/media/processing-mode';
import { deriveDiscoveryIntro } from '@/lib/story/discovery-intro';
import { KIDS_AGE_GROUPS } from '@/lib/ai/story-audience';

/**
 * Moderation gate for public listings: when the admin requires review before
 * public discovery, pending/rejected storylines stay off the gallery (their
 * direct /storyline links keep working — this filters listings only).
 * Enforced in queries rather than the gallery SQL view, and only applied
 * while the setting is on so pre-073 databases keep working.
 */
async function moderationGateActive(): Promise<boolean> {
  try {
    return (await getMediaPipelineSettings()).moderationRequiredForPublic;
  } catch {
    return false;
  }
}

type LegacyGalleryBeat = {
  imageUrl?: string | null;
  image_url?: string | null;
  isStoryboard?: boolean | null;
  is_storyboard?: boolean | null;
  storyboardPlan?: unknown;
  storyboard_plan?: unknown;
  imagePrompt?: string | null;
  image_prompt?: string | null;
};

type StorylineGalleryRow = Omit<GalleryStoryline, 'cover_is_storyboard' | 'is_vertical_story' | 'aspect_ratio'> & {
  cover_is_storyboard?: boolean;
  is_vertical_story?: boolean | null;
  aspect_ratio?: string | null;
  node_path?: string[] | null;
  /**
   * Only the two candidate cover beats are selected (`beats->0` / `beats->1`)
   * instead of the whole legacy snapshot — the feed never needs the rest.
   * Typed loosely because PostgREST hands JSON paths back untyped.
   */
  first_beat?: unknown;
  second_beat?: unknown;
  share_cover_url?: string | null;
  share_cover_status?: string | null;
  discovery_intro?: string | null;
  discovery_intro_status?: string | null;
  age_group?: string | null;
  genre?: string | null;
  stories?: {
    genre?: string | null;
    story_config?: Record<string, unknown> | null;
  } | null;
};

/**
 * Columns every storyline listing needs. `beats->0`/`beats->1` keep the legacy
 * cover fallbacks working without transferring the full beat snapshot per row.
 */
const STORYLINE_BASE_COLUMNS =
  'id, title, cover_image_url, share_cover_url, share_cover_status, beat_count, author_name, story_id, is_vertical_story, aspect_ratio, node_path, like_count, view_count, created_at, first_beat:beats->0, second_beat:beats->1';

/** Added by migrations 088 and 089; see `discoveryColumnsAvailable`. */
const STORYLINE_DISCOVERY_COLUMNS = 'discovery_intro, discovery_intro_status, age_group, genre';

/**
 * Migrations are applied by hand, so this code can run against a database that
 * has not seen 088/089 yet. Selecting a column that does not exist fails the
 * whole listing, so the first such failure drops the discovery columns for the
 * rest of the process and the query is retried once.
 */
let discoveryColumnsAvailable = true;

function storylineListColumns(options: { withStory?: boolean } = {}): string {
  const columns = discoveryColumnsAvailable
    ? `${STORYLINE_BASE_COLUMNS}, ${STORYLINE_DISCOVERY_COLUMNS}`
    : STORYLINE_BASE_COLUMNS;
  return options.withStory ? `${columns}, stories!inner(genre, story_config)` : columns;
}

type QueryResult<T> = {
  data: T | null;
  error: { code?: string; message?: string } | null;
  count?: number | null;
};

function isMissingDiscoveryColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // 42703 = undefined_column; PGRST200/PGRST204 cover PostgREST's own
  // "column not found in schema cache" responses.
  return (
    (error.code === '42703' || error.code === 'PGRST200' || error.code === 'PGRST204')
    && /discovery_intro|age_group|\bgenre\b/i.test(error.message ?? '')
  );
}

/**
 * Run a storyline listing query, retrying without the discovery columns if the
 * database has not had migration 088 applied yet.
 */
async function selectStorylines<T>(
  build: (columns: string) => PromiseLike<QueryResult<T>>,
  options: { withStory?: boolean } = {}
): Promise<QueryResult<T>> {
  const result = await build(storylineListColumns(options));

  if (discoveryColumnsAvailable && isMissingDiscoveryColumnError(result.error)) {
    console.warn('Storyline discovery columns missing (migrations 088/089 not applied); serving without intros or stored classification.');
    discoveryColumnsAvailable = false;
    return build(storylineListColumns(options));
  }

  return result;
}

/**
 * Audience scope for a discovery surface. `kids` is enforced here in the query
 * layer rather than by RLS: cover hydration runs on the admin client, so the
 * action layer is the trust boundary. The parameter can only ever narrow the
 * result set, so a tampered client cannot widen a kids surface.
 */
export type GalleryAudienceMode = 'all' | 'kids';

/**
 * Kids eligibility depends on `storylines.age_group` (migration 089). If that
 * column is unavailable the surface fails closed rather than falling back to an
 * unfiltered listing.
 */
function kidsEligibilityUnavailable(mode: GalleryAudienceMode): boolean {
  return mode === 'kids' && !discoveryColumnsAvailable;
}

function emptyGalleryPage(): GalleryPage {
  return { items: [], total: 0, hasMore: false };
}

type StorylineCoverBeatRow = {
  storyline_id: string;
  beat_id: string;
  position: number;
};

type StoryboardFlagBeatRow = {
  id: string;
  is_storyboard: boolean | null;
};

type StoryMapFlagStoryRow = {
  id: string;
  story_map: Record<string, unknown> | null;
};

type BeatCoverImageRow = {
  story_id: string;
  node_id: string;
  image_url: string | null;
};

function readStoryConfigString(
  storyConfig: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  const value = storyConfig?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readStoryConfigBoolean(
  storyConfig: Record<string, unknown> | null | undefined,
  key: string
): boolean {
  return storyConfig?.[key] === true;
}

function resolveStoryAspectRatio(
  row: { is_vertical_story?: boolean | null; aspect_ratio?: string | null },
  storyConfig?: Record<string, unknown> | null
): StoryAspectRatio {
  if (
    row.is_vertical_story === true ||
    row.aspect_ratio === '9:16' ||
    readStoryConfigBoolean(storyConfig, 'isVerticalStory') ||
    readStoryConfigBoolean(storyConfig, 'is_vertical_story') ||
    readStoryConfigString(storyConfig, 'aspectRatio') === '9:16' ||
    readStoryConfigString(storyConfig, 'aspect_ratio') === '9:16'
  ) {
    return '9:16';
  }

  return '16:9';
}

function resolveIsVerticalStory(
  row: { is_vertical_story?: boolean | null; aspect_ratio?: string | null },
  storyConfig?: Record<string, unknown> | null
): boolean {
  return resolveStoryAspectRatio(row, storyConfig) === '9:16';
}

function mapStorylineRow(row: any): GalleryItem {
  const aspectRatio = resolveStoryAspectRatio(row, row.stories?.story_config);
  return {
    id: row.id,
    type: 'storyline',
    title: row.title,
    coverImageUrl: row.cover_image_url,
    coverIsStoryboard: row.cover_is_storyboard === true,
    isVerticalStory: resolveIsVerticalStory(row, row.stories?.story_config),
    aspectRatio,
    authorName: row.author_name,
    storyId: row.story_id ?? row.id,
    beatCount: row.beat_count,
    intro: resolveDiscoveryIntro(row),
    // Storyline columns win; the joined story is the fallback for rows
    // published before migration 089 backfilled them.
    genre: row.genre || row.stories?.genre || null,
    ageGroup: row.age_group || readStoryConfigString(row.stories?.story_config, 'ageGroup'),
    settingCountry: readStoryConfigString(row.stories?.story_config, 'settingCountry'),
    likeCount: row.like_count ?? 0,
    viewCount: row.view_count ?? 0,
    createdAt: row.created_at,
  };
}

/**
 * Coerce one selected `beats->N` value into a beat object. Tolerates the value
 * arriving as a JSON string, and unwraps a one-element array in case the JSON
 * path is ever served as a collection, so an unexpected shape degrades to the
 * other cover fallbacks instead of throwing.
 */
function coerceLegacyBeat(value: unknown): LegacyGalleryBeat | null {
  let candidate = value;

  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }

  if (Array.isArray(candidate)) {
    candidate = candidate[0];
  }

  return candidate && typeof candidate === 'object' ? (candidate as LegacyGalleryBeat) : null;
}

function getLegacyCoverBeat(row: StorylineGalleryRow): LegacyGalleryBeat | null {
  return coerceLegacyBeat(row.second_beat) ?? coerceLegacyBeat(row.first_beat);
}

/**
 * Prefer the intro written at publish time; otherwise derive one from the
 * opening beat. Never calls an LLM — legacy rows resolve deterministically.
 */
function resolveDiscoveryIntro(row: StorylineGalleryRow): string | null {
  if (row.discovery_intro_status === 'ready') {
    const stored = row.discovery_intro?.trim();
    if (stored) return stored;
  }

  return deriveDiscoveryIntro(coerceLegacyBeat(row.first_beat));
}

function getLegacyCoverUrl(row: StorylineGalleryRow): string | null {
  const coverBeat = getLegacyCoverBeat(row);
  const imageUrl = coverBeat?.imageUrl ?? coverBeat?.image_url;

  return typeof imageUrl === 'string' && imageUrl.trim().length > 0
    ? imageUrl
    : null;
}

function getReadyShareCoverUrl(row: StorylineGalleryRow): string | null {
  const shareCoverUrl = row.share_cover_url?.trim();
  return row.share_cover_status === 'ready' && shareCoverUrl ? shareCoverUrl : null;
}

function getLegacyCoverIsStoryboard(row: StorylineGalleryRow): boolean {
  const coverBeat = getLegacyCoverBeat(row);
  const imagePrompt = coverBeat?.imagePrompt ?? coverBeat?.image_prompt;
  const promptLooksStoryboard = typeof imagePrompt === 'string'
    && /\b(storyboard|2x2|2×2|four-panel|panel grid)\b/i.test(imagePrompt);

  return coverBeat?.isStoryboard === true
    || coverBeat?.is_storyboard === true
    || !!coverBeat?.storyboardPlan
    || !!coverBeat?.storyboard_plan
    || promptLooksStoryboard;
}

function getPreferredStorylineCoverUrl(row: StorylineGalleryRow): string | null {
  const coverImageUrl = row.cover_image_url?.trim();
  if (coverImageUrl && !parseR2UrlLikeReference(coverImageUrl)) {
    return coverImageUrl;
  }

  return getReadyShareCoverUrl(row) ?? coverImageUrl ?? getLegacyCoverUrl(row);
}

function getStorylineCoverNodeId(row: StorylineGalleryRow): string | null {
  const nodePath = Array.isArray(row.node_path) ? row.node_path : [];
  return nodePath[1] ?? nodePath[0] ?? null;
}

async function resolveCurrentBeatCoverUrls<T extends StorylineGalleryRow>(
  rows: T[]
): Promise<T[]> {
  const targets = rows
    .map((row, index) => ({
      index,
      storyId: row.story_id,
      nodeId: getStorylineCoverNodeId(row),
      hasCover: Boolean(getPreferredStorylineCoverUrl(row)),
    }))
    .filter((target): target is { index: number; storyId: string; nodeId: string; hasCover: boolean } =>
      !target.hasCover
      && typeof target.storyId === 'string'
      && target.storyId.length > 0
      && typeof target.nodeId === 'string'
      && target.nodeId.length > 0
    );

  if (targets.length === 0) return rows;

  try {
    const admin = createAdminClient();
    const storyIds = Array.from(new Set(targets.map((target) => target.storyId)));
    const nodeIds = Array.from(new Set(targets.map((target) => target.nodeId)));
    const { data, error } = await admin
      .from('beats')
      .select('story_id, node_id, image_url')
      .in('story_id', storyIds)
      .in('node_id', nodeIds);

    if (error || !data) {
      console.error('Failed to fetch gallery current beat cover URLs:', error?.message);
      return rows;
    }

    const imageUrlByStoryAndNode = new Map<string, string>();
    for (const beat of data as BeatCoverImageRow[]) {
      if (beat.image_url && beat.image_url.trim().length > 0) {
        imageUrlByStoryAndNode.set(`${beat.story_id}:${beat.node_id}`, beat.image_url);
      }
    }

    if (imageUrlByStoryAndNode.size === 0) return rows;

    const nextRows = [...rows];
    for (const target of targets) {
      const imageUrl = imageUrlByStoryAndNode.get(`${target.storyId}:${target.nodeId}`);
      if (imageUrl) {
        nextRows[target.index] = {
          ...nextRows[target.index],
          cover_image_url: imageUrl,
        };
      }
    }

    return nextRows;
  } catch (error) {
    console.error('Failed to resolve gallery current beat cover URLs:', error);
    return rows;
  }
}

async function resolveNormalizedCoverStoryboardFlags<T extends StorylineGalleryRow & { cover_is_storyboard: boolean }>(
  rows: T[]
): Promise<T[]> {
  if (rows.length === 0) return rows;

  const storylineIds = Array.from(new Set(rows.map((row) => row.id).filter(Boolean)));
  if (storylineIds.length === 0) return rows;

  try {
    const admin = createAdminClient();

    const { data: coverBeatRows, error: coverBeatError } = await admin
      .from('storyline_beats')
      .select('storyline_id, beat_id, position')
      .in('storyline_id', storylineIds)
      .in('position', [0, 1]);

    if (coverBeatError || !coverBeatRows) {
      console.error('Failed to fetch gallery cover storyboard flags:', coverBeatError?.message);
      return rows;
    }

    const beatIds = Array.from(new Set(
      (coverBeatRows as StorylineCoverBeatRow[])
        .map((row) => row.beat_id)
        .filter(Boolean)
    ));
    if (beatIds.length === 0) return rows;

    const { data: beatRows, error: beatError } = await admin
      .from('beats')
      .select('id, is_storyboard')
      .in('id', beatIds);

    if (beatError || !beatRows) {
      console.error('Failed to fetch gallery beat storyboard flags:', beatError?.message);
      return rows;
    }

    const storyboardByBeatId = new Map(
      (beatRows as StoryboardFlagBeatRow[]).map((beat) => [beat.id, beat.is_storyboard === true])
    );
    const coverFlagByStorylineId = new Map<string, { position: number; isStoryboard: boolean }>();

    for (const row of coverBeatRows as StorylineCoverBeatRow[]) {
      if (row.position !== 0 && row.position !== 1) continue;

      const isStoryboard = storyboardByBeatId.get(row.beat_id);
      if (typeof isStoryboard !== 'boolean') continue;

      const current = coverFlagByStorylineId.get(row.storyline_id);
      if (!current || row.position > current.position) {
        coverFlagByStorylineId.set(row.storyline_id, {
          position: row.position,
          isStoryboard,
        });
      }
    }

    if (coverFlagByStorylineId.size === 0) return rows;

    return rows.map((row) => {
      const coverFlag = coverFlagByStorylineId.get(row.id);
      return coverFlag
        ? { ...row, cover_is_storyboard: row.cover_is_storyboard || coverFlag.isStoryboard }
        : row;
    });
  } catch (error) {
    console.error('Failed to resolve gallery cover storyboard flags:', error);
    return rows;
  }
}

function readStoryMapCoverIsStoryboard(row: StorylineGalleryRow, storyMap: Record<string, unknown> | null | undefined): boolean {
  if (!storyMap || typeof storyMap !== 'object') return false;

  const nodes = (storyMap as { nodes?: Record<string, { data?: Record<string, unknown> }> }).nodes;
  if (!nodes) return false;

  const nodePath = Array.isArray(row.node_path) ? row.node_path : [];
  const coverNodeId = nodePath[1] ?? nodePath[0];
  const coverNodeData = coverNodeId ? nodes[coverNodeId]?.data : undefined;
  if (!coverNodeData) return false;

  return coverNodeData.isStoryboard === true
    || coverNodeData.is_storyboard === true
    || !!coverNodeData.storyboardPlan
    || !!coverNodeData.storyboard_plan;
}

async function resolveStoryMapCoverStoryboardFlags<T extends StorylineGalleryRow & { cover_is_storyboard: boolean }>(
  rows: T[]
): Promise<T[]> {
  if (rows.length === 0) return rows;

  const rowsNeedingStoryMap = rows.filter((row) => !row.cover_is_storyboard);
  if (rowsNeedingStoryMap.length === 0) return rows;

  // story_map is deliberately not selected with the listing (it carries the
  // whole branching tree); only rows still unresolved pay for a targeted fetch.
  const storyIdsToFetch = Array.from(new Set(
    rowsNeedingStoryMap
      .map((row) => row.story_id)
      .filter((storyId): storyId is string => typeof storyId === 'string' && storyId.length > 0)
  ));

  let storyMapByStoryId = new Map<string, Record<string, unknown> | null>();

  if (storyIdsToFetch.length > 0) {
    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from('stories')
        .select('id, story_map')
        .in('id', storyIdsToFetch);

      if (error || !data) {
        console.error('Failed to fetch gallery story-map storyboard flags:', error?.message);
      } else {
        storyMapByStoryId = new Map(
          (data as StoryMapFlagStoryRow[]).map((story) => [story.id, story.story_map])
        );
      }
    } catch (error) {
      console.error('Failed to resolve gallery story-map storyboard flags:', error);
    }
  }

  return rows.map((row) => {
    const isStoryboard = row.cover_is_storyboard
      || readStoryMapCoverIsStoryboard(row, row.story_id ? storyMapByStoryId.get(row.story_id) : null);

    return isStoryboard ? { ...row, cover_is_storyboard: true } : row;
  });
}

async function resolveStorylineCovers<T extends StorylineGalleryRow>(
  rows: T[]
): Promise<Array<T & { cover_is_storyboard: boolean }>> {
  if (rows.length === 0) return [];

  const rowsWithCurrentBeatCovers = await resolveCurrentBeatCoverUrls(rows);
  const resolvedWithFallbackFlags = rowsWithCurrentBeatCovers.map((row) => ({
    ...row,
    cover_image_url: getPreferredStorylineCoverUrl(row),
    cover_is_storyboard: getPreferredStorylineCoverUrl(row) === getReadyShareCoverUrl(row)
      ? false
      : getLegacyCoverIsStoryboard(row),
  }));
  const normalizedResolved = await resolveNormalizedCoverStoryboardFlags(resolvedWithFallbackFlags);
  const resolved = await resolveStoryMapCoverStoryboardFlags(normalizedResolved);

  const supabaseSignTargets = resolved
    .map((row, index) => ({
      index,
      path: row.cover_image_url ? extractStoragePath(row.cover_image_url, 'story-assets') : null,
    }))
    .filter((entry): entry is { index: number; path: string } => !!entry.path);
  const r2SignTargets = resolved
    .map((row, index) => ({
      index,
      reference: row.cover_image_url ? parseR2UrlLikeReference(row.cover_image_url) : null,
    }))
    .filter((entry): entry is { index: number; reference: { bucket: string; objectKey: string } } =>
      Boolean(entry.reference)
    );

  if (supabaseSignTargets.length === 0 && r2SignTargets.length === 0) {
    return resolved;
  }

  const nextRows = [...resolved];

  try {
    if (supabaseSignTargets.length > 0) {
      const admin = createAdminClient();
      const { data, error } = await admin.storage
        .from('story-assets')
        .createSignedUrls(supabaseSignTargets.map((entry) => entry.path), 60 * 60 * 24);

      if (error || !data) {
        console.error('Failed to sign gallery cover URLs:', error?.message);
      } else {
        supabaseSignTargets.forEach((entry, index) => {
          const signedUrl = data[index]?.signedUrl;
          if (signedUrl) {
            nextRows[entry.index] = {
              ...nextRows[entry.index],
              cover_image_url: signedUrl,
            };
          }
        });
      }
    }

    await Promise.all(r2SignTargets.map(async (entry) => {
      const signedUrl = await createR2SignedGetUrl(
        entry.reference.bucket,
        entry.reference.objectKey,
        60 * 60 * 24
      ).catch((error) => {
        console.error('Failed to sign R2 gallery cover URL:', error instanceof Error ? error.message : error);
        return null;
      });
      if (signedUrl) {
        nextRows[entry.index] = {
          ...nextRows[entry.index],
          cover_image_url: signedUrl,
        };
      }
    }));

    return nextRows;
  } catch (error) {
    console.error('Failed to resolve gallery cover URLs:', error);
    return resolved;
  }
}

/**
 * Fetch public storylines for the landing page gallery.
 */
export async function getPublicStorylines(limit: number = 6): Promise<GalleryStoryline[]> {
  const supabase = await createClient();
  const gateActive = await moderationGateActive();

  const { data, error } = await selectStorylines<StorylineGalleryRow[]>((columns) => {
    const query = supabase
      .from('storylines')
      .select(columns)
      .eq('is_public', true)
      .eq('is_vertical_story', false)
      .neq('aspect_ratio', '9:16')
      .order('created_at', { ascending: false })
      .limit(limit);
    return (gateActive
      ? query.in('moderation_status', ['none', 'approved'])
      : query) as unknown as PromiseLike<QueryResult<StorylineGalleryRow[]>>;
  });

  if (error) {
    console.error('Failed to fetch public storylines:', error.message);
    return [];
  }

  const rows = await resolveStorylineCovers((data || []) as StorylineGalleryRow[]);
  return rows.map(({
    first_beat,
    second_beat,
    node_path,
    stories,
    share_cover_url,
    share_cover_status,
    discovery_intro,
    discovery_intro_status,
    ...storyline
  }) => {
    void first_beat;
    void second_beat;
    void share_cover_url;
    void share_cover_status;
    void discovery_intro;
    void discovery_intro_status;
    const aspectRatio = resolveStoryAspectRatio(storyline, stories?.story_config);
    return {
      ...storyline,
      is_vertical_story: aspectRatio === '9:16',
      aspect_ratio: aspectRatio,
    };
  });
}

const RAIL_RECENT_POOL = 48;
const RAIL_ITEM_LIMIT = 12;
const GENRE_RAIL_ITEM_LIMIT = 10;
const GENRE_RAIL_MIN_ITEMS = 3;

/**
 * Rotate the hero once a day rather than per request, so the billboard is
 * stable across reloads and safe to cache later.
 */
function dayOfYearUtc(now: Date): number {
  const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 1);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - startOfYear) / 86_400_000);
}

function titleCaseGenre(genre: string): string {
  return genre.charAt(0).toUpperCase() + genre.slice(1);
}

/**
 * Build the cinematic discovery surface: a hero billboard plus the rails above
 * the "Browse All" grid. Rows are fetched in parallel and then run through a
 * single cover-resolution pass over the deduped set, so a storyline appearing
 * in several rails is only signed once.
 */
export async function getGalleryRails(
  mode: GalleryAudienceMode = 'all'
): Promise<GalleryRailsResponse> {
  const supabase = await createClient();
  const gateActive = await moderationGateActive();
  const moderationStatuses = ['none', 'approved'];

  const withScope = <T>(query: T): T => {
    let scoped = query as T & {
      in: (column: string, values: string[]) => T & { in: (c: string, v: string[]) => T };
    };
    if (gateActive) {
      scoped = scoped.in('moderation_status', moderationStatuses) as typeof scoped;
    }
    if (mode === 'kids') {
      scoped = scoped.in('age_group', KIDS_AGE_GROUPS) as typeof scoped;
    }
    return scoped as T;
  };

  const railQuery = (
    build: (query: ReturnType<ReturnType<typeof supabase.from>['select']>) => unknown
  ) =>
    selectStorylines<StorylineGalleryRow[]>(
      (columns) =>
        build(withScope(supabase.from('storylines').select(columns))) as PromiseLike<
          QueryResult<StorylineGalleryRow[]>
        >,
      { withStory: true }
    );

  // Fail closed: without the age_group column there is no trustworthy way to
  // restrict a kids surface, so show nothing rather than everything.
  if (kidsEligibilityUnavailable(mode)) {
    console.warn('Kids rails requested but age_group is unavailable (migration 089 not applied).');
    return { hero: null, rails: [] };
  }

  const [recentResult, mostLovedResult, verticalResult, savedRows] = await Promise.all([
    railQuery((query) =>
      query
        .eq('is_public', true)
        .eq('is_vertical_story', false)
        .neq('aspect_ratio', '9:16')
        .order('created_at', { ascending: false })
        .limit(RAIL_RECENT_POOL)
    ),
    railQuery((query) =>
      query
        .eq('is_public', true)
        .eq('is_vertical_story', false)
        .neq('aspect_ratio', '9:16')
        .gt('like_count', 0)
        .order('like_count', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(RAIL_ITEM_LIMIT)
    ),
    railQuery((query) =>
      query
        .eq('is_public', true)
        .or('is_vertical_story.eq.true,aspect_ratio.eq.9:16')
        .order('created_at', { ascending: false })
        .limit(RAIL_ITEM_LIMIT)
    ),
    // A viewer's saved list can contain anything they saved elsewhere, so it
    // has no place on a kids surface.
    mode === 'kids' ? Promise.resolve([]) : fetchSavedStorylineRows(supabase),
  ]);

  if (recentResult.error) {
    // In kids mode a failed query must not degrade into an unfiltered surface.
    if (mode === 'kids') {
      console.error('Failed to fetch kids rails:', recentResult.error.message);
      return { hero: null, rails: [] };
    }
    throw new Error(`Failed to fetch gallery rails: ${recentResult.error.message}`);
  }

  const recentRows = (recentResult.data || []) as StorylineGalleryRow[];
  const mostLovedRows = (mostLovedResult.error ? [] : mostLovedResult.data || []) as StorylineGalleryRow[];
  const verticalRows = (verticalResult.error ? [] : verticalResult.data || []) as StorylineGalleryRow[];

  if (mostLovedResult.error) {
    console.error('Failed to fetch most-loved rail:', mostLovedResult.error.message);
  }
  if (verticalResult.error) {
    console.error('Failed to fetch vertical rail:', verticalResult.error.message);
  }

  // One cover-resolution pass across every rail's rows.
  const dedupedRows: StorylineGalleryRow[] = [];
  const seenIds = new Set<string>();
  for (const row of [...recentRows, ...mostLovedRows, ...verticalRows, ...savedRows]) {
    if (!row?.id || seenIds.has(row.id)) continue;
    seenIds.add(row.id);
    dedupedRows.push(row);
  }

  const resolvedRows = await resolveStorylineCovers(dedupedRows);
  const itemsById = new Map<string, GalleryItem>(
    resolvedRows.map((row) => [row.id, mapStorylineRow(row)])
  );

  const toItems = (rows: StorylineGalleryRow[]): GalleryItem[] =>
    rows
      .map((row) => itemsById.get(row.id))
      .filter((item): item is GalleryItem => !!item);

  const recentItems = toItems(recentRows);

  // A storyboard grid makes a poor billboard, and a hero without artwork is
  // worse than no hero at all — so only clean covers are eligible.
  const heroCandidates = recentItems.filter(
    (item) => !!item.coverImageUrl && !item.coverIsStoryboard
  );
  const hero = heroCandidates.length > 0
    ? heroCandidates[dayOfYearUtc(new Date()) % heroCandidates.length]
    : null;

  const railItems = hero ? recentItems.filter((item) => item.id !== hero.id) : recentItems;
  const rails: GalleryRail[] = [];

  const savedItems = toItems(savedRows);
  if (savedItems.length > 0) {
    rails.push({ key: 'my_list', title: 'My List', layout: 'wide', items: savedItems });
  }

  if (railItems.length > 0) {
    rails.push({
      key: 'new',
      title: mode === 'kids' ? 'New for Kids' : 'New on Kissago',
      layout: 'wide',
      items: railItems.slice(0, RAIL_ITEM_LIMIT),
    });
  }

  // Popularity counts are an engagement-pressure signal; the kids surface
  // leaves them out entirely.
  const mostLovedItems = mode === 'kids' ? [] : toItems(mostLovedRows);
  if (mostLovedItems.length >= GENRE_RAIL_MIN_ITEMS) {
    rails.push({ key: 'most_loved', title: 'Most Loved', layout: 'wide', items: mostLovedItems });
  }

  // Genre rails are only meaningful once the catalogue actually spans more than
  // one genre; with a single genre they would just restate "New on Kissago".
  const genreGroups = new Map<string, GalleryItem[]>();
  for (const item of railItems) {
    const genreKey = (item.genre || '').toLowerCase();
    if (!genreKey) continue;
    const group = genreGroups.get(genreKey) ?? [];
    if (group.length >= GENRE_RAIL_ITEM_LIMIT) continue;
    group.push(item);
    genreGroups.set(genreKey, group);
  }

  const qualifyingGenres = Array.from(genreGroups.entries())
    .filter(([, items]) => items.length >= GENRE_RAIL_MIN_ITEMS)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

  if (qualifyingGenres.length >= 2) {
    for (const [genre, items] of qualifyingGenres) {
      rails.push({
        key: `genre:${genre}`,
        title: titleCaseGenre(genre),
        layout: 'wide',
        items,
      });
    }
  }

  const verticalItems = toItems(verticalRows);
  if (verticalItems.length > 0) {
    rails.push({
      key: 'vertical',
      title: 'Vertical Stories',
      layout: 'portrait',
      items: verticalItems,
    });
  }

  return { hero, rails };
}

/**
 * Storylines the signed-in viewer saved, newest save first. Returns an empty
 * list (never throws) for signed-out visitors so the rails still render.
 */
async function fetchSavedStorylineRows(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<StorylineGalleryRow[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data: savedRows, error: savedError } = await supabase
      .from('saved_storylines')
      .select('storyline_id, saved_at')
      .eq('user_id', user.id)
      .order('saved_at', { ascending: false })
      .limit(RAIL_ITEM_LIMIT);

    if (savedError || !savedRows?.length) return [];

    const orderedIds = (savedRows as { storyline_id: string }[]).map((row) => row.storyline_id);
    const { data, error } = await selectStorylines<StorylineGalleryRow[]>(
      (columns) =>
        supabase
          .from('storylines')
          .select(columns)
          .in('id', orderedIds) as unknown as PromiseLike<QueryResult<StorylineGalleryRow[]>>,
      { withStory: true }
    );

    if (error || !data) return [];

    const rowsById = new Map(data.map((row) => [row.id, row]));
    return orderedIds
      .map((id) => rowsById.get(id))
      .filter((row): row is StorylineGalleryRow => !!row);
  } catch (error) {
    console.error('Failed to fetch saved storyline rail:', error);
    return [];
  }
}

export async function getSavedStorylineIds(): Promise<string[]> {
  const supabase = await createClient();

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return [];

    const { data, error } = await supabase
      .from('saved_storylines')
      .select('storyline_id')
      .eq('user_id', user.id);

    if (error) {
      console.error('Failed to fetch saved storyline IDs:', error.message);
      return [];
    }

    return (data || []).map((row: any) => row.storyline_id);
  } catch {
    return [];
  }
}

/**
 * Fetch gallery items with search, filters, and pagination.
 */
export async function getGalleryItems(
  filters: GalleryFilters,
  limit: number = 12,
  offset: number = 0,
  mode: GalleryAudienceMode = 'all'
): Promise<GalleryPage> {
  const supabase = await createClient();
  const rangeEnd = offset + limit - 1;
  const lane: GalleryLane = filters.type === 'vertical' ? 'vertical' : 'storylines';

  // Fail closed: no trustworthy age column means no kids listing.
  if (kidsEligibilityUnavailable(mode)) {
    console.warn('Kids listing requested but age_group is unavailable (migration 089 not applied).');
    return emptyGalleryPage();
  }

  const gateActive = await moderationGateActive();

  const { data: storylines, count, error } = await selectStorylines<StorylineGalleryRow[]>(
    (columns) => {
      let query = supabase
        .from('storylines')
        .select(columns, { count: 'exact' })
        .eq('is_public', true)
        .order('created_at', { ascending: false });

      query = lane === 'vertical'
        ? query.or('is_vertical_story.eq.true,aspect_ratio.eq.9:16')
        : query.eq('is_vertical_story', false).neq('aspect_ratio', '9:16');

      if (gateActive) {
        query = query.in('moderation_status', ['none', 'approved']);
      }
      if (mode === 'kids') {
        query = query.in('age_group', KIDS_AGE_GROUPS);
      }

      if (filters.search) {
        query = query.ilike('title', `%${filters.search}%`);
      }
      // Genre and audience read the indexed storyline columns (migration 089)
      // instead of the unindexable jsonb path on the joined story.
      if (filters.genre && filters.genre !== 'all') {
        query = discoveryColumnsAvailable
          ? query.eq('genre', filters.genre.toLowerCase())
          : query.ilike('stories.genre', filters.genre);
      }
      if (filters.ageGroup && filters.ageGroup !== 'all') {
        query = discoveryColumnsAvailable
          ? query.eq('age_group', filters.ageGroup)
          : query.filter('stories.story_config->>ageGroup', 'eq', filters.ageGroup);
      }
      if (filters.country && filters.country !== 'all') {
        query = query.filter('stories.story_config->>settingCountry', 'eq', filters.country);
      }
      if (filters.language && filters.language !== 'all') {
        query = query.filter('stories.story_config->>language', 'eq', filters.language);
      }

      return query.range(offset, rangeEnd) as unknown as PromiseLike<
        QueryResult<StorylineGalleryRow[]>
      >;
    },
    { withStory: true }
  );

  if (error) {
    throw new Error(`Failed to fetch ${lane} gallery items: ${error.message}`);
  }

  const resolvedRows = await resolveStorylineCovers((storylines || []) as StorylineGalleryRow[]);
  const items = resolvedRows.map(mapStorylineRow);
  const total = count ?? 0;

  return {
    items,
    total,
    hasMore: offset + items.length < total,
  };
}
