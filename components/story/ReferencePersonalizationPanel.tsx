'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { compressImageFile, blobToDataUrl } from '@/lib/media/clientImageCompression';
import {
  getReferenceCreationContext,
  getReferenceSetupStatus,
  uploadReferenceSource,
  removeReferenceSource,
  enqueueReferenceAdoption,
  retryReferenceAdoption,
  type ReferenceCreationContext,
} from '@/app/actions/references';
import type { ImageModelSelection } from '@/lib/ai/image-models.shared';
import type {
  ReferenceInputMode,
  ReferenceKind,
  ReferenceSetupItemStatus,
  ReferenceSetupStatus,
} from '@/lib/types/references';
import { SETUP_ID_STORAGE_KEY, newSetupId } from '@/lib/references/setup-id';

const POLL_INTERVAL_MS = 2500;

export interface ReferencePanelState {
  setupId: string;
  hasItems: boolean;
  allResolved: boolean;
  /** Which surface reported this state, so Start can pick the right seed loader. */
  inputMode: ReferenceInputMode;
}

interface Props {
  visualStyle: string;
  imageModelSelection?: ImageModelSelection;
  /** Only render when the story will generate images and isn't a reel. */
  active: boolean;
  onStateChange: (state: ReferencePanelState) => void;
}

export default function ReferencePersonalizationPanel({
  visualStyle,
  imageModelSelection,
  active,
  onStateChange,
}: Props) {
  const [context, setContext] = useState<ReferenceCreationContext | null>(null);
  const [setupId, setSetupId] = useState<string>('');
  const [items, setItems] = useState<ReferenceSetupItemStatus[]>([]);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Resolve setup id + creation context once active.
  useEffect(() => {
    if (!active) return;
    let stored = '';
    try {
      stored = window.localStorage.getItem(SETUP_ID_STORAGE_KEY) ?? '';
    } catch {
      /* ignore */
    }
    const id = stored || newSetupId();
    try {
      window.localStorage.setItem(SETUP_ID_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
    setSetupId(id);
    getReferenceCreationContext()
      .then(setContext)
      .catch(() => setContext(null));
  }, [active]);

  const refreshStatus = useCallback(
    async (id: string) => {
      try {
        const status: ReferenceSetupStatus = await getReferenceSetupStatus(id);
        setItems(status.items);
        return status;
      } catch {
        return null;
      }
    },
    []
  );

  // Restore any existing uploads for this setup.
  useEffect(() => {
    if (!setupId || !context?.enabled) return;
    void refreshStatus(setupId);
  }, [setupId, context?.enabled, refreshStatus]);

  // Poll while any adoption is pending/processing.
  const hasPending = items.some((i) => i.status === 'pending' || i.status === 'processing');
  useEffect(() => {
    if (!setupId || !hasPending) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = setInterval(() => void refreshStatus(setupId), POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [setupId, hasPending, refreshStatus]);

  // Report state up for Start gating + seed injection. Only the adoption surface
  // reports here; in direct mode the v2 strip owns state so this stays quiet.
  useEffect(() => {
    if (!setupId || context?.inputMode !== 'adoption') return;
    const hasItems = items.length > 0;
    const allResolved = !hasPending;
    onStateChange({ setupId, hasItems, allResolved, inputMode: 'adoption' });
  }, [setupId, items, hasPending, onStateChange, context?.inputMode]);

  const characterItems = items.filter((i) => i.kind === 'character');
  const worldItems = items.filter((i) => i.kind === 'world');

  const handleUpload = useCallback(
    async (kind: ReferenceKind, slotIndex: number, file: File, displayName: string) => {
      if (!context) return;
      const slotKey = `${kind}:${slotIndex}`;
      setBusySlot(slotKey);
      setError(null);
      try {
        const compressed = await compressImageFile(file, {
          assetType: 'character_reference',
          orientation: kind === 'character' ? 'square' : 'auto',
        });
        const dataUrl = await blobToDataUrl(compressed.file);
        const uploaded = await uploadReferenceSource({
          setupId,
          kind,
          slotIndex,
          displayName: displayName.trim() || null,
          dataUrl,
        });
        // Kick off adoption immediately (durable; survives navigation).
        await enqueueReferenceAdoption({
          sourceId: uploaded.sourceId,
          visualStyle,
          imageModelSelection: imageModelSelection ?? null,
        });
        await refreshStatus(setupId);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed.');
      } finally {
        setBusySlot(null);
      }
    },
    [context, setupId, visualStyle, imageModelSelection, refreshStatus]
  );

  const handleRemove = useCallback(
    async (sourceId: string) => {
      setError(null);
      try {
        await removeReferenceSource(sourceId);
        await refreshStatus(setupId);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not remove.');
      }
    },
    [setupId, refreshStatus]
  );

  const handleRetry = useCallback(
    async (adoptionId: string) => {
      setError(null);
      try {
        await retryReferenceAdoption(adoptionId);
        await refreshStatus(setupId);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Retry failed.');
      }
    },
    [setupId, refreshStatus]
  );

  if (!active || !context?.enabled || context.inputMode !== 'adoption') return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-serif text-base text-neutral-100">Personalize with references</h3>
      </div>
      <p className="mb-4 text-xs text-neutral-500">
        Upload people, characters, or places. Kissago adopts them into your story&rsquo;s visual style —
        the upload only supplies identity and layout, never the art style. Coins are charged when an
        adoption succeeds. Only use images you have the rights to.
      </p>

      {context.charactersEnabled && (
        <ReferenceSection
          title="Character references"
          hint={`${characterItems.length}/${context.maxCharacterRefs}`}
          costLabel={context.costs.character > 0 ? `${context.costs.character} coins each` : 'Included'}
          kind="character"
          max={context.maxCharacterRefs}
          items={characterItems}
          busySlot={busySlot}
          maxFileSizeMb={context.maxFileSizeMb}
          onUpload={handleUpload}
          onRemove={handleRemove}
          onRetry={handleRetry}
        />
      )}

      {context.worldsEnabled && (
        <ReferenceSection
          title="World references"
          hint={`${worldItems.length}/${context.maxWorldRefs}`}
          costLabel={worldCostLabel(context)}
          kind="world"
          max={context.maxWorldRefs}
          items={worldItems}
          busySlot={busySlot}
          maxFileSizeMb={context.maxFileSizeMb}
          onUpload={handleUpload}
          onRemove={handleRemove}
          onRetry={handleRetry}
        />
      )}

      {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
      {hasPending && (
        <p className="mt-3 flex items-center gap-2 text-xs text-amber-200">
          <Loader2 size={12} className="animate-spin" /> Adopting references… you can keep editing;
          starting the story waits until these finish.
        </p>
      )}
    </div>
  );
}

function worldCostLabel(context: ReferenceCreationContext): string {
  const base = context.costs.world;
  const viz = context.worldAdoptionMode === 'description_plus_canonical_visual' ? context.costs.worldVisualization : 0;
  const total = base + viz;
  return total > 0 ? `${total} coins each` : 'Included';
}

interface SectionProps {
  title: string;
  hint: string;
  costLabel: string;
  kind: ReferenceKind;
  max: number;
  items: ReferenceSetupItemStatus[];
  busySlot: string | null;
  maxFileSizeMb: number;
  onUpload: (kind: ReferenceKind, slotIndex: number, file: File, displayName: string) => void;
  onRemove: (sourceId: string) => void;
  onRetry: (adoptionId: string) => void;
}

function ReferenceSection({
  title,
  hint,
  costLabel,
  kind,
  max,
  items,
  busySlot,
  maxFileSizeMb,
  onUpload,
  onRemove,
  onRetry,
}: SectionProps) {
  const bySlot = new Map(items.map((i) => [i.slotIndex, i]));
  const slots = Array.from({ length: max }, (_, i) => i);

  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-neutral-300">
          {title} <span className="text-neutral-500">{hint}</span>
        </span>
        <span className="text-neutral-500">{costLabel}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {slots.map((slotIndex) => {
          const item = bySlot.get(slotIndex);
          const slotKey = `${kind}:${slotIndex}`;
          return (
            <ReferenceSlot
              key={slotKey}
              kind={kind}
              slotIndex={slotIndex}
              item={item}
              busy={busySlot === slotKey}
              maxFileSizeMb={maxFileSizeMb}
              onUpload={onUpload}
              onRemove={onRemove}
              onRetry={onRetry}
            />
          );
        })}
      </div>
    </div>
  );
}

interface SlotProps {
  kind: ReferenceKind;
  slotIndex: number;
  item: ReferenceSetupItemStatus | undefined;
  busy: boolean;
  maxFileSizeMb: number;
  onUpload: (kind: ReferenceKind, slotIndex: number, file: File, displayName: string) => void;
  onRemove: (sourceId: string) => void;
  onRetry: (adoptionId: string) => void;
}

function ReferenceSlot({ kind, slotIndex, item, busy, maxFileSizeMb, onUpload, onRemove, onRetry }: SlotProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState('');

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > maxFileSizeMb * 1024 * 1024 * 1.5) {
      // A generous client guard; the server re-validates precisely.
      return;
    }
    onUpload(kind, slotIndex, file, name);
  };

  if (!item) {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="flex aspect-square items-center justify-center rounded-xl border border-dashed border-white/15 bg-neutral-900/50 text-neutral-500 transition-colors hover:border-white/30 hover:text-neutral-300 disabled:opacity-60"
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={kind === 'character' ? 'Name (optional)' : 'Label (optional)'}
          className="rounded-lg border border-white/10 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-200 placeholder:text-neutral-600"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-neutral-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.canonicalUrl ?? item.previewUrl ?? ''}
          alt={item.displayName ?? 'reference'}
          className="h-full w-full object-cover"
        />
        <button
          type="button"
          onClick={() => onRemove(item.sourceId)}
          className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-neutral-200 hover:bg-black/80"
          aria-label="Remove reference"
        >
          <X size={12} />
        </button>
        <div className="absolute inset-x-0 bottom-0 bg-black/50 px-1.5 py-0.5">
          <StatusChip item={item} onRetry={onRetry} />
        </div>
      </div>
      {item.displayName && <span className="truncate text-[11px] text-neutral-400">{item.displayName}</span>}
    </div>
  );
}

function StatusChip({
  item,
  onRetry,
}: {
  item: ReferenceSetupItemStatus;
  onRetry: (adoptionId: string) => void;
}) {
  if (item.status === 'ready') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-emerald-300">
        <CheckCircle2 size={10} /> Ready
      </span>
    );
  }
  if (item.status === 'failed') {
    return (
      <button
        type="button"
        onClick={() => item.adoptionId && onRetry(item.adoptionId)}
        className="flex items-center gap-1 text-[10px] text-rose-300 hover:text-rose-200"
        title={item.error ?? undefined}
      >
        <AlertCircle size={10} /> Retry
      </button>
    );
  }
  if (item.status === 'uploaded') {
    return <span className="text-[10px] text-neutral-400">Uploaded</span>;
  }
  return (
    <span className="flex items-center gap-1 text-[10px] text-amber-200">
      <Loader2 size={10} className="animate-spin" /> Adopting
    </span>
  );
}
