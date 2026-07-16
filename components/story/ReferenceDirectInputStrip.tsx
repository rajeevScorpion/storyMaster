'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, X, UserPlus, ImagePlus } from 'lucide-react';
import { compressImageFile, blobToDataUrl } from '@/lib/media/clientImageCompression';
import {
  getReferenceCreationContext,
  getReferenceSetupStatus,
  uploadReferenceSource,
  removeReferenceSource,
  updateReferenceSourceDetails,
  type ReferenceCreationContext,
} from '@/app/actions/references';
import type { ReferenceKind, ReferenceSetupItemStatus } from '@/lib/types/references';
import { readOrCreateSetupId } from '@/lib/references/setup-id';
import type { ReferencePanelState } from '@/components/story/ReferencePersonalizationPanel';

interface Props {
  /** Render only when the story isn't a reel (direct mode works for images AND text). */
  active: boolean;
  /** Text-only story: show the "attach the same refs externally" hint. */
  promptOnly: boolean;
  onStateChange: (state: ReferencePanelState) => void;
}

/**
 * v2 "direct input" reference strip: a compact + button below the prompt that
 * uploads a raw character/world reference (thumbnail immediately, no AI
 * processing) with an optional name + description. The raw image is sent to the
 * image model at generation time. Self-hides unless the References feature is on
 * in 'direct' mode for this user.
 */
export default function ReferenceDirectInputStrip({ active, promptOnly, onStateChange }: Props) {
  const [context, setContext] = useState<ReferenceCreationContext | null>(null);
  const [setupId, setSetupId] = useState<string>('');
  const [items, setItems] = useState<ReferenceSetupItemStatus[]>([]);
  const [busyKind, setBusyKind] = useState<ReferenceKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const characterInputRef = useRef<HTMLInputElement | null>(null);
  const worldInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!active) return;
    setSetupId(readOrCreateSetupId());
    getReferenceCreationContext()
      .then(setContext)
      .catch(() => setContext(null));
  }, [active]);

  const refreshStatus = useCallback(async (id: string) => {
    try {
      const status = await getReferenceSetupStatus(id);
      setItems(status.items);
    } catch {
      /* ignore */
    }
  }, []);

  const isDirect = Boolean(context?.enabled && context.inputMode === 'direct');

  useEffect(() => {
    if (!setupId || !isDirect) return;
    void refreshStatus(setupId);
  }, [setupId, isDirect, refreshStatus]);

  // Report state up. Direct mode has no async processing, so refs are always
  // resolved — Start is never blocked.
  useEffect(() => {
    if (!setupId || !isDirect) return;
    onStateChange({ setupId, hasItems: items.length > 0, allResolved: true, inputMode: 'direct' });
  }, [setupId, items, isDirect, onStateChange]);

  const characterItems = items.filter((i) => i.kind === 'character');
  const worldItems = items.filter((i) => i.kind === 'world');

  const nextFreeSlot = useCallback(
    (kind: ReferenceKind, max: number): number | null => {
      const taken = new Set(items.filter((i) => i.kind === kind).map((i) => i.slotIndex));
      for (let slot = 0; slot < max; slot += 1) {
        if (!taken.has(slot)) return slot;
      }
      return null;
    },
    [items]
  );

  const handleFile = useCallback(
    async (kind: ReferenceKind, file: File | undefined) => {
      if (!file || !context) return;
      const max = kind === 'character' ? context.maxCharacterRefs : context.maxWorldRefs;
      const slotIndex = nextFreeSlot(kind, max);
      if (slotIndex === null) {
        setError(`You can add up to ${max} ${kind} reference${max === 1 ? '' : 's'}.`);
        return;
      }
      if (file.size > context.maxFileSizeMb * 1024 * 1024 * 1.5) {
        setError(`That image is too large (max ~${context.maxFileSizeMb}MB).`);
        return;
      }
      setBusyKind(kind);
      setError(null);
      try {
        const compressed = await compressImageFile(file, {
          assetType: 'character_reference',
          orientation: kind === 'character' ? 'square' : 'auto',
        });
        const dataUrl = await blobToDataUrl(compressed.file);
        await uploadReferenceSource({ setupId, kind, slotIndex, dataUrl });
        await refreshStatus(setupId);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed.');
      } finally {
        setBusyKind(null);
      }
    },
    [context, setupId, nextFreeSlot, refreshStatus]
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

  const handleSaveDetails = useCallback(
    async (sourceId: string, patch: { displayName?: string; description?: string }) => {
      // Optimistic: the local edit already shows; persist quietly.
      try {
        await updateReferenceSourceDetails(sourceId, patch);
      } catch {
        /* a failed rename is non-fatal; the image + prompt still generate */
      }
    },
    []
  );

  if (!active || !isDirect || !context) return null;

  const canAddCharacter = context.charactersEnabled && characterItems.length < context.maxCharacterRefs;
  const canAddWorld = context.worldsEnabled && worldItems.length < context.maxWorldRefs;
  if (!context.charactersEnabled && !context.worldsEnabled) return null;

  return (
    <div className="px-2 pb-1">
      <div className="flex flex-wrap items-center gap-2">
        {canAddCharacter && (
          <button
            type="button"
            disabled={busyKind !== null}
            onClick={() => characterInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs text-neutral-300 transition-colors hover:border-white/25 hover:text-neutral-100 disabled:opacity-60"
          >
            {busyKind === 'character' ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
            Add character
          </button>
        )}
        {canAddWorld && (
          <button
            type="button"
            disabled={busyKind !== null}
            onClick={() => worldInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs text-neutral-300 transition-colors hover:border-white/25 hover:text-neutral-100 disabled:opacity-60"
          >
            {busyKind === 'world' ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
            Add world
          </button>
        )}
        {items.length === 0 && (canAddCharacter || canAddWorld) && (
          <span className="text-[11px] text-neutral-600">
            <Plus size={10} className="mr-0.5 inline" />
            Attach a reference image — crop to one clear, front-facing subject for the best match.
          </span>
        )}
      </div>

      <input
        ref={characterInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          void handleFile('character', e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={worldInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          void handleFile('world', e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {items.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {items.map((item) => (
            <ReferenceChip
              key={item.sourceId}
              item={item}
              onRemove={handleRemove}
              onSaveDetails={handleSaveDetails}
            />
          ))}
        </div>
      )}

      {error && <p className="mt-1.5 text-[11px] text-rose-300">{error}</p>}

      {promptOnly && items.length > 0 && (
        <p className="mt-1.5 text-[11px] text-neutral-500">
          Generating visuals outside Kissago? Attach the same reference images there to keep the closest match.
        </p>
      )}
    </div>
  );
}

function ReferenceChip({
  item,
  onRemove,
  onSaveDetails,
}: {
  item: ReferenceSetupItemStatus;
  onRemove: (sourceId: string) => void;
  onSaveDetails: (sourceId: string, patch: { displayName?: string; description?: string }) => void;
}) {
  const [name, setName] = useState(item.displayName ?? '');
  const [description, setDescription] = useState(item.description ?? '');

  return (
    <div className="flex w-40 flex-col gap-1 rounded-xl border border-white/10 bg-neutral-900/60 p-1.5">
      <div className="relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-neutral-950">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.previewUrl ?? ''}
          alt={item.displayName ?? 'reference'}
          className="h-full w-full object-cover"
        />
        <button
          type="button"
          onClick={() => onRemove(item.sourceId)}
          className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-neutral-200 hover:bg-black/80"
          aria-label="Remove reference"
        >
          <X size={11} />
        </button>
        <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] uppercase tracking-wide text-neutral-300">
          {item.kind}
        </span>
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() !== (item.displayName ?? '') && onSaveDetails(item.sourceId, { displayName: name })}
        placeholder={item.kind === 'character' ? 'Name' : 'Label'}
        className="rounded border border-white/10 bg-neutral-900 px-1.5 py-1 text-[11px] text-neutral-200 placeholder:text-neutral-600"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => description.trim() !== (item.description ?? '') && onSaveDetails(item.sourceId, { description })}
        placeholder={item.kind === 'character' ? 'Details (optional)' : 'World notes (optional)'}
        rows={2}
        className="resize-none rounded border border-white/10 bg-neutral-900 px-1.5 py-1 text-[11px] text-neutral-200 placeholder:text-neutral-600"
      />
    </div>
  );
}
