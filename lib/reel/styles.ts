import type { PlanKey } from '@/lib/types/pricing';

export const REEL_VISUAL_STYLE_STATUSES = ['draft', 'published', 'archived'] as const;
export type ReelVisualStyleStatus = (typeof REEL_VISUAL_STYLE_STATUSES)[number];

export interface ReelTextOverlayStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  color?: string;
  shadowColor?: string;
  shadowBlur?: number;
  backgroundColor?: string;
  backgroundOpacity?: number;
  position?: 'lower' | 'middle' | 'upper';
  align?: 'left' | 'center' | 'right';
}

export interface ReelVisualStyleRecord {
  id: string;
  name: string;
  slug: string;
  status: ReelVisualStyleStatus;
  minPlan: PlanKey;
  promptDefiner: string;
  sampleImageUrl: string | null;
  sampleR2ObjectKey: string | null;
  sampleR2Bucket: string | null;
  thumbnailUrl: string | null;
  thumbnailR2ObjectKey: string | null;
  thumbnailR2Bucket: string | null;
  textOverlayStyle: ReelTextOverlayStyle;
  noFaceDefault: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface ReelVisualStyleCard extends ReelVisualStyleRecord {
  isLocked: boolean;
}

export interface ReelVisualStyleRuntime {
  id: string;
  name: string;
  slug: string;
  minPlan: PlanKey;
  promptDefiner: string;
  textOverlayStyle: ReelTextOverlayStyle;
  noFaceDefault: boolean;
}

export const DEFAULT_REEL_TEXT_OVERLAY_STYLE: Required<ReelTextOverlayStyle> = {
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 16,
  fontWeight: 600,
  color: '#ffffff',
  shadowColor: 'rgba(0,0,0,0.72)',
  shadowBlur: 14,
  backgroundColor: 'rgba(0,0,0,0.32)',
  backgroundOpacity: 0.32,
  position: 'lower',
  align: 'center',
};

const PLAN_RANK: Record<PlanKey, number> = {
  free: 0,
  plus: 1,
  studio: 2,
};

export function normalizePlanKey(value: unknown): PlanKey {
  return value === 'plus' || value === 'studio' ? value : 'free';
}

export function canUseReelVisualStyle(userPlan: PlanKey | string | null | undefined, minPlan: PlanKey | string | null | undefined): boolean {
  const current = normalizePlanKey(userPlan);
  const required = normalizePlanKey(minPlan);
  return PLAN_RANK[current] >= PLAN_RANK[required];
}

export function normalizeReelTextOverlayStyle(value: unknown): ReelTextOverlayStyle {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const position = raw.position === 'upper' || raw.position === 'middle' || raw.position === 'lower'
    ? raw.position
    : DEFAULT_REEL_TEXT_OVERLAY_STYLE.position;
  const align = raw.align === 'left' || raw.align === 'right' || raw.align === 'center'
    ? raw.align
    : DEFAULT_REEL_TEXT_OVERLAY_STYLE.align;
  const fontSize = Number(raw.fontSize);
  const shadowBlur = Number(raw.shadowBlur);
  const backgroundOpacity = Number(raw.backgroundOpacity);

  return {
    fontFamily: typeof raw.fontFamily === 'string' && raw.fontFamily.trim()
      ? raw.fontFamily.trim()
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.fontFamily,
    fontSize: Number.isFinite(fontSize)
      ? Math.max(8, Math.min(80, Math.round(fontSize)))
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.fontSize,
    fontWeight: typeof raw.fontWeight === 'string' || typeof raw.fontWeight === 'number'
      ? raw.fontWeight
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.fontWeight,
    color: typeof raw.color === 'string' && raw.color.trim()
      ? raw.color.trim()
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.color,
    shadowColor: typeof raw.shadowColor === 'string' && raw.shadowColor.trim()
      ? raw.shadowColor.trim()
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.shadowColor,
    shadowBlur: Number.isFinite(shadowBlur)
      ? Math.max(0, Math.min(40, Math.round(shadowBlur)))
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.shadowBlur,
    backgroundColor: typeof raw.backgroundColor === 'string' && raw.backgroundColor.trim()
      ? raw.backgroundColor.trim()
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.backgroundColor,
    backgroundOpacity: Number.isFinite(backgroundOpacity)
      ? Math.max(0, Math.min(1, backgroundOpacity))
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.backgroundOpacity,
    position,
    align,
  };
}

export function mapReelVisualStyleRow(row: Record<string, unknown>): ReelVisualStyleRecord {
  return {
    id: String(row.id),
    name: String(row.name ?? 'Untitled style'),
    slug: String(row.slug ?? ''),
    status: row.status === 'published' || row.status === 'archived' ? row.status : 'draft',
    minPlan: normalizePlanKey(row.min_plan),
    promptDefiner: String(row.prompt_definer ?? ''),
    sampleImageUrl: typeof row.sample_image_url === 'string' ? row.sample_image_url : null,
    sampleR2ObjectKey: typeof row.sample_r2_object_key === 'string' ? row.sample_r2_object_key : null,
    sampleR2Bucket: typeof row.sample_r2_bucket === 'string' ? row.sample_r2_bucket : null,
    thumbnailUrl: typeof row.thumbnail_url === 'string' ? row.thumbnail_url : null,
    thumbnailR2ObjectKey: typeof row.thumbnail_r2_object_key === 'string' ? row.thumbnail_r2_object_key : null,
    thumbnailR2Bucket: typeof row.thumbnail_r2_bucket === 'string' ? row.thumbnail_r2_bucket : null,
    textOverlayStyle: normalizeReelTextOverlayStyle(row.text_overlay_style),
    noFaceDefault: row.no_face_default !== false,
    sortOrder: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    publishedAt: typeof row.published_at === 'string' ? row.published_at : null,
  };
}
