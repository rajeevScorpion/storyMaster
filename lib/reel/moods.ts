export interface ReelMoodRecord {
  id: string;
  name: string;
  slug: string;
  promptDefiner: string;
  status: 'draft' | 'published' | 'archived';
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export function mapReelMoodRow(row: Record<string, unknown>): ReelMoodRecord {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    slug: String(row.slug ?? ''),
    promptDefiner: String(row.prompt_definer ?? ''),
    status: (row.status as ReelMoodRecord['status']) ?? 'draft',
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    publishedAt: row.published_at != null ? String(row.published_at) : null,
  };
}

export function slugifyMoodName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
