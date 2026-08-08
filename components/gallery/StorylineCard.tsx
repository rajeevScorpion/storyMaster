'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import { BookOpen, Bookmark, BookmarkCheck, Eye, Heart, Share2 } from 'lucide-react';
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
  onToggleSave: (storylineId: string, saved: boolean) => void;
}

/**
 * The single storyline card used by the hero rails, the genre rails, and the
 * browse grid. Artwork and title are always visible; creator, counts, and
 * share are progressively disclosed on hover/focus (and always shown on touch,
 * where there is no hover to reveal them).
 */
export default function StorylineCard({
  item,
  layout,
  isSaved,
  isLoggedIn,
  sizes,
  priority = false,
  onToggleSave,
}: StorylineCardProps) {
  const storyboardPreview = useStoryboardThumbnailPreview(!!item.coverImageUrl);

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
      className="group block h-full w-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
    >
      <motion.div
        {...storyboardPreview.previewHandlers}
        whileHover={{ scale: 1.02 }}
        transition={{ duration: 0.2 }}
        className={`relative h-full w-full overflow-hidden rounded-2xl border border-white/5 bg-neutral-900 transition-colors duration-300 group-hover:border-emerald-500/30 ${
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
            allowAutoDetect
            priority={priority}
          />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.22),transparent_42%),linear-gradient(180deg,rgba(38,38,38,0.72),rgba(10,10,10,0.98))]">
            <div className="absolute inset-0 flex items-center justify-center">
              <BookOpen className="h-14 w-14 text-white/10" />
            </div>
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/45 to-transparent" />

        <div className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 ring-1 ring-inset ring-emerald-500/20 transition-opacity duration-300 group-hover:opacity-100" />

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
            className="absolute left-3 top-3 rounded-full border border-white/10 bg-black/40 p-1.5 text-neutral-300 backdrop-blur-sm transition-colors hover:text-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
          >
            {isSaved ? (
              <BookmarkCheck className="h-4 w-4 text-emerald-400" />
            ) : (
              <Bookmark className="h-4 w-4" />
            )}
          </button>
        )}

        <div className="absolute inset-x-0 bottom-0 space-y-1.5 p-4">
          <h3 className="line-clamp-2 font-serif text-base text-neutral-100 transition-colors group-hover:text-white">
            {item.title}
          </h3>

          {/* Progressive disclosure: revealed on hover/keyboard focus, and
              always on touch, where `.touch-visible` forces it open. */}
          <div className="touch-visible flex items-center justify-between gap-2 text-xs font-sans text-neutral-400 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
            <span className="flex items-center gap-3">
              {!!item.beatCount && (
                <span className="flex items-center gap-1">
                  <BookOpen className="h-3 w-3" />
                  {item.beatCount}
                </span>
              )}
              {item.viewCount > 0 && (
                <span className="flex items-center gap-1">
                  <Eye className="h-3 w-3" />
                  {item.viewCount}
                </span>
              )}
              {item.likeCount > 0 && (
                <span className="flex items-center gap-1">
                  <Heart className="h-3 w-3" />
                  {item.likeCount}
                </span>
              )}
              <button
                type="button"
                onClick={handleShare}
                aria-label={`Share ${item.title}`}
                className="flex items-center gap-1 transition-colors hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
              >
                <Share2 className="h-3 w-3" />
              </button>
            </span>
            {item.authorName && (
              <span className="max-w-[120px] truncate">by {item.authorName}</span>
            )}
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
