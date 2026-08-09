'use client';

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { BookOpen, Bookmark, BookmarkCheck, Play, Share2 } from 'lucide-react';
import { getStoryGenreLabel } from '@/lib/story/genres';
import { getStoryAudienceProfile } from '@/lib/ai/story-audience';
import type { ExpandedPanelPlacement } from '@/lib/gallery/card-expansion';
import type { GalleryItem } from '@/lib/types/database';

interface StorylineCardPanelProps {
  item: GalleryItem;
  placement: ExpandedPanelPlacement;
  /** Fixed column width when the panel sits beside a poster. */
  width: number;
  isSaved: boolean;
  isLoggedIn: boolean;
  onToggleSave: (storylineId: string, saved: boolean) => void;
  onOpen: () => void;
  onShare: () => void;
}

/**
 * The information block an expanded rail card reveals — the same set the
 * billboard shows, so a reader can judge a story from the rail instead of
 * opening it to find out what it is.
 *
 * Deliberately does not repeat the title: the artwork keeps it as the card's
 * accessible name, and the side variant centres itself against the poster so
 * dropping the title leaves no gap at the top.
 *
 * Rendered only while expanded. Keeping it mounted and collapsed would leave
 * its links and buttons in the tab order inside a zero-height box.
 */
export default function StorylineCardPanel({
  item,
  placement,
  width,
  isSaved,
  isLoggedIn,
  onToggleSave,
  onOpen,
  onShare,
}: StorylineCardPanelProps) {
  const prefersReducedMotion = useReducedMotion();

  const genreLabel = item.genre ? getStoryGenreLabel(item.genre) : null;
  // An unclassified story stays unlabelled rather than reading as "All Ages".
  const audienceLabel = item.ageGroup ? getStoryAudienceProfile(item.ageGroup).label : null;

  const progress = item.progress;
  const ctaLabel = progress?.completed
    ? 'Watch again'
    : progress && progress.beatIndex >= 1
      ? 'Continue watching'
      : 'Start watching';

  const isSide = placement === 'side';

  return (
    <motion.div
      initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: prefersReducedMotion ? 0.15 : 0.25, delay: 0.1, ease: 'easeOut' }}
      style={isSide ? { width } : undefined}
      className={`flex min-w-0 flex-col gap-2.5 ${
        isSide ? 'shrink-0 justify-center pl-3 pr-1' : 'px-1 pt-3'
      }`}
    >
      {item.intro && (
        <p className="line-clamp-3 text-xs leading-relaxed text-neutral-300">{item.intro}</p>
      )}

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11px] text-neutral-300">
        {genreLabel && (
          <span className="rounded-full border border-indigo-400/30 bg-indigo-500/15 px-2.5 py-1 font-medium text-indigo-200">
            {genreLabel}
          </span>
        )}
        {audienceLabel && (
          <span className="rounded-full border border-white/10 bg-white/10 px-2.5 py-1 font-medium text-neutral-200 backdrop-blur-sm">
            {audienceLabel}
          </span>
        )}
        {!!item.beatCount && (
          <span className="flex items-center gap-1">
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            {item.beatCount} beats
          </span>
        )}
        {item.authorName && (
          <span className="max-w-[140px] truncate text-neutral-400">by {item.authorName}</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <Link
          href={`/storyline/${item.id}`}
          onClick={onOpen}
          prefetch={false}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-neutral-950 shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-400 hover:shadow-emerald-400/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
        >
          <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
          {ctaLabel}
        </Link>

        {isLoggedIn && (
          <button
            type="button"
            onClick={() => onToggleSave(item.id, isSaved)}
            aria-pressed={isSaved}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-neutral-200 backdrop-blur-sm transition-colors hover:border-white/25 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
          >
            {isSaved ? (
              <>
                <BookmarkCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                Saved
              </>
            ) : (
              <>
                <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
                My List
              </>
            )}
          </button>
        )}

        <button
          type="button"
          onClick={onShare}
          aria-label={`Share ${item.title}`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-neutral-300 transition-colors hover:border-white/25 hover:bg-white/10 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
        >
          <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </motion.div>
  );
}
