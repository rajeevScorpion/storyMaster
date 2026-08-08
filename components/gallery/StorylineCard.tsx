'use client';

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { BookOpen, Bookmark, BookmarkCheck, Check, Eye, Heart, Share2 } from 'lucide-react';
import StoryboardThumbnail, { useStoryboardThumbnailPreview } from '@/components/story/StoryboardThumbnail';
import { writeOpenFlowNavMeta } from '@/lib/story/open-flow-nav';
import type { GalleryItem, GalleryRailLayout } from '@/lib/types/database';

const DEFAULT_SIZES: Record<GalleryRailLayout, string> = {
  wide: '(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 320px',
  portrait: '(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 220px',
};

interface StorylineCardProps {
  item: GalleryItem;
  layout: GalleryRailLayout;
  isSaved: boolean;
  isLoggedIn: boolean;
  /** Slot-accurate `sizes`; the storyboard crop scales it up internally. */
  sizes?: string;
  priority?: boolean;
  /** Kids surfaces omit view/like counts to avoid engagement pressure. */
  hideEngagementCounts?: boolean;
  onToggleSave: (storylineId: string, saved: boolean) => void;
}

/**
 * The single storyline card used by the rails and the browse grid. The title
 * sits on the bottom edge; hovering or focusing the card expands the intro and
 * metadata underneath it, lifting the title out of the way — collapsed content
 * takes no layout space, so the resting card is just artwork and a title.
 * Touch users get the resting state (long-press still previews storyboards;
 * the detail page carries the full metadata).
 */
export default function StorylineCard({
  item,
  layout,
  isSaved,
  isLoggedIn,
  sizes,
  priority = false,
  hideEngagementCounts = false,
  onToggleSave,
}: StorylineCardProps) {
  // Nothing to preview on a poster cover with no opening beat behind it, so the
  // hover/long-press handlers stay off rather than suppressing clicks for a
  // cycle that never plays.
  const storyboardPreview = useStoryboardThumbnailPreview(
    !!item.coverImageUrl && (item.coverIsStoryboard || !!item.openingImageUrl)
  );
  const prefersReducedMotion = useReducedMotion();

  // Reading position. The bar needs a length to divide by, so a progress row
  // written before the storyline length was known shows no bar.
  const progress = item.progress;
  const progressTotal = progress?.beatCount ?? item.beatCount ?? 0;
  const progressPercent = progress && !progress.completed && progressTotal > 1
    ? Math.min(100, Math.round((progress.beatIndex / (progressTotal - 1)) * 100))
    : 0;

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (storyboardPreview.consumeSuppressedClick(event)) return;

    writeOpenFlowNavMeta({
      kind: 'storyline',
      title: item.title,
      coverImageUrl: item.coverImageUrl,
      coverIsStoryboard: item.coverIsStoryboard,
      beatCount: item.beatCount,
    });
  };

  const handleShare = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const url = `${window.location.origin}/storyline/${item.id}`;
    if (navigator.share) {
      navigator.share({ title: item.title, url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).catch(() => {});
    }
  };

  return (
    <Link
      href={`/storyline/${item.id}`}
      onClick={handleClick}
      // A rail-heavy gallery puts dozens of cards on screen; prefetching every
      // storyline route on scroll costs far more than it saves, and the
      // cover-aware open-flow loader already covers the perceived wait.
      prefetch={false}
      className="group block h-full w-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
    >
      <motion.div
        {...storyboardPreview.previewHandlers}
        whileHover={prefersReducedMotion ? undefined : { scale: 1.03 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className={`relative h-full w-full overflow-hidden rounded-2xl border border-white/5 bg-neutral-900 shadow-lg shadow-black/40 transition-colors duration-300 group-hover:border-emerald-500/30 ${
          layout === 'portrait' ? 'aspect-[9/16]' : 'aspect-video'
        }`}
      >
        {item.coverImageUrl ? (
          <StoryboardThumbnail
            src={item.coverImageUrl}
            alt={item.title}
            sizes={sizes ?? DEFAULT_SIZES[layout]}
            isPreviewing={storyboardPreview.isPreviewing}
            previewSessionId={storyboardPreview.previewSessionId}
            isStoryboard={item.coverIsStoryboard}
            // A poster cover shows whole and never crops; hover borrows the
            // opening beat's grid so the card still previews the story.
            previewSrc={item.coverIsStoryboard ? null : item.openingImageUrl}
            priority={priority}
          />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(16,185,129,0.18),transparent_50%),linear-gradient(160deg,rgba(38,38,38,0.9),rgba(10,10,10,0.98))]">
            <span
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center font-serif text-6xl text-white/[0.08]"
            >
              {Array.from(item.title.trim())[0] ?? ''}
            </span>
          </div>
        )}

        {/* Resting scrim keeps the title legible; the hover scrim deepens so
            the expanded metadata reads over any artwork. */}
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-neutral-950/90 via-neutral-950/35 to-transparent" />
        <div className="absolute inset-0 bg-neutral-950/0 transition-colors duration-300 group-hover:bg-neutral-950/30 group-focus-within:bg-neutral-950/30" />

        <div className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 ring-1 ring-inset ring-emerald-500/20 transition-opacity duration-300 group-hover:opacity-100" />

        {progress?.completed && (
          <span
            className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full border border-emerald-400/30 bg-neutral-950/70 px-2 py-1 text-[10px] font-medium text-emerald-300 backdrop-blur-sm"
            title="You finished this story"
          >
            <Check className="h-3 w-3" aria-hidden="true" />
            Read
          </span>
        )}

        {isLoggedIn && (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggleSave(item.id, isSaved);
            }}
            aria-label={isSaved ? `Remove ${item.title} from My List` : `Save ${item.title} to My List`}
            aria-pressed={isSaved}
            className="absolute left-1.5 top-1.5 z-10 flex h-11 w-11 items-center justify-center text-neutral-300 transition-colors hover:text-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-black/40 backdrop-blur-sm">
              {isSaved ? (
                <BookmarkCheck className="h-4 w-4 text-emerald-400" />
              ) : (
                <Bookmark className="h-4 w-4" />
              )}
            </span>
          </button>
        )}

        {progressPercent > 0 && (
          <div
            className="absolute inset-x-0 bottom-0 z-[5] h-[3px] bg-white/15"
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${item.title} reading progress`}
          >
            <div className="h-full bg-emerald-400" style={{ width: `${progressPercent}%` }} />
          </div>
        )}

        <div
          className={`absolute inset-x-0 bottom-0 ${layout === 'portrait' ? 'p-3' : 'p-3.5 sm:p-4'} ${
            progressPercent > 0 ? 'pb-4 sm:pb-5' : ''
          }`}
        >
          <h3
            className={`line-clamp-2 font-serif leading-snug text-neutral-50 drop-shadow-sm transition-colors group-hover:text-white ${
              layout === 'portrait' ? 'text-sm' : 'text-[15px] sm:text-base'
            }`}
          >
            {item.title}
          </h3>

          {/* Collapsed rows occupy zero height, so the title hugs the bottom
              edge until hover/focus grows the panel beneath it. */}
          <div className="grid grid-rows-[0fr] opacity-0 transition-all duration-300 ease-out group-hover:grid-rows-[1fr] group-hover:opacity-100 group-focus-within:grid-rows-[1fr] group-focus-within:opacity-100">
            <div className="min-h-0 overflow-hidden">
              {item.intro && layout === 'wide' && (
                <p className="line-clamp-2 pt-1.5 text-xs leading-snug text-neutral-300">
                  {item.intro}
                </p>
              )}

              <div className="flex items-center justify-between gap-2 pt-2 font-sans text-[11px] text-neutral-400">
                <span className="flex items-center gap-3">
                  {!!item.beatCount && (
                    <span className="flex items-center gap-1">
                      <BookOpen className="h-3 w-3" />
                      {item.beatCount}
                    </span>
                  )}
                  {!hideEngagementCounts && item.viewCount > 0 && (
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      {item.viewCount}
                    </span>
                  )}
                  {!hideEngagementCounts && item.likeCount > 0 && (
                    <span className="flex items-center gap-1">
                      <Heart className="h-3 w-3" />
                      {item.likeCount}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleShare}
                    aria-label={`Share ${item.title}`}
                    className="-my-3 flex min-h-11 min-w-11 items-center gap-1 transition-colors hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
                  >
                    <Share2 className="h-3 w-3" />
                  </button>
                </span>
                {item.authorName && (
                  <span className="max-w-[120px] truncate">by {item.authorName}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
