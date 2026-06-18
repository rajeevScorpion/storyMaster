export type OpenFlowKind = 'story' | 'reel' | 'storyline';

export interface OpenFlowNavMeta {
  kind: OpenFlowKind;
  title?: string | null;
  coverImageUrl?: string | null;
  coverIsStoryboard?: boolean;
  status?: string | null;
  beatCount?: number | null;
  userPrompt?: string | null;
}

const OPEN_FLOW_NAV_META_KEY = 'kissago-open-flow-nav-meta';
const LEGACY_STORYLINE_NAV_META_KEY = 'storyline-nav-meta';

function normalizeOpenFlowNavMeta(value: unknown): OpenFlowNavMeta | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const kind = record.kind === 'reel' || record.kind === 'storyline' ? record.kind : 'story';
  return {
    kind,
    title: typeof record.title === 'string' ? record.title : null,
    coverImageUrl: typeof record.coverImageUrl === 'string' ? record.coverImageUrl : null,
    coverIsStoryboard: record.coverIsStoryboard === true,
    status: typeof record.status === 'string' ? record.status : null,
    beatCount: typeof record.beatCount === 'number' ? record.beatCount : null,
    userPrompt: typeof record.userPrompt === 'string' ? record.userPrompt : null,
  };
}

function readJsonFromSessionStorage(key: string): unknown {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    window.sessionStorage.removeItem(key);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeOpenFlowNavMeta(meta: OpenFlowNavMeta): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(OPEN_FLOW_NAV_META_KEY, JSON.stringify(meta));
    if (meta.kind === 'storyline') {
      window.sessionStorage.removeItem(LEGACY_STORYLINE_NAV_META_KEY);
    }
  } catch {}
}

export function readOpenFlowNavMeta(expectedKind?: OpenFlowKind): OpenFlowNavMeta | null {
  const meta = normalizeOpenFlowNavMeta(readJsonFromSessionStorage(OPEN_FLOW_NAV_META_KEY));
  if (meta && (!expectedKind || meta.kind === expectedKind)) {
    return meta;
  }

  if (expectedKind === 'storyline') {
    const legacy = normalizeOpenFlowNavMeta({
      ...((readJsonFromSessionStorage(LEGACY_STORYLINE_NAV_META_KEY) as Record<string, unknown> | null) ?? {}),
      kind: 'storyline',
    });
    if (legacy?.kind === 'storyline') return legacy;
  }

  return null;
}
