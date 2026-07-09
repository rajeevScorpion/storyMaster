import 'server-only';

import { createHash, randomUUID } from 'crypto';
import sharp from 'sharp';
import { splitBase64DataUrl } from '@/lib/utils/data-url';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveMediaStorageConfig } from '@/lib/media/storage-config';
import { getR2ObjectBuffer, putR2Object } from '@/lib/media/r2-server';
import { parseR2Reference } from '@/lib/media/r2-reference';
import { recordMediaAsset, type MediaAssetType } from '@/lib/media/media-assets';
import { extractStoragePath } from '@/lib/supabase/storage';
import type {
  StorylineFormat,
  StorylineOrientation,
  StorylineShareCoverSource,
  StorylineShareCoverStatus,
  StorylineVisualMode,
} from '@/lib/types/database';

export const SOCIAL_SHARE_COVER_SIZE = { width: 1200, height: 630 } as const;
export const YOUTUBE_THUMBNAIL_SIZE = { width: 1280, height: 720 } as const;
export const REEL_THUMBNAIL_SIZE = { width: 1080, height: 1920 } as const;
export const STORYLINE_PUBLIC_ASSET_BUCKET = 'public-storylines';
export const STORYLINE_PRIVATE_ASSET_BUCKET = 'story-assets';
export const SOCIAL_SHARE_COVER_MIME_TYPE = 'image/webp';

const SUPPORTED_INPUT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const GLOBAL_DEFAULT_VERSION = 'global-default-v1';

type CoverBucket = typeof STORYLINE_PUBLIC_ASSET_BUCKET | typeof STORYLINE_PRIVATE_ASSET_BUCKET;
export type StorylineShareAssetKind = 'share_cover' | 'youtube_thumbnail' | 'reel_thumbnail';

export type StorylineImageSourceCrop = {
  leftRatio: number;
  topRatio: number;
  widthRatio: number;
  heightRatio: number;
};

export type StorylineShareCoverRow = {
  id: string;
  story_id?: string | null;
  user_id?: string | null;
  title: string;
  author_name?: string | null;
  cover_image_url?: string | null;
  node_path?: string[] | null;
  beats?: unknown;
  is_public?: boolean | null;
  is_vertical_story?: boolean | null;
  aspect_ratio?: string | null;
  share_cover_url?: string | null;
  share_cover_source?: StorylineShareCoverSource | null;
  share_cover_status?: StorylineShareCoverStatus | null;
  share_cover_width?: number | null;
  share_cover_height?: number | null;
  share_cover_mime_type?: string | null;
  share_cover_updated_at?: string | null;
  share_cover_version?: string | null;
  youtube_thumbnail_url?: string | null;
  youtube_thumbnail_source?: StorylineShareCoverSource | null;
  youtube_thumbnail_status?: StorylineShareCoverStatus | null;
  youtube_thumbnail_width?: number | null;
  youtube_thumbnail_height?: number | null;
  youtube_thumbnail_mime_type?: string | null;
  youtube_thumbnail_updated_at?: string | null;
  youtube_thumbnail_version?: string | null;
  reel_thumbnail_url?: string | null;
  reel_thumbnail_source?: StorylineShareCoverSource | null;
  reel_thumbnail_status?: StorylineShareCoverStatus | null;
  reel_thumbnail_width?: number | null;
  reel_thumbnail_height?: number | null;
  reel_thumbnail_mime_type?: string | null;
  reel_thumbnail_updated_at?: string | null;
  reel_thumbnail_version?: string | null;
  story_format?: StorylineFormat | null;
  story_visual_mode?: StorylineVisualMode | null;
  orientation?: StorylineOrientation | null;
};

export type ResolvedStorylineShareCover = {
  url: string;
  source: StorylineShareCoverSource;
  status: StorylineShareCoverStatus;
  width: number;
  height: number;
  mimeType: string;
  version: string;
  isFallback: boolean;
};

export type ProcessedStorylineAsset = {
  url: string;
  storagePath: string;
  source: StorylineShareCoverSource;
  status: 'ready';
  width: number;
  height: number;
  mimeType: string;
  version: string;
};

export type PublicStorylineBucketVerification = {
  bucketExists: boolean;
  bucketPublic: boolean;
  publicReadPolicyExpected: boolean;
  usableForCrawlerAssets: boolean;
  details: string[];
};

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncateForSvg(value: string, max = 64): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trim()}...`;
}

function normalizeOriginValue(value?: string | null): string | null {
  const raw = cleanString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      url.protocol = 'https:';
    }
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function isLocalOrigin(value: string | null): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function normalizeOrigin(origin?: string | null): string {
  const provided = normalizeOriginValue(origin);
  const configured = normalizeOriginValue(process.env.APP_URL) ?? normalizeOriginValue(process.env.NEXT_PUBLIC_APP_URL);
  if (provided && !isLocalOrigin(provided)) return provided;
  if (configured && !isLocalOrigin(configured)) return configured;
  return provided ?? configured ?? 'https://kissago.app';
}

function createVersion(seed?: string | null): string {
  const input = seed || `${Date.now()}:${randomUUID()}`;
  return createHash('sha1').update(input).digest('hex').slice(0, 14);
}

function getStorageReference(url: string): { bucket: CoverBucket | null; path: string | null } {
  for (const bucket of [STORYLINE_PUBLIC_ASSET_BUCKET, STORYLINE_PRIVATE_ASSET_BUCKET] as const) {
    const path = extractStoragePath(url, bucket);
    if (path) return { bucket, path };
  }
  return { bucket: null, path: null };
}

function isUsableShareUrl(value: unknown): value is string {
  const url = cleanString(value);
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.pathname.includes('/storage/v1/object/sign/')) return false;
    return true;
  } catch {
    return false;
  }
}

function clampRatio(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

async function cropImageSourceBuffer(input: Buffer, crop: StorylineImageSourceCrop): Promise<Buffer> {
  const normalized = await sharp(input, { failOn: 'none' }).rotate().toBuffer();
  const metadata = await sharp(normalized, { failOn: 'none' }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 1 || height <= 1) return normalized;

  const leftRatio = clampRatio(crop.leftRatio, 0, 0.99);
  const topRatio = clampRatio(crop.topRatio, 0, 0.99);
  const widthRatio = clampRatio(crop.widthRatio, 0.01, 1 - leftRatio);
  const heightRatio = clampRatio(crop.heightRatio, 0.01, 1 - topRatio);
  const left = Math.min(width - 1, Math.max(0, Math.floor(width * leftRatio)));
  const top = Math.min(height - 1, Math.max(0, Math.floor(height * topRatio)));
  const cropWidth = Math.max(1, Math.min(width - left, Math.round(width * widthRatio)));
  const cropHeight = Math.max(1, Math.min(height - top, Math.round(height * heightRatio)));

  return sharp(normalized, { failOn: 'none' })
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .toBuffer();
}

export function getStoryboardSharePanelSourceCrop(panelIndex = 0): StorylineImageSourceCrop {
  const clampedPanel = Math.max(0, Math.min(3, Math.floor(panelIndex)));
  const col = clampedPanel % 2;
  const row = clampedPanel >= 2 ? 1 : 0;
  const panelRatio = 0.5;
  const insetRatio = 0.0125;

  return {
    leftRatio: col * panelRatio + insetRatio,
    topRatio: row * panelRatio + insetRatio,
    widthRatio: panelRatio - insetRatio * 2,
    heightRatio: panelRatio - insetRatio * 2,
  };
}

export function isAbsoluteCrawlerSafeImageUrl(value: unknown): value is string {
  return isUsableShareUrl(value);
}

export function getGlobalDefaultShareCoverUrl(origin?: string | null): string {
  const base = normalizeOrigin(origin);
  const url = new URL('/api/storyline-og/default', base);
  url.searchParams.set('v', GLOBAL_DEFAULT_VERSION);
  return url.toString();
}

export function getStorySpecificDefaultShareCoverUrl(
  storyline: Pick<StorylineShareCoverRow, 'title' | 'author_name' | 'story_format'> | null | undefined,
  origin?: string | null
): string {
  const base = normalizeOrigin(origin);
  const url = new URL('/api/storyline-og/default', base);
  url.searchParams.set('title', storyline?.title || 'Kissago Story');
  if (storyline?.author_name) url.searchParams.set('author', storyline.author_name);
  if (storyline?.story_format) url.searchParams.set('format', storyline.story_format);
  url.searchParams.set('v', GLOBAL_DEFAULT_VERSION);
  return url.toString();
}

export async function verifyPublicStorylineBucket(
  supabase: SupabaseClient = createAdminClient()
): Promise<PublicStorylineBucketVerification> {
  const details: string[] = [];
  let bucketExists = false;
  let bucketPublic = false;
  let publicReadPolicyExpected = false;

  try {
    const { data, error } = await supabase
      .schema('storage')
      .from('buckets')
      .select('id, public')
      .eq('id', STORYLINE_PUBLIC_ASSET_BUCKET)
      .maybeSingle();

    if (error) {
      details.push(`Bucket lookup failed: ${error.message}`);
    } else {
      bucketExists = Boolean(data);
      bucketPublic = data?.public === true;
      if (!bucketExists) details.push('Bucket public-storylines does not exist.');
      if (bucketExists && !bucketPublic) details.push('Bucket public-storylines is not marked public.');
    }
  } catch (error) {
    details.push(`Bucket lookup failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }

  try {
    const { data, error } = await supabase
      .schema('pg_catalog')
      .from('pg_policies')
      .select('policyname, schemaname, tablename, cmd, qual')
      .eq('schemaname', 'storage')
      .eq('tablename', 'objects');

    if (error) {
      details.push(`Policy lookup failed: ${error.message}`);
      publicReadPolicyExpected = bucketPublic;
    } else {
      publicReadPolicyExpected = (data ?? []).some((policy: any) =>
        policy.policyname === 'Anyone can read public storyline assets' &&
        policy.cmd === 'SELECT' &&
        typeof policy.qual === 'string' &&
        policy.qual.includes(STORYLINE_PUBLIC_ASSET_BUCKET)
      );
      if (!publicReadPolicyExpected) {
        details.push('Expected public SELECT policy for public-storylines was not found.');
      }
    }
  } catch (error) {
    details.push(`Policy lookup failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    publicReadPolicyExpected = bucketPublic;
  }

  return {
    bucketExists,
    bucketPublic,
    publicReadPolicyExpected,
    usableForCrawlerAssets: bucketExists && bucketPublic && publicReadPolicyExpected,
    details,
  };
}

function parseDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } {
  const parsed = splitBase64DataUrl(dataUrl);
  if (!parsed) {
    throw new Error('Invalid image data URL.');
  }
  const mimeType = parsed.mimeType;
  if (!SUPPORTED_INPUT_MIME_TYPES.has(mimeType)) {
    throw new Error('Use a JPG, PNG, or WebP image.');
  }
  return { buffer: Buffer.from(parsed.base64, 'base64'), mimeType };
}

export async function readImageSourceBuffer(
  sourceUrlOrDataUrl: string,
  supabase: SupabaseClient = createAdminClient()
): Promise<{ buffer: Buffer; mimeType: string | null }> {
  if (sourceUrlOrDataUrl.startsWith('data:')) {
    return parseDataUrl(sourceUrlOrDataUrl);
  }

  if (parseR2Reference(sourceUrlOrDataUrl)) {
    const object = await getR2ObjectBuffer(sourceUrlOrDataUrl);
    if (!object) {
      throw new Error('Failed to download source image from R2.');
    }
    return {
      buffer: object.buffer,
      mimeType: object.contentType,
    };
  }

  const storage = getStorageReference(sourceUrlOrDataUrl);
  if (storage.bucket && storage.path) {
    const { data, error } = await supabase.storage.from(storage.bucket).download(storage.path);
    if (error || !data) {
      throw new Error(`Failed to download source image: ${error?.message || 'not found'}`);
    }
    return {
      buffer: Buffer.from(await data.arrayBuffer()),
      mimeType: data.type || null,
    };
  }

  const response = await fetch(sourceUrlOrDataUrl, {
    headers: {
      'User-Agent': 'KissagoSocialCoverProcessor/1.0',
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`Source image returned HTTP ${response.status}.`);
  }
  const contentType = response.headers.get('content-type');
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: contentType,
  };
}

export async function processCoverImageBuffer(
  input: Buffer,
  target: { width: number; height: number },
  options: { sourceCrop?: StorylineImageSourceCrop | null } = {}
): Promise<{ buffer: Buffer; width: number; height: number; mimeType: string }> {
  const source = options.sourceCrop ? await cropImageSourceBuffer(input, options.sourceCrop) : input;
  const output = await sharp(source, { failOn: 'none' })
    .rotate()
    .resize(target.width, target.height, {
      fit: 'cover',
      position: sharp.strategy.attention,
    })
    // Client uploads may already be optimized, so keep server-side normalization
    // at a high quality to avoid visible double-compression artifacts.
    .webp({ quality: 90, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: output.data,
    width: output.info.width,
    height: output.info.height,
    mimeType: SOCIAL_SHARE_COVER_MIME_TYPE,
  };
}

async function validateSourceImageForKind(
  input: Buffer,
  kind: StorylineShareAssetKind
): Promise<void> {
  if (kind === 'share_cover') {
    return;
  }

  const metadata = await sharp(input, { failOn: 'none' }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) {
    throw new Error('Could not inspect image dimensions.');
  }

  const target = getTargetForKind(kind);
  const ratio = width / height;
  const targetRatio = target.width / target.height;
  const tolerance = 0.02;
  if (Math.abs(ratio - targetRatio) > tolerance) {
    throw new Error(kind === 'youtube_thumbnail'
      ? 'YouTube thumbnails must use a 16:9 aspect ratio.'
      : 'Reel thumbnails must use a 9:16 aspect ratio.');
  }

  if (width < target.width || height < target.height) {
    throw new Error(kind === 'youtube_thumbnail'
      ? 'YouTube thumbnails must be at least 1280x720.'
      : 'Reel thumbnails must be at least 1080x1920.');
  }
}

function getTargetForKind(kind: StorylineShareAssetKind) {
  if (kind === 'youtube_thumbnail') return YOUTUBE_THUMBNAIL_SIZE;
  if (kind === 'reel_thumbnail') return REEL_THUMBNAIL_SIZE;
  return SOCIAL_SHARE_COVER_SIZE;
}

function getFolderForKind(kind: StorylineShareAssetKind): string {
  if (kind === 'youtube_thumbnail') return 'youtube-thumbnails';
  if (kind === 'reel_thumbnail') return 'reel-thumbnails';
  return 'share-covers';
}

function getAssetTypeForKind(kind: StorylineShareAssetKind): MediaAssetType {
  if (kind === 'youtube_thumbnail') return 'youtube_thumbnail';
  if (kind === 'reel_thumbnail') return 'reel_thumbnail';
  return 'share_cover';
}

async function uploadProcessedPublicAsset(input: {
  supabase: SupabaseClient;
  userId: string;
  storyId?: string | null;
  storylineId: string;
  kind: StorylineShareAssetKind;
  path: string;
  objectKey: string;
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
}): Promise<{ url: string; storagePath: string }> {
  const config = await getEffectiveMediaStorageConfig();
  const assetType = getAssetTypeForKind(input.kind);

  if (
    config.r2.enabled
    && config.settings.r2UseForCovers
    && config.settings.r2PublicDeliveryForPublishedStories
    && config.r2.publicDeliveryEnabled
  ) {
    try {
      const r2 = await putR2Object({
        access: 'public',
        objectKey: input.objectKey,
        body: input.buffer,
        contentType: input.mimeType,
        cacheControl: config.r2.cacheControlPublic,
      });
      await recordMediaAsset({
        storyId: input.storyId ?? null,
        storylineId: input.storylineId,
        userId: input.userId,
        assetType,
        storageProvider: 'r2',
        bucket: r2.bucket,
        objectKey: r2.objectKey,
        publicUrl: r2.publicUrl,
        mimeType: input.mimeType,
        sizeBytes: input.buffer.byteLength,
        width: input.width,
        height: input.height,
        isPublic: true,
        cacheControl: config.r2.cacheControlPublic,
      });
      return { url: r2.publicUrl ?? r2.urlOrReference, storagePath: r2.objectKey };
    } catch (error) {
      console.error('R2 cover upload failed; falling back to Supabase public bucket:', error instanceof Error ? error.message : error);
      if (!config.settings.r2FallbackToSupabase) {
        throw error;
      }
    }
  }

  const { error } = await input.supabase.storage
    .from(STORYLINE_PUBLIC_ASSET_BUCKET)
    .upload(input.path, input.buffer, {
      contentType: input.mimeType,
      cacheControl: '31536000',
      upsert: false,
    });

  if (error) {
    throw new Error(`Failed to upload processed cover: ${error.message}`);
  }

  const { data } = input.supabase.storage.from(STORYLINE_PUBLIC_ASSET_BUCKET).getPublicUrl(input.path);
  await recordMediaAsset({
    storyId: input.storyId ?? null,
    storylineId: input.storylineId,
    userId: input.userId,
    assetType,
    storageProvider: 'supabase',
    bucket: STORYLINE_PUBLIC_ASSET_BUCKET,
    objectKey: input.path,
    publicUrl: data.publicUrl,
    mimeType: input.mimeType,
    sizeBytes: input.buffer.byteLength,
    width: input.width,
    height: input.height,
    isPublic: true,
    cacheControl: '31536000',
  });
  return { url: data.publicUrl, storagePath: input.path };
}

export async function processAndUploadStorylineAsset(input: {
  supabase?: SupabaseClient;
  userId: string;
  storyId?: string | null;
  storylineId: string;
  kind: StorylineShareAssetKind;
  source: StorylineShareCoverSource;
  sourceUrlOrDataUrl: string;
  sourceCrop?: StorylineImageSourceCrop | null;
  versionSeed?: string | null;
  enforceSourceDimensions?: boolean;
}): Promise<ProcessedStorylineAsset> {
  const supabase = input.supabase ?? createAdminClient();
  const target = getTargetForKind(input.kind);
  const source = await readImageSourceBuffer(input.sourceUrlOrDataUrl, supabase);
  if (source.mimeType && !SUPPORTED_INPUT_MIME_TYPES.has(source.mimeType.split(';')[0])) {
    throw new Error('Use a JPG, PNG, or WebP image.');
  }
  if (input.enforceSourceDimensions) {
    await validateSourceImageForKind(source.buffer, input.kind);
  }

  const processed = await processCoverImageBuffer(source.buffer, target, { sourceCrop: input.sourceCrop });
  const version = createVersion(input.versionSeed ?? input.sourceUrlOrDataUrl);
  const path = `${input.userId}/${input.storylineId}/${getFolderForKind(input.kind)}/${version}.webp`;
  const objectKey = `stories/${input.storyId ?? input.storylineId}/covers/${getFolderForKind(input.kind)}/${version}.webp`;
  const uploaded = await uploadProcessedPublicAsset({
    supabase,
    userId: input.userId,
    storyId: input.storyId,
    storylineId: input.storylineId,
    kind: input.kind,
    path,
    objectKey,
    buffer: processed.buffer,
    mimeType: processed.mimeType,
    width: processed.width,
    height: processed.height,
  });
  return {
    url: uploaded.url,
    storagePath: uploaded.storagePath,
    source: input.source,
    status: 'ready',
    width: processed.width,
    height: processed.height,
    mimeType: processed.mimeType,
    version,
  };
}

export async function createBrandedDefaultCoverBuffer(input: {
  title: string;
  authorName?: string | null;
  storyFormat?: StorylineFormat | null;
}): Promise<Buffer> {
  const title = escapeXml(truncateForSvg(input.title || 'Kissago Story', 70));
  const label = input.storyFormat === 'audio_story' ? 'Audio Story' : 'Interactive Story';
  const author = input.authorName ? `by ${escapeXml(truncateForSvg(input.authorName, 42))}` : 'Kissago';
  const svg = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#101820"/>
      <stop offset="0.52" stop-color="#193B35"/>
      <stop offset="1" stop-color="#473022"/>
    </linearGradient>
    <radialGradient id="glow" cx="75%" cy="20%" r="65%">
      <stop offset="0" stop-color="#F2C94C" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#F2C94C" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <circle cx="1030" cy="92" r="190" fill="#35D399" opacity="0.12"/>
  <circle cx="96" cy="560" r="220" fill="#60A5FA" opacity="0.11"/>
  <path d="M90 475 C245 390, 398 430, 554 344 C718 252, 890 264, 1096 156" stroke="#F8E7BA" stroke-width="3" opacity="0.18" fill="none"/>
  <text x="82" y="110" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="700" letter-spacing="6" fill="#8EE7C1">${escapeXml(label.toUpperCase())}</text>
  <foreignObject x="78" y="172" width="820" height="250">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Georgia, 'Times New Roman', serif; font-size: 76px; line-height: 1.05; font-weight: 700; color: #FFF7ED;">
      ${title}
    </div>
  </foreignObject>
  <text x="84" y="510" font-family="Inter, Arial, sans-serif" font-size="30" fill="#D7FBE8" opacity="0.92">${author}</text>
  <text x="84" y="568" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="800" fill="#FFFFFF">Kissago</text>
  <text x="228" y="568" font-family="Inter, Arial, sans-serif" font-size="24" fill="#A8B5AD">stories that branch with you</text>
</svg>`;

  const output = await sharp(Buffer.from(svg))
    .webp({ quality: 86, effort: 4 })
    .toBuffer();
  return output;
}

export async function uploadBrandedDefaultShareCover(input: {
  supabase?: SupabaseClient;
  userId: string;
  storyId?: string | null;
  storylineId: string;
  title: string;
  authorName?: string | null;
  storyFormat?: StorylineFormat | null;
}): Promise<ProcessedStorylineAsset> {
  const supabase = input.supabase ?? createAdminClient();
  const version = createVersion(`${input.storylineId}:${input.title}:branded-default`);
  const path = `${input.userId}/${input.storylineId}/share-covers/${version}.webp`;
  const buffer = await createBrandedDefaultCoverBuffer(input);
  const objectKey = `stories/${input.storyId ?? input.storylineId}/covers/share-covers/${version}.webp`;
  const uploaded = await uploadProcessedPublicAsset({
    supabase,
    userId: input.userId,
    storyId: input.storyId,
    storylineId: input.storylineId,
    kind: 'share_cover',
    path,
    objectKey,
    buffer,
    mimeType: SOCIAL_SHARE_COVER_MIME_TYPE,
    width: SOCIAL_SHARE_COVER_SIZE.width,
    height: SOCIAL_SHARE_COVER_SIZE.height,
  });
  return {
    url: uploaded.url,
    storagePath: uploaded.storagePath,
    source: 'branded_default',
    status: 'ready',
    width: SOCIAL_SHARE_COVER_SIZE.width,
    height: SOCIAL_SHARE_COVER_SIZE.height,
    mimeType: SOCIAL_SHARE_COVER_MIME_TYPE,
    version,
  };
}

export function resolveStorylineShareCover(
  storyline: StorylineShareCoverRow | null | undefined,
  options: { origin?: string | null } = {}
): ResolvedStorylineShareCover {
  if (
    storyline?.share_cover_status === 'ready' &&
    isUsableShareUrl(storyline.share_cover_url)
  ) {
    return {
      url: storyline.share_cover_url,
      source: storyline.share_cover_source ?? 'migrated_existing',
      status: 'ready',
      width: storyline.share_cover_width ?? SOCIAL_SHARE_COVER_SIZE.width,
      height: storyline.share_cover_height ?? SOCIAL_SHARE_COVER_SIZE.height,
      mimeType: storyline.share_cover_mime_type ?? SOCIAL_SHARE_COVER_MIME_TYPE,
      version: storyline.share_cover_version ?? createVersion(storyline.share_cover_url),
      isFallback: false,
    };
  }

  return {
    url: getStorySpecificDefaultShareCoverUrl(storyline, options.origin),
    source: 'branded_default',
    status: 'ready',
    width: SOCIAL_SHARE_COVER_SIZE.width,
    height: SOCIAL_SHARE_COVER_SIZE.height,
    mimeType: SOCIAL_SHARE_COVER_MIME_TYPE,
    version: GLOBAL_DEFAULT_VERSION,
    isFallback: true,
  };
}

export async function resolveStorylineShareCoverForId(
  storylineId: string,
  options: { origin?: string | null } = {}
): Promise<ResolvedStorylineShareCover> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('storylines')
      .select(`
        id,
        title,
        author_name,
        share_cover_url,
        share_cover_source,
        share_cover_status,
        share_cover_width,
        share_cover_height,
        share_cover_mime_type,
        share_cover_version,
        youtube_thumbnail_url,
        youtube_thumbnail_source,
        youtube_thumbnail_status,
        youtube_thumbnail_width,
        youtube_thumbnail_height,
        youtube_thumbnail_mime_type,
        youtube_thumbnail_version,
        reel_thumbnail_url,
        reel_thumbnail_source,
        reel_thumbnail_status,
        reel_thumbnail_width,
        reel_thumbnail_height,
        reel_thumbnail_mime_type,
        reel_thumbnail_version,
        story_format,
        story_visual_mode,
        orientation
      `)
      .eq('id', storylineId)
      .eq('is_public', true)
      .maybeSingle();

    if (error) {
      console.error('Failed to load storyline share cover:', error.message);
    }
    return resolveStorylineShareCover(data as StorylineShareCoverRow | null, options);
  } catch (error) {
    console.error('Failed to resolve storyline share cover:', error);
    return resolveStorylineShareCover(null, options);
  }
}

export function buildStorylinePublicAssetUrl(path: string): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return path;
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${STORYLINE_PUBLIC_ASSET_BUCKET}/${path}`;
}
