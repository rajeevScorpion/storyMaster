'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, UserPlus, UserRound } from 'lucide-react';
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
import type { Character } from '@/lib/types/story';
import type { CharacterMaster } from '@/lib/types/character-library';
import AttachMenu, { type AttachMenuOption } from './AttachMenu';
import AttachmentsSheet, { type PendingReferenceUpload } from './AttachmentsSheet';
import CharacterAvatar from './CharacterAvatar';

export interface AttachLibraryData {
  /** False while the character-universe settings are still loading. */
  settingsLoaded: boolean;
  /** Character mixing + library are both switched on for this user. */
  enabled: boolean;
  characters: CharacterMaster[];
  selected: Character[];
  onToggle: (master: CharacterMaster) => void;
  onRemoveSelected: (character: Character) => void;
  error?: string | null;
}

interface Props {
  /** Render only when the story isn't a reel (direct mode works for images AND text). */
  active: boolean;
  /** Text-only story: show the "attach the same refs externally" hint. */
  promptOnly: boolean;
  onStateChange: (state: ReferencePanelState) => void;
  /** Saved-character picker, owned by the landing screen. */
  library?: AttachLibraryData;
}

/**
 * v2 "direct input" reference strip: a single `+` button below the prompt that
 * opens a menu of attach actions — pick a saved library character, or upload a
 * raw character/world reference (thumbnail immediately, no AI processing). The
 * raw image is sent to the image model at generation time.
 *
 * Two deliberate UX rules here:
 * - The toolbar is always exactly one `+`, so it cannot overflow narrow screens
 *   the way the old inline button row did.
 * - Options whose gate is still resolving render immediately in a greyed
 *   `pending` state rather than appearing once the check lands, so the menu
 *   never changes shape under the user.
 */
export default function ReferenceDirectInputStrip({
  active,
  promptOnly,
  onStateChange,
  library,
}: Props) {
  const [context, setContext] = useState<ReferenceCreationContext | null>(null);
  // Tracked separately from `context` because the fetch also resolves to null on
  // failure — without this we could not tell "still checking" from "unavailable".
  const [contextLoaded, setContextLoaded] = useState(false);
  const [setupId, setSetupId] = useState<string>('');
  const [items, setItems] = useState<ReferenceSetupItemStatus[]>([]);
  const [busyKind, setBusyKind] = useState<ReferenceKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<PendingReferenceUpload[]>([]);
  const characterInputRef = useRef<HTMLInputElement | null>(null);
  const worldInputRef = useRef<HTMLInputElement | null>(null);
  // Object URLs backing the instant previews, revoked together on unmount.
  const objectUrlsRef = useRef<string[]>([]);

  useEffect(
    () => () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    []
  );

  useEffect(() => {
    if (!active) return;
    setSetupId(readOrCreateSetupId());
    getReferenceCreationContext()
      .then(setContext)
      .catch(() => setContext(null))
      .finally(() => setContextLoaded(true));
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
      // Show the picked image and open the sheet before any async work starts,
      // so compression + upload happen behind a visible thumbnail instead of an
      // empty wait. The progress line below the image tracks the phases.
      const tempId = `${kind}-${slotIndex}-${Date.now()}`;
      const previewUrl = URL.createObjectURL(file);
      objectUrlsRef.current.push(previewUrl);
      setPendingUploads((previous) => [...previous, { tempId, kind, previewUrl, phase: 'compressing' }]);
      setSheetOpen(true);
      setBusyKind(kind);
      setError(null);

      const patchPending = (patch: Partial<PendingReferenceUpload>) =>
        setPendingUploads((previous) =>
          previous.map((entry) => (entry.tempId === tempId ? { ...entry, ...patch } : entry))
        );

      try {
        const compressed = await compressImageFile(file, {
          assetType: 'character_reference',
          orientation: kind === 'character' ? 'square' : 'auto',
        });
        patchPending({ phase: 'uploading' });
        const dataUrl = await blobToDataUrl(compressed.file);
        await uploadReferenceSource({ setupId, kind, slotIndex, dataUrl });
        patchPending({ phase: 'done' });
        await refreshStatus(setupId);
        // The stored reference now renders in its place.
        setPendingUploads((previous) => previous.filter((entry) => entry.tempId !== tempId));
        URL.revokeObjectURL(previewUrl);
        objectUrlsRef.current = objectUrlsRef.current.filter((url) => url !== previewUrl);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Upload failed.';
        // Keep the thumbnail on screen carrying the error so the failure is
        // attached to the image it belongs to, not just a line of text.
        patchPending({ error: message });
      } finally {
        setBusyKind(null);
      }
    },
    [context, setupId, nextFreeSlot, refreshStatus]
  );

  const dismissPending = useCallback((tempId: string) => {
    setPendingUploads((previous) => {
      const target = previous.find((entry) => entry.tempId === tempId);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        objectUrlsRef.current = objectUrlsRef.current.filter((url) => url !== target.previewUrl);
      }
      return previous.filter((entry) => entry.tempId !== tempId);
    });
  }, []);

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

  if (!active) return null;

  // While a gate is still resolving its row is shown greyed rather than hidden,
  // so nothing pops into the menu a moment later.
  const refsPending = !contextLoaded;
  const characterFeatureOn = isDirect && Boolean(context?.charactersEnabled);
  const worldFeatureOn = isDirect && Boolean(context?.worldsEnabled);
  // In-flight uploads occupy their slot too, so the menu can't offer one more
  // than the limit while an upload is still settling.
  const livePending = pendingUploads.filter((entry) => !entry.error);
  const pendingOfKind = (kind: ReferenceKind) =>
    livePending.filter((entry) => entry.kind === kind).length;
  const characterSlotsFull =
    characterItems.length + pendingOfKind('character') >= (context?.maxCharacterRefs ?? 0);
  const worldSlotsFull = worldItems.length + pendingOfKind('world') >= (context?.maxWorldRefs ?? 0);
  const libraryPending = Boolean(library) && !library!.settingsLoaded;

  const options: AttachMenuOption[] = [];

  if (library && (libraryPending || library.enabled)) {
    options.push({
      id: 'library',
      label: 'Bring your characters',
      description: 'Reuse a character saved in your library',
      icon: <UserRound size={13} className="text-neutral-300" />,
      state: libraryPending ? 'pending' : library.characters.length === 0 ? 'disabled' : 'ready',
      disabledReason: 'No saved characters yet',
      onSelect: () => setSheetOpen(true),
    });
  }

  if (refsPending || characterFeatureOn) {
    options.push({
      id: 'character',
      label: 'Add character',
      description: 'Upload one clear, front-facing subject',
      icon: <UserPlus size={13} className="text-neutral-300" />,
      state: refsPending ? 'pending' : characterSlotsFull ? 'disabled' : 'ready',
      disabledReason: `Limit reached (${context?.maxCharacterRefs ?? 0})`,
      busy: busyKind === 'character',
      onSelect: () => characterInputRef.current?.click(),
    });
  }

  if (refsPending || worldFeatureOn) {
    options.push({
      id: 'world',
      label: 'Add world',
      description: 'Upload a setting to guide places and mood',
      icon: <ImagePlus size={13} className="text-neutral-300" />,
      state: refsPending ? 'pending' : worldSlotsFull ? 'disabled' : 'ready',
      disabledReason: `Limit reached (${context?.maxWorldRefs ?? 0})`,
      busy: busyKind === 'world',
      onSelect: () => worldInputRef.current?.click(),
    });
  }

  const selectedCharacters = library?.selected ?? [];
  const attachmentCount = selectedCharacters.length + items.length + livePending.length;

  // Nothing is available and nothing is attached — stay out of the way entirely.
  if (options.length === 0 && attachmentCount === 0) return null;

  return (
    <div className="px-2 pb-1">
      <div className="flex items-center gap-2">
        <AttachMenu open={menuOpen} onOpenChange={setMenuOpen} options={options} />

        {attachmentCount > 0 && (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="flex min-w-0 shrink items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] py-1 pl-1 pr-2.5 text-xs text-neutral-300 transition-colors hover:border-white/25 hover:text-neutral-100"
          >
            <span className="flex -space-x-1.5">
              {selectedCharacters.slice(0, 3).map((character) => (
                <span
                  key={character.masterId ?? character.id}
                  className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-neutral-800"
                >
                  <CharacterAvatar
                    src={character.portraitUrl ?? character.referenceSheetUrl}
                    alt=""
                    imgClassName="h-full w-full object-cover"
                    fallback={<UserRound className="h-3 w-3 text-emerald-300/70" />}
                  />
                </span>
              ))}
              {[
                ...livePending.map((entry) => ({ key: entry.tempId, url: entry.previewUrl })),
                ...items.map((item) => ({ key: item.sourceId, url: item.previewUrl ?? '' })),
              ]
                .slice(0, Math.max(0, 3 - selectedCharacters.length))
                .map((thumb) => (
                  <span
                    key={thumb.key}
                    className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-neutral-800"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumb.url} alt="" className="h-full w-full object-cover" />
                  </span>
                ))}
            </span>
            <span className="truncate">
              {attachmentCount} attached
            </span>
          </button>
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

      {error && <p className="mt-1.5 text-[11px] text-rose-300">{error}</p>}

      <AttachmentsSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        library={
          library && library.enabled
            ? {
                characters: library.characters,
                selected: library.selected,
                onToggle: library.onToggle,
                onRemoveSelected: library.onRemoveSelected,
                error: library.error,
              }
            : undefined
        }
        referenceItems={items}
        pendingUploads={pendingUploads}
        onRemoveReference={handleRemove}
        onDismissPending={dismissPending}
        onSaveReferenceDetails={handleSaveDetails}
        referenceError={error}
        promptOnly={promptOnly}
      />
    </div>
  );
}
