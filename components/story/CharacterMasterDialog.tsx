'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { Archive, ArchiveRestore, BookOpen, Clock, ExternalLink, Loader2, Save, UserRound, X } from 'lucide-react';
import {
  archiveCharacterMaster,
  listStoriesUsingCharacterMaster,
  unarchiveCharacterMaster,
  updateCharacterMaster,
  type CharacterStoryUsage,
} from '@/app/actions/character-library';
import { useMyStoriesStore } from '@/lib/store/my-stories-store';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import CharacterAvatar from './CharacterAvatar';
import StoryboardThumbnail from './StoryboardThumbnail';
import type { CharacterMaster } from '@/lib/types/character-library';

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export interface CharacterMasterDialogProps {
  master: CharacterMaster | null;
  onClose: () => void;
}

/**
 * Pack 2 library character detail: view and edit identity metadata, archive or
 * restore. Edits change only the master copy — stories that already use this
 * character keep their local instance untouched.
 */
export default function CharacterMasterDialog({ master, onClose }: CharacterMasterDialogProps) {
  const updateCharacter = useMyStoriesStore((s) => s.updateCharacter);

  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [appearance, setAppearance] = useState('');
  const [personality, setPersonality] = useState('');
  const [roleNotes, setRoleNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [usage, setUsage] = useState<CharacterStoryUsage[] | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  useEffect(() => {
    if (!master) return;
    setName(master.name);
    setType(master.type);
    setAppearance(master.appearanceSummary);
    setPersonality(master.personalitySummary);
    setRoleNotes(master.roleNotes ?? '');
    setError(null);
    setNotice(null);
  }, [master]);

  // Lazily resolve the stories this character appears in when the dialog opens.
  useEffect(() => {
    if (!master) {
      setUsage(null);
      return;
    }
    let cancelled = false;
    setUsageLoading(true);
    setUsage(null);
    listStoriesUsingCharacterMaster(master.id)
      .then((rows) => {
        if (!cancelled) setUsage(rows);
      })
      .catch(() => {
        if (!cancelled) setUsage([]);
      })
      .finally(() => {
        if (!cancelled) setUsageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [master]);

  if (typeof document === 'undefined') return null;

  const isArchived = Boolean(master?.archivedAt);
  const thumbnail = master?.portraitUrl ?? master?.referenceSheetUrl;
  // Prefer the reference sheet for the banner — it's the multi-panel grid the
  // user wants to see at full width; portrait is the fallback.
  const sheetBanner = master?.referenceSheetUrl ?? master?.portraitUrl;
  const isDirty = Boolean(
    master &&
      (name !== master.name ||
        type !== master.type ||
        appearance !== master.appearanceSummary ||
        personality !== master.personalitySummary ||
        roleNotes !== (master.roleNotes ?? ''))
  );

  const handleSave = async () => {
    if (!master || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateCharacterMaster(master.id, {
        name,
        type,
        appearanceSummary: appearance,
        personalitySummary: personality,
        roleNotes: roleNotes.trim() ? roleNotes : null,
      });
      updateCharacter(master.id, updated);
      setNotice('Saved. Stories already using this character are unchanged.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the character.');
    } finally {
      setSaving(false);
    }
  };

  const handleArchiveToggle = async () => {
    if (!master || archiving) return;
    setArchiving(true);
    setError(null);
    try {
      if (isArchived) {
        await unarchiveCharacterMaster(master.id);
        updateCharacter(master.id, { archivedAt: null });
      } else {
        await archiveCharacterMaster(master.id);
        updateCharacter(master.id, { archivedAt: new Date().toISOString() });
      }
      setShowArchiveConfirm(false);
      onClose();
    } catch (archiveError) {
      setShowArchiveConfirm(false);
      setError(
        archiveError instanceof Error ? archiveError.message : 'Could not update the character.'
      );
    } finally {
      setArchiving(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      {master && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving && !archiving) onClose();
          }}
        >
          <motion.section
            role="dialog"
            aria-label={`Character ${master.name}`}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-neutral-950/95 shadow-2xl backdrop-blur-xl"
          >
            {sheetBanner ? (
              // Full-width character sheet: object-contain so multi-panel grids
              // keep every view. Close button floats over the top-right corner.
              <div className="relative shrink-0">
                <CharacterAvatar
                  src={sheetBanner}
                  alt={master.name}
                  imgClassName="max-h-[40vh] w-full bg-neutral-900 object-contain"
                  fallback={
                    <div className="flex h-32 w-full items-center justify-center bg-neutral-900">
                      <UserRound className="h-10 w-10 text-neutral-700" />
                    </div>
                  }
                />
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving || archiving}
                  className="absolute right-3 top-3 rounded-full bg-black/50 p-2 text-neutral-200 backdrop-blur-md transition-colors hover:bg-black/70 hover:text-white disabled:opacity-50"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}

            <div className={`flex items-start gap-4 border-b border-white/5 ${sheetBanner ? 'px-5 py-4' : 'p-5'}`}>
              {!sheetBanner && (
                <span className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-neutral-800">
                  <CharacterAvatar
                    src={thumbnail}
                    alt={master.name}
                    imgClassName="h-full w-full object-cover"
                    fallback={
                      <span className="flex h-full w-full items-center justify-center">
                        <UserRound className="h-7 w-7 text-neutral-600" />
                      </span>
                    }
                  />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-serif text-neutral-100">{master.name}</h2>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {isArchived ? 'Archived library character' : 'In your library'}
                </p>
              </div>
              {!sheetBanner && (
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving || archiving}
                  className="rounded-full p-2 text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-200 disabled:opacity-50"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <label className="block">
                <span className="text-xs font-sans uppercase tracking-wider text-neutral-500">Name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={saving}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-neutral-900/70 px-3 py-2 text-sm text-neutral-100 focus:border-emerald-400/40 focus:outline-none focus:ring-1 focus:ring-emerald-400/40 disabled:opacity-60"
                />
              </label>
              <label className="block">
                <span className="text-xs font-sans uppercase tracking-wider text-neutral-500">Type</span>
                <input
                  value={type}
                  onChange={(event) => setType(event.target.value)}
                  disabled={saving}
                  placeholder="e.g. brave fox, young inventor"
                  className="mt-1 w-full rounded-xl border border-white/10 bg-neutral-900/70 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-emerald-400/40 focus:outline-none focus:ring-1 focus:ring-emerald-400/40 disabled:opacity-60"
                />
              </label>
              <label className="block">
                <span className="text-xs font-sans uppercase tracking-wider text-neutral-500">Appearance</span>
                <textarea
                  value={appearance}
                  onChange={(event) => setAppearance(event.target.value)}
                  rows={3}
                  disabled={saving}
                  className="mt-1 w-full resize-none rounded-xl border border-white/10 bg-neutral-900/70 px-3 py-2 text-sm text-neutral-100 focus:border-emerald-400/40 focus:outline-none focus:ring-1 focus:ring-emerald-400/40 disabled:opacity-60"
                />
              </label>
              <label className="block">
                <span className="text-xs font-sans uppercase tracking-wider text-neutral-500">Personality</span>
                <textarea
                  value={personality}
                  onChange={(event) => setPersonality(event.target.value)}
                  rows={3}
                  disabled={saving}
                  className="mt-1 w-full resize-none rounded-xl border border-white/10 bg-neutral-900/70 px-3 py-2 text-sm text-neutral-100 focus:border-emerald-400/40 focus:outline-none focus:ring-1 focus:ring-emerald-400/40 disabled:opacity-60"
                />
              </label>
              <label className="block">
                <span className="text-xs font-sans uppercase tracking-wider text-neutral-500">
                  Role notes <span className="normal-case text-neutral-600">(optional)</span>
                </span>
                <textarea
                  value={roleNotes}
                  onChange={(event) => setRoleNotes(event.target.value)}
                  rows={2}
                  disabled={saving}
                  placeholder="How this character usually fits into a story."
                  className="mt-1 w-full resize-none rounded-xl border border-white/10 bg-neutral-900/70 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-emerald-400/40 focus:outline-none focus:ring-1 focus:ring-emerald-400/40 disabled:opacity-60"
                />
              </label>

              {error && <p className="text-xs leading-snug text-rose-300">{error}</p>}
              {notice && <p className="text-xs leading-snug text-emerald-300">{notice}</p>}

              <div className="pt-2">
                <h3 className="text-xs font-sans uppercase tracking-wider text-neutral-500">Appears in</h3>
                {usageLoading ? (
                  <div className="mt-2 space-y-2">
                    {[0, 1].map((i) => (
                      <div
                        key={i}
                        className="h-[68px] animate-pulse rounded-xl border border-white/5 bg-neutral-900/40"
                      />
                    ))}
                  </div>
                ) : !usage || usage.length === 0 ? (
                  <p className="mt-2 text-xs text-neutral-600">Not used in any stories yet.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {usage.map((story) => (
                      <Link
                        key={story.id}
                        href={`/story/${story.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex items-center gap-3 rounded-xl border border-white/5 bg-neutral-900/40 p-2.5 transition-colors hover:border-white/15 hover:bg-neutral-900/70"
                      >
                        <div className="relative h-12 w-[68px] shrink-0 overflow-hidden rounded-lg border border-white/5 bg-neutral-800/60">
                          {story.thumbnail_url ? (
                            <StoryboardThumbnail
                              src={story.thumbnail_url}
                              alt={story.title}
                              sizes="68px"
                              isPreviewing={false}
                              previewSessionId={0}
                              isStoryboard={story.thumbnail_is_storyboard}
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <BookOpen className="h-4 w-4 text-neutral-700" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-neutral-200 transition-colors group-hover:text-white">
                            {story.title || 'Untitled story'}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                            {story.isOrigin && (
                              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-emerald-400">
                                origin
                              </span>
                            )}
                            <span
                              className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest ${
                                story.is_archived
                                  ? 'bg-neutral-500/10 text-neutral-500'
                                  : story.status === 'completed'
                                    ? 'bg-emerald-500/10 text-emerald-400'
                                    : 'bg-amber-500/10 text-amber-400'
                              }`}
                            >
                              {story.is_archived ? 'archived' : story.status}
                            </span>
                            {typeof story.episode_number === 'number' && story.episode_number > 0 && (
                              <span className="whitespace-nowrap rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-indigo-300">
                                Ep {story.episode_number}
                              </span>
                            )}
                            <span className="flex items-center gap-1 whitespace-nowrap text-[10px] text-neutral-600">
                              <Clock className="h-3 w-3" />
                              {formatRelativeDate(story.updated_at)}
                            </span>
                          </div>
                        </div>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-neutral-600 transition-colors group-hover:text-neutral-400" />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-white/5 p-5">
              <button
                type="button"
                onClick={() => (isArchived ? void handleArchiveToggle() : setShowArchiveConfirm(true))}
                disabled={saving || archiving}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-4 py-2 text-xs font-medium text-neutral-300 transition-colors hover:border-white/20 hover:text-white disabled:opacity-50"
              >
                {archiving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isArchived ? (
                  <ArchiveRestore className="h-3.5 w-3.5" />
                ) : (
                  <Archive className="h-3.5 w-3.5" />
                )}
                {isArchived ? 'Restore' : 'Archive'}
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || archiving || !isDirty || !name.trim()}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400 px-5 py-2 text-xs font-semibold text-neutral-950 transition-colors hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save changes
              </button>
            </div>
          </motion.section>

          <ConfirmDialog
            open={showArchiveConfirm}
            title="Archive this character?"
            message="The character is hidden from your library and pickers but nothing is deleted. Stories already using it are unaffected, and you can restore it anytime."
            confirmLabel="Archive"
            cancelLabel="Keep"
            busy={archiving}
            onConfirm={() => void handleArchiveToggle()}
            onCancel={() => setShowArchiveConfirm(false)}
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
