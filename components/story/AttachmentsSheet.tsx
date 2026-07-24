'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { UserRound, X } from 'lucide-react';
import CharacterAvatar from './CharacterAvatar';
import type { Character } from '@/lib/types/story';
import type { CharacterMaster } from '@/lib/types/character-library';
import type { ReferenceKind, ReferenceSetupItemStatus } from '@/lib/types/references';

export interface AttachmentsLibraryData {
  characters: CharacterMaster[];
  selected: Character[];
  onToggle: (master: CharacterMaster) => void;
  onRemoveSelected: (character: Character) => void;
  error?: string | null;
}

/**
 * A reference image that is already on screen but not yet stored. Rendered from
 * a local object URL the instant the file is picked, so the upload never shows
 * an empty box — the phases only drive the progress line underneath it.
 */
export interface PendingReferenceUpload {
  tempId: string;
  kind: ReferenceKind;
  previewUrl: string;
  phase: 'compressing' | 'uploading' | 'done';
  error?: string;
}

const PHASE_PROGRESS: Record<PendingReferenceUpload['phase'], string> = {
  compressing: '35%',
  uploading: '75%',
  done: '100%',
};

const PHASE_LABEL: Record<PendingReferenceUpload['phase'], string> = {
  compressing: 'Compressing…',
  uploading: 'Uploading…',
  done: 'Added',
};

/**
 * Everything a story has attached — uploaded character/world reference images
 * and picked library characters — lives here instead of inside the prompt box.
 * Keeping it in an overlay means adding an attachment can never grow or break
 * the composer, and the reference name/description fields get room to type on a
 * phone. Bottom sheet on mobile, centered modal from `sm` up.
 */
export default function AttachmentsSheet({
  open,
  onClose,
  library,
  referenceItems,
  pendingUploads,
  onRemoveReference,
  onDismissPending,
  onSaveReferenceDetails,
  referenceError,
  promptOnly,
}: {
  open: boolean;
  onClose: () => void;
  library?: AttachmentsLibraryData;
  referenceItems: ReferenceSetupItemStatus[];
  pendingUploads: PendingReferenceUpload[];
  onRemoveReference: (sourceId: string) => void;
  onDismissPending: (tempId: string) => void;
  onSaveReferenceDetails: (sourceId: string, patch: { displayName?: string; description?: string }) => void;
  referenceError?: string | null;
  promptOnly?: boolean;
}) {
  const hasLibrary = Boolean(
    library && (library.characters.length > 0 || library.selected.length > 0)
  );
  const hasReferences = referenceItems.length > 0 || pendingUploads.length > 0;
  const isEmpty = !hasLibrary && !hasReferences;

  // Portalled to the body: the landing composer that renders this sits inside an
  // animated `motion.div` whose transform creates a stacking context, which
  // would otherwise let later siblings (the prompt carousel, Advanced Options)
  // paint straight through the sheet regardless of its z-index.
  const content = (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            role="dialog"
            aria-modal="true"
            aria-label="Characters and worlds"
            className="relative flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-neutral-900 text-left shadow-2xl sm:max-w-lg sm:rounded-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h2 className="text-sm font-medium text-neutral-100">Characters and worlds</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-white/5 hover:text-neutral-100"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain p-4">
              {isEmpty && (
                <p className="py-6 text-center text-xs text-neutral-500">
                  Nothing attached yet. Use the + button to bring in a saved character or upload a
                  reference image.
                </p>
              )}

              {hasReferences && (
                <section>
                  <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                    Reference images
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {pendingUploads.map((upload) => (
                      <PendingChip key={upload.tempId} upload={upload} onDismiss={onDismissPending} />
                    ))}
                    {referenceItems.map((item) => (
                      <ReferenceChip
                        key={item.sourceId}
                        item={item}
                        onRemove={onRemoveReference}
                        onSaveDetails={onSaveReferenceDetails}
                      />
                    ))}
                  </div>
                  {promptOnly && (
                    <p className="mt-2 text-[11px] text-neutral-500">
                      Generating visuals outside Kissago? Attach the same reference images there to
                      keep the closest match.
                    </p>
                  )}
                </section>
              )}

              {hasLibrary && library && (
                <section>
                  <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                    Your characters
                  </h3>

                  {library.selected.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-2">
                      {library.selected.map((character) => (
                        <span
                          key={character.masterId ?? character.id}
                          className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 py-1 pl-1 pr-2 text-xs text-emerald-100"
                        >
                          <CharacterAvatar
                            src={character.portraitUrl ?? character.referenceSheetUrl}
                            alt=""
                            imgClassName="h-5 w-5 rounded-full border border-white/10 object-cover"
                            fallback={<UserRound className="h-3.5 w-3.5 text-emerald-300/70" />}
                          />
                          {character.name}
                          <button
                            type="button"
                            onClick={() => library.onRemoveSelected(character)}
                            className="rounded-full p-0.5 text-emerald-300/70 transition-colors hover:bg-white/10 hover:text-emerald-100"
                            aria-label={`Remove ${character.name}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {library.characters.map((master) => {
                      const isSelected = library.selected.some(
                        (character) => character.masterId === master.id
                      );
                      return (
                        <button
                          key={master.id}
                          type="button"
                          onClick={() => library.onToggle(master)}
                          aria-pressed={isSelected}
                          className={`inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs transition-colors ${
                            isSelected
                              ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100'
                              : 'border-white/10 bg-neutral-950/60 text-neutral-300 hover:border-white/20'
                          }`}
                        >
                          <CharacterAvatar
                            src={master.portraitUrl ?? master.referenceSheetUrl}
                            alt=""
                            imgClassName="h-6 w-6 rounded-full border border-white/10 object-cover"
                            fallback={
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-800">
                                <UserRound className="h-3.5 w-3.5 text-neutral-500" />
                              </span>
                            }
                          />
                          {master.name}
                        </button>
                      );
                    })}
                  </div>
                  {library.error && (
                    <p className="mt-2 text-xs leading-snug text-rose-300">{library.error}</p>
                  )}
                </section>
              )}

              {referenceError && <p className="text-[11px] text-rose-300">{referenceError}</p>}
            </div>

            <div className="border-t border-white/10 p-3">
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black transition-colors hover:bg-neutral-200"
              >
                Done
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(content, document.body);
}

function PendingChip({
  upload,
  onDismiss,
}: {
  upload: PendingReferenceUpload;
  onDismiss: (tempId: string) => void;
}) {
  const failed = Boolean(upload.error);

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-white/10 bg-neutral-950/60 p-1.5">
      <div className="relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-neutral-950">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={upload.previewUrl} alt="" className="h-full w-full object-cover" />
        {!failed && upload.phase !== 'done' && <div className="absolute inset-0 bg-black/40" />}
        <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] uppercase tracking-wide text-neutral-300">
          {upload.kind}
        </span>
        {failed && (
          <button
            type="button"
            onClick={() => onDismiss(upload.tempId)}
            className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-neutral-200 hover:bg-black/80"
            aria-label="Dismiss failed upload"
          >
            <X size={11} />
          </button>
        )}
      </div>

      <div
        className="h-1 w-full overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-label={failed ? 'Upload failed' : PHASE_LABEL[upload.phase]}
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${
            failed ? 'bg-rose-500' : 'bg-emerald-500'
          }`}
          style={{ width: failed ? '100%' : PHASE_PROGRESS[upload.phase] }}
        />
      </div>
      <p className={`truncate text-[10px] ${failed ? 'text-rose-300' : 'text-neutral-400'}`}>
        {failed ? upload.error : PHASE_LABEL[upload.phase]}
      </p>
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
    <div className="flex flex-col gap-1 rounded-xl border border-white/10 bg-neutral-950/60 p-1.5">
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
