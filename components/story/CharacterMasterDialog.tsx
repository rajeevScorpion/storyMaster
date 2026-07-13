'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Archive, ArchiveRestore, Loader2, Save, UserRound, X } from 'lucide-react';
import {
  archiveCharacterMaster,
  unarchiveCharacterMaster,
  updateCharacterMaster,
} from '@/app/actions/character-library';
import { useMyStoriesStore } from '@/lib/store/my-stories-store';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { CharacterMaster } from '@/lib/types/character-library';

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

  if (typeof document === 'undefined') return null;

  const isArchived = Boolean(master?.archivedAt);
  const thumbnail = master?.portraitUrl ?? master?.referenceSheetUrl;
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
            className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-white/10 bg-neutral-950/95 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-start gap-4 border-b border-white/5 p-5">
              <span className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-neutral-800">
                {thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbnail} alt={master.name} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center">
                    <UserRound className="h-7 w-7 text-neutral-600" />
                  </span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-serif text-neutral-100">{master.name}</h2>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {isArchived ? 'Archived library character' : 'In your library'}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={saving || archiving}
                className="rounded-full p-2 text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-200 disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
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
