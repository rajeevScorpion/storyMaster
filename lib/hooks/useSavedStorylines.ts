'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSavedStorylineIds } from '@/app/actions/gallery';
import { saveStorylineToProfile, unsaveStoryline } from '@/app/actions/persistence';

const EMPTY_IDS: ReadonlySet<string> = new Set<string>();

/**
 * Saved ("My List") state for a discovery surface, with an optimistic toggle
 * that reverts if the server rejects the change.
 *
 * A signed-out viewer's list is derived as empty rather than cleared in an
 * effect, so signing out cannot leave a stale set on screen for a render.
 */
export function useSavedStorylines(isSignedIn: boolean) {
  const [fetchedIds, setFetchedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isSignedIn) return;

    let cancelled = false;
    getSavedStorylineIds()
      .then((ids) => {
        if (!cancelled) setFetchedIds(new Set(ids));
      })
      .catch((error) => {
        console.error('Failed to fetch saved storyline IDs:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [isSignedIn]);

  const toggleSave = useCallback(async (storylineId: string, currentlySaved: boolean) => {
    const applyLocal = (saved: boolean) => {
      setFetchedIds((prev) => {
        const next = new Set(prev);
        if (saved) {
          next.add(storylineId);
        } else {
          next.delete(storylineId);
        }
        return next;
      });
    };

    applyLocal(!currentlySaved);

    try {
      if (currentlySaved) {
        await unsaveStoryline(storylineId);
      } else {
        await saveStorylineToProfile(storylineId);
      }
    } catch (error) {
      console.error('Failed to update saved storyline:', error);
      applyLocal(currentlySaved);
    }
  }, []);

  return {
    savedIds: (isSignedIn ? fetchedIds : EMPTY_IDS) as Set<string>,
    toggleSave,
  };
}
