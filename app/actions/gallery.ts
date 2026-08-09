'use server';

import { createAnonClient, createClient } from '@/lib/supabase/server';
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
  GalleryProgress,
  GalleryRail,
  GalleryRailsResponse,
} from '@/lib/types/database';
import type { StoryAspectRatio } from '@/lib/types/story';
import { getMediaPipelineSettings } from '@/lib/media/processing-mode';
import { deriveDiscoveryIntro } from '@/lib/story/discovery-intro';
import { KIDS_AGE_GROUPS } from '@/lib/ai/story-audience';
import { cached, cachedMany } from '@/lib/cache/ttl-cache';
import { resolveActiveViewerProfile } from '@/lib/viewer-profile';

/**
 * Cache windows. All three hold public, non-viewer-specific data.
 *
 * - Settings change rarely and an admin toggle taking half a minute to reach
 *   discovery is acceptable.
 * - A published storyline's cover artwork is immutable, so whether it is a 2×2
 *   storyboard never changes — this only expires to bound memory.
 * - Signed URLs are minted for 24h; re-serving one with at least 12h left is
 *   safe and removes the per-request signing round-trips.
 * - The public rail payload is the whole point of the phase: a 60s window
 *   collapses a burst of visitors into one set of queries while keeping the
 *   feed visibly fresh.
 */
const MODERATION_SETTING_TTL_MS = 30 * 1000;
const COVER_FLAG_TTL_MS = 30 * 60 * 1000;
const SIGNED_URL_TTL_MS = 12 * 60 * 60 * 1000;
const SIGNED_URL_LIFETIME_SECONDS = 60 * 60 * 24;
const PUBLIC_RAILS_TTL_MS = 60 * 1000;

/**
 * Moderation gate for public listings: when the admin requires review before
 * public discovery, pending/rejected storylines stay off the gallery (their
 * direct /storyline links keep working — this filters listings only).
 * Enforced in queries rather than the gallery SQL view, and only applied
 * while the setting is on so pre-073 databases keep working.
 */
async function moderationGateActive(): Promise<boolean> {
  return cached('gallery:moderation-gate', MODERATION_SETTING_TTL_MS, async () => {
    try {
      return (await getMediaPipelineSettings()).moderationRequiredForPublic;
    } catch {
      return false;
    }
  });
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
 * Narrow the requested scope by the active viewer profile's own eligibility
 * (migration 091). A kids profile stays on the kids catalogue even when the
 * request came from `/gallery`, because eligibility must be enforced where the
 * query is built rather than by which page the viewer navigated to.
 *
 * Can only ever narrow: `kids` never widens to `all`.
 */
async function resolveEffectiveAudienceMode(
  requested: GalleryAudienceMode
): Promise<GalleryAudienceMode> {
  if (requested === 'kids') return 'kids';
  const profile = await resolveActiveViewerProfile();
  return profile.audienceMode === 'kids' ? 'kids' : 'all';
}

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

type BeatCoverImageRow = {
  story_id: string;
  node_id: string;
  image_url: string | null;
};

type OpeningBeatRow = {
  id: string;
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
    // Attached by `withOpeningPanels` for featured items only.
    openingImageUrl: null,
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
    // Attached per request by `withProgress`; never part of the cached rows.
    progress: null,
  };
}

type StorylineProgressRow = {
  storyline_id: string;
  current_beat_index: number | null;
  beat_count: number | null;
  completed: boolean | null;
  updated_at?: string;
};

function toGalleryProgress(row: StorylineProgressRow): GalleryProgress {
  return {
    beatIndex: Math.max(0, row.current_beat_index ?? 0),
    beatCount: typeof row.beat_count === 'number' ? row.beat_count : null,
    completed: row.completed === true,
  };
}

/**
 * The viewer's reading state for the given storylines (migration 090).
 *
 * Always a single indexed query — never one per card — and always fetched with
 * the viewer's own client so RLS scopes it to them. Returns an empty map for
 * signed-out visitors, or when the table does not exist yet.
 */
async function fetchStorylineProgress(
  supabase: Awaited<ReturnType<typeof createClient>>,
  storylineIds: string[]
): Promise<Map<string, GalleryProgress>> {
  const progress = new Map<string, GalleryProgress>();
  const ids = Array.from(new Set(storylineIds.filter(Boolean)));
  if (ids.length === 0) return progress;

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return progress;

    const { data, error } = await supabase
      .from('storyline_progress')
      .select('storyline_id, current_beat_index, beat_count, completed')
      .eq('user_id', user.id)
      .in('storyline_id', ids);

    if (error || !data) {
      if (error) console.warn('Failed to fetch storyline progress:', error.message);
      return progress;
    }

    for (const row of data as StorylineProgressRow[]) {
      progress.set(row.storyline_id, toGalleryProgress(row));
    }
  } catch (error) {
    console.warn('Failed to fetch storyline progress:', error);
  }

  return progress;
}

function withProgress(
  items: GalleryItem[],
  progress: Map<string, GalleryProgress>
): GalleryItem[] {
  if (progress.size === 0) return items;
  return items.map((item) => {
    const itemProgress = progress.get(item.id);
    return itemProgress ? { ...item, progress: itemProgress } : item;
  });
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

/**
 * Mint (or reuse) read URLs for private cover objects. Signatures are valid for
 * 24h and cached for 12, so repeat visitors and overlapping rails reuse one
 * signature instead of re-signing every object on every request.
 */
async function signCoverUrls(sourceUrls: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(sourceUrls.filter(Boolean)));
  if (unique.length === 0) return new Map();

  const byCacheKey = await cachedMany<string>(
    unique.map((url) => `cover-signed-url:${url}`),
    SIGNED_URL_TTL_MS,
    async (missingKeys) => {
      const missingUrls = missingKeys.map((key) => key.slice('cover-signed-url:'.length));
      const filled = new Map<string, string>();

      const supabaseTargets = missingUrls
        .map((url) => ({ url, path: extractStoragePath(url, 'story-assets') }))
        .filter((entry): entry is { url: string; path: string } => !!entry.path);
      const r2Targets = missingUrls
        .map((url) => ({ url, reference: parseR2UrlLikeReference(url) }))
        .filter((entry): entry is { url: string; reference: { bucket: string; objectKey: string } } =>
          Boolean(entry.reference)
        );

      if (supabaseTargets.length > 0) {
        try {
          const admin = createAdminClient();
          const { data, error } = await admin.storage
            .from('story-assets')
            .createSignedUrls(supabaseTargets.map((entry) => entry.path), SIGNED_URL_LIFETIME_SECONDS);

          if (error || !data) {
            console.error('Failed to sign gallery cover URLs:', error?.message);
          } else {
            supabaseTargets.forEach((entry, index) => {
              const signedUrl = data[index]?.signedUrl;
              if (signedUrl) filled.set(`cover-signed-url:${entry.url}`, signedUrl);
            });
          }
        } catch (error) {
          console.error('Failed to sign gallery cover URLs:', error);
        }
      }

      await Promise.all(r2Targets.map(async (entry) => {
        const signedUrl = await createR2SignedGetUrl(
          entry.reference.bucket,
          entry.reference.objectKey,
          SIGNED_URL_LIFETIME_SECONDS
        ).catch((error) => {
          console.error('Failed to sign R2 gallery cover URL:', error instanceof Error ? error.message : error);
          return null;
        });
        if (signedUrl) filled.set(`cover-signed-url:${entry.url}`, signedUrl);
      }));

      return filled;
    }
  );

  const signed = new Map<string, string>();
  for (const url of unique) {
    const signedUrl = byCacheKey.get(`cover-signed-url:${url}`);
    if (signedUrl) signed.set(url, signedUrl);
  }
  return signed;
}

async function resolveStorylineCovers<T extends StorylineGalleryRow>(
  rows: T[]
): Promise<Array<T & { cover_is_storyboard: boolean }>> {
  if (rows.length === 0) return [];

  const rowsWithCurrentBeatCovers = await resolveCurrentBeatCoverUrls(rows);

  // Structural rather than inferred. A share cover is a rendered poster with
  // the title composited in; every other cover source is beat artwork, because
  // publishing copies the cover node's own image into `cover_image_url`. So the
  // answer is "which source won", not "what does some flag say" — the flag was
  // read off the cover *beat* and then applied to the *poster*, which is how a
  // title card ended up cropped to one quadrant and blown up 2.12× on the rails.
  const resolved = rowsWithCurrentBeatCovers.map((row) => {
    const coverImageUrl = getPreferredStorylineCoverUrl(row);
    return {
      ...row,
      cover_image_url: coverImageUrl,
      cover_is_storyboard: Boolean(coverImageUrl) && coverImageUrl !== getReadyShareCoverUrl(row),
    };
  });

  const signedUrls = await signCoverUrls(
    resolved
      .map((row) => row.cover_image_url)
      .filter((url): url is string => !!url)
  );

  return resolved.map((row) => {
    const signedUrl = row.cover_image_url ? signedUrls.get(row.cover_image_url) : undefined;
    return signedUrl ? { ...row, cover_image_url: signedUrl } : row;
  });
}

/**
 * Opening beat image taken from the legacy snapshot already on the row
 * (`beats->0`), so storylines carrying one cost no extra query.
 *
 * No storyboard flag comes back with it: beat artwork is always a 2×2 grid, and
 * consumers crop to a single panel unconditionally rather than trusting a flag
 * that is only ever written when true (see `is_storyboard` in persistence).
 */
function getSnapshotOpeningImageUrl(row: StorylineGalleryRow): string | null {
  const beat = coerceLegacyBeat(row.first_beat);
  return (beat?.imageUrl ?? beat?.image_url)?.trim() || null;
}

/**
 * Opening beat images from the normalized tables (`storyline_beats` position 0
 * → `beats`), for storylines whose snapshot has none. Returns only the
 * storylines it could resolve.
 */
async function fetchNormalizedOpeningImageUrls(
  storylineIds: string[]
): Promise<Map<string, string>> {
  const panels = new Map<string, string>();
  if (storylineIds.length === 0) return panels;

  try {
    const admin = createAdminClient();

    const { data: openingRows, error: openingError } = await admin
      .from('storyline_beats')
      .select('storyline_id, beat_id')
      .in('storyline_id', storylineIds)
      .eq('position', 0);

    if (openingError || !openingRows) {
      console.error('Failed to fetch storyline opening beats:', openingError?.message);
      return panels;
    }

    const beatIdByStorylineId = new Map<string, string>();
    for (const row of openingRows as Array<{ storyline_id: string; beat_id: string }>) {
      if (row.beat_id) beatIdByStorylineId.set(row.storyline_id, row.beat_id);
    }
    if (beatIdByStorylineId.size === 0) return panels;

    const { data: beatRows, error: beatError } = await admin
      .from('beats')
      .select('id, image_url')
      .in('id', Array.from(new Set(beatIdByStorylineId.values())));

    if (beatError || !beatRows) {
      console.error('Failed to fetch storyline opening beat images:', beatError?.message);
      return panels;
    }

    const beatById = new Map((beatRows as OpeningBeatRow[]).map((beat) => [beat.id, beat]));

    for (const [storylineId, beatId] of beatIdByStorylineId) {
      const imageUrl = beatById.get(beatId)?.image_url?.trim();
      if (imageUrl) panels.set(storylineId, imageUrl);
    }
  } catch (error) {
    console.error('Failed to resolve storyline opening images:', error);
  }

  return panels;
}

/**
 * Attach each item's opening beat image, signing its URL the same way covers
 * are. Two surfaces need it: the billboard, which shows it as the backdrop, and
 * cards whose cover is a poster, which hold the poster at rest and cycle this
 * grid's panels on hover.
 *
 * Most rows carry the image in the snapshot already selected with the listing,
 * so they cost nothing; the rest fall through to one batched beat lookup. A
 * published beat's image never changes, so both that lookup and the signature
 * are cached per storyline and a warm feed makes no queries at all.
 */
async function withOpeningPanels(
  items: GalleryItem[],
  rowsById: Map<string, StorylineGalleryRow>
): Promise<GalleryItem[]> {
  if (items.length === 0) return items;

  const byCacheKey = await cachedMany<string>(
    items.map((item) => `storyline-opening-panel:${item.id}`),
    COVER_FLAG_TTL_MS,
    async (missingKeys) => {
      const missingIds = missingKeys.map((key) => key.split(':').slice(1).join(':'));
      const filled = new Map<string, string>();
      const unresolved: string[] = [];

      for (const id of missingIds) {
        const row = rowsById.get(id);
        const snapshotUrl = row ? getSnapshotOpeningImageUrl(row) : null;
        if (snapshotUrl) {
          filled.set(`storyline-opening-panel:${id}`, snapshotUrl);
        } else {
          unresolved.push(id);
        }
      }

      for (const [id, imageUrl] of await fetchNormalizedOpeningImageUrls(unresolved)) {
        filled.set(`storyline-opening-panel:${id}`, imageUrl);
      }

      return filled;
    }
  );

  const signedUrls = await signCoverUrls(Array.from(byCacheKey.values()));

  return items.map((item) => {
    const imageUrl = byCacheKey.get(`storyline-opening-panel:${item.id}`);
    if (!imageUrl) return item;

    return { ...item, openingImageUrl: signedUrls.get(imageUrl) ?? imageUrl };
  });
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

// Deep enough to group genre rails from, shallow enough that the payload stays
// small — the rails only ever render RAIL_ITEM_LIMIT of them.
const RAIL_RECENT_POOL = 24;
const RAIL_ITEM_LIMIT = 12;
const GENRE_RAIL_ITEM_LIMIT = 10;
const GENRE_RAIL_MIN_ITEMS = 3;
const FEATURED_LIMIT = 5;

/**
 * Republishing creates a fresh storyline row for the same story, so rails can
 * show near-identical duplicates back to back. Keep only the first (rows
 * arrive newest-first) appearance of each story per rail; the Browse All grid
 * still lists every published storyline.
 */
function dedupeByStory(items: GalleryItem[]): GalleryItem[] {
  const seen = new Set<string>();
  const deduped: GalleryItem[] = [];
  for (const item of items) {
    const key = item.storyId || item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

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

interface PublicRailRows {
  recentRows: StorylineGalleryRow[];
  mostLovedRows: StorylineGalleryRow[];
  verticalRows: StorylineGalleryRow[];
}

/**
 * The rail candidate pool that is identical for every viewer.
 *
 * Read through a session-less client and cached per audience mode, so a burst
 * of visitors costs one set of queries rather than three per request. Nothing
 * viewer-specific may be added here — My List is fetched separately and merged
 * by the caller.
 */
async function fetchPublicRailRows(
  mode: GalleryAudienceMode,
  gateActive: boolean
): Promise<PublicRailRows> {
  return cached(
    `gallery:rail-rows:${mode}:${gateActive ? 'gated' : 'open'}`,
    PUBLIC_RAILS_TTL_MS,
    async () => {
      const supabase = createAnonClient();

      const withScope = <T>(query: T): T => {
        let scoped = query as T & {
          in: (column: string, values: string[]) => T & { in: (c: string, v: string[]) => T };
        };
        if (gateActive) {
          scoped = scoped.in('moderation_status', ['none', 'approved']) as typeof scoped;
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

      const [recentResult, mostLovedResult, verticalResult] = await Promise.all([
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
      ]);

      // Throwing rather than returning an error keeps the failure out of the
      // cache, so the next visitor retries instead of inheriting a dead feed
      // for the rest of the TTL. The two secondary rails degrade to empty.
      if (recentResult.error) {
        throw new Error(recentResult.error.message ?? 'Unknown error');
      }
      if (mostLovedResult.error) {
        console.error('Failed to fetch most-loved rail:', mostLovedResult.error.message);
      }
      if (verticalResult.error) {
        console.error('Failed to fetch vertical rail:', verticalResult.error.message);
      }

      return {
        recentRows: (recentResult.data || []) as StorylineGalleryRow[],
        mostLovedRows: (mostLovedResult.error ? [] : mostLovedResult.data || []) as StorylineGalleryRow[],
        verticalRows: (verticalResult.error ? [] : verticalResult.data || []) as StorylineGalleryRow[],
      };
    }
  );
}

/**
 * Build the cinematic discovery surface: a rotating billboard plus the rails
 * above the "Browse All" grid. The public candidate pool is cached; only the
 * viewer's own saved list is fetched per request, and one cover-resolution pass
 * covers the deduped union so a storyline in several rails is signed once.
 */
export async function getGalleryRails(
  requestedMode: GalleryAudienceMode = 'all'
): Promise<GalleryRailsResponse> {
  const supabase = await createClient();
  const [gateActive, mode] = await Promise.all([
    moderationGateActive(),
    resolveEffectiveAudienceMode(requestedMode),
  ]);

  // Fail closed: without the age_group column there is no trustworthy way to
  // restrict a kids surface, so show nothing rather than everything.
  if (kidsEligibilityUnavailable(mode)) {
    console.warn('Kids rails requested but age_group is unavailable (migration 089 not applied).');
    return { featured: [], rails: [] };
  }

  const [publicRowsResult, savedRows, continueRows] = await Promise.all([
    fetchPublicRailRows(mode, gateActive).catch((error: unknown) => error as Error),
    // A viewer's saved list can contain anything they saved elsewhere, so it
    // has no place on a kids surface.
    mode === 'kids' ? Promise.resolve([]) : fetchSavedStorylineRows(supabase),
    fetchContinueReadingRows(supabase),
  ]);

  if (publicRowsResult instanceof Error) {
    // In kids mode a failed query must not degrade into an unfiltered surface.
    if (mode === 'kids') {
      console.error('Failed to fetch kids rails:', publicRowsResult.message);
      return { featured: [], rails: [] };
    }
    throw new Error(`Failed to fetch gallery rails: ${publicRowsResult.message}`);
  }

  const { recentRows, mostLovedRows, verticalRows } = publicRowsResult;

  // One cover-resolution pass across every rail's rows.
  const dedupedRows: StorylineGalleryRow[] = [];
  const seenIds = new Set<string>();
  for (const row of [...continueRows, ...recentRows, ...mostLovedRows, ...verticalRows, ...savedRows]) {
    if (!row?.id || seenIds.has(row.id)) continue;
    seenIds.add(row.id);
    dedupedRows.push(row);
  }

  // Covers come from the shared cache; progress is per viewer and read fresh.
  const [resolvedRows, progressById] = await Promise.all([
    resolveStorylineCovers(dedupedRows),
    fetchStorylineProgress(supabase, dedupedRows.map((row) => row.id)),
  ]);

  const rowsById = new Map<string, StorylineGalleryRow>(
    resolvedRows.map((row) => [row.id, row])
  );
  const itemsWithPanels = await withOpeningPanels(
    resolvedRows.map((row) => {
      const item = mapStorylineRow(row);
      const progress = progressById.get(row.id);
      return progress ? { ...item, progress } : item;
    }),
    rowsById
  );
  const itemsById = new Map<string, GalleryItem>(
    itemsWithPanels.map((item) => [item.id, item])
  );

  const toItems = (rows: StorylineGalleryRow[]): GalleryItem[] =>
    rows
      .map((row) => itemsById.get(row.id))
      .filter((item): item is GalleryItem => !!item);

  const recentItems = dedupeByStory(toItems(recentRows));

  // Billboard rotation: prefer clean single-image covers, but storyboard
  // covers are eligible too — the hero crops them to a single panel — so the
  // billboard never falls back to a bare heading just because a batch of
  // stories was generated in storyboard mode. The lead slot still rotates
  // daily so the page is stable across reloads and cacheable. A cover is still
  // what makes a storyline eligible, since it is the backdrop fallback for
  // storylines whose opening beat has no image of its own.
  const coverItems = recentItems.filter((item) => !!item.coverImageUrl);
  const cleanCoverItems = coverItems.filter((item) => !item.coverIsStoryboard);
  const featuredPool = cleanCoverItems.length >= 2 ? cleanCoverItems : coverItems;
  const featuredStart = featuredPool.length > 0
    ? dayOfYearUtc(new Date()) % featuredPool.length
    : 0;
  const featured = featuredPool.length > 0
    ? [...featuredPool.slice(featuredStart), ...featuredPool.slice(0, featuredStart)].slice(0, FEATURED_LIMIT)
    : [];

  // Spotlighted stories stay in their rails — the billboard is a highlight,
  // not a removal, and pulling five items out would gut the "New" rail.
  const railItems = recentItems;
  const rails: GalleryRail[] = [];

  // Unfinished stories outrank everything: it is the one row where the viewer
  // already told us what they want next.
  const continueItems = dedupeByStory(toItems(continueRows));
  if (continueItems.length > 0) {
    rails.push({
      key: 'continue',
      title: 'Continue Watching',
      layout: 'wide',
      items: continueItems,
    });
  }

  const savedItems = dedupeByStory(toItems(savedRows));
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
  const mostLovedItems = mode === 'kids' ? [] : dedupeByStory(toItems(mostLovedRows));
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

  const verticalItems = dedupeByStory(toItems(verticalRows));
  if (verticalItems.length > 0) {
    rails.push({
      key: 'vertical',
      title: 'Vertical Stories',
      layout: 'portrait',
      items: verticalItems,
    });
  }

  return { featured, rails };
}

/**
 * Storylines the viewer started but has not finished, most recently watched first.
 *
 * "Started" means they advanced past the opening beat — see migration 090 — so
 * a storyline that was opened and immediately abandoned never appears here.
 * Empty (never throws) for signed-out visitors and before 090 is applied.
 */
async function fetchContinueReadingRows(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<StorylineGalleryRow[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data: progressRows, error: progressError } = await supabase
      .from('storyline_progress')
      .select('storyline_id, current_beat_index, updated_at')
      .eq('user_id', user.id)
      .eq('completed', false)
      .gte('current_beat_index', 1)
      .order('updated_at', { ascending: false })
      .limit(RAIL_ITEM_LIMIT);

    if (progressError || !progressRows?.length) {
      if (progressError) {
        console.warn('Failed to fetch continue-reading rail:', progressError.message);
      }
      return [];
    }

    const orderedIds = (progressRows as StorylineProgressRow[]).map((row) => row.storyline_id);
    const { data, error } = await selectStorylines<StorylineGalleryRow[]>(
      (columns) =>
        supabase
          .from('storylines')
          .select(columns)
          .in('id', orderedIds)
          // A storyline unpublished since it was read drops off the rail.
          .eq('is_public', true) as unknown as PromiseLike<QueryResult<StorylineGalleryRow[]>>,
      { withStory: true }
    );

    if (error || !data) return [];

    const rowsById = new Map(data.map((row) => [row.id, row]));
    return orderedIds
      .map((id) => rowsById.get(id))
      .filter((row): row is StorylineGalleryRow => !!row);
  } catch (error) {
    console.warn('Failed to fetch continue-reading rail:', error);
    return [];
  }
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
  requestedMode: GalleryAudienceMode = 'all'
): Promise<GalleryPage> {
  const supabase = await createClient();
  const mode = await resolveEffectiveAudienceMode(requestedMode);
  const rangeEnd = offset + limit - 1;
  const lane: GalleryLane = filters.type === 'vertical' ? 'vertical' : 'storylines';

  // Fail closed: no trustworthy age column means no kids listing.
  if (kidsEligibilityUnavailable(mode)) {
    console.warn('Kids listing requested but age_group is unavailable (migration 089 not applied).');
    return emptyGalleryPage();
  }

  const gateActive = await moderationGateActive();

  // `count: 'exact'` is a second scan of the filtered set. The client only
  // needs the total once per filter combination, so later pages skip it.
  const wantsCount = offset === 0;

  const { data: storylines, count, error } = await selectStorylines<StorylineGalleryRow[]>(
    (columns) => {
      let query = supabase
        .from('storylines')
        .select(columns, wantsCount ? { count: 'exact' } : undefined)
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
  const progressById = await fetchStorylineProgress(supabase, resolvedRows.map((row) => row.id));
  const items = withProgress(resolvedRows.map(mapStorylineRow), progressById);

  return {
    items,
    // Pages past the first report 0; the client keeps the total it already has.
    total: count ?? 0,
    hasMore: typeof count === 'number'
      ? offset + items.length < count
      : items.length === limit,
  };
}
