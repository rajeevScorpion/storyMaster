'use client';

import Image from 'next/image';
import Link from 'next/link';
import { BookOpen, Bookmark, BookmarkCheck, Eye, Heart, Play } from 'lucide-react';
import { writeOpenFlowNavMeta } from '@/lib/story/open-flow-nav';
import type { GalleryItem } from '@/lib/types/database';

interface GalleryHeroProps {
  item: GalleryItem;
  isSaved: boolean;
  isLoggedIn: boolean;
  onToggleSave: (storylineId: string, saved: boolean) => void;
}

/**
 * Cinematic billboard for one featured storyline. Only rendered when the feed
 * finds a storyline with clean (non-storyboard) artwork — a hero built on
 * missing or gridded imagery looks worse than no hero at all.
 */
export default function GalleryHero({
  item,
  isSaved,
  isLoggedIn,
  onToggleSave,
}: GalleryHeroProps) {
  const handleOpen = () => {
    writeOpenFlowNavMeta({
      kind: 'storyline',
      title: item.title,
      coverImageUrl: item.coverImageUrl,
      coverIsStoryboard: item.coverIsStoryboard,
      beatCount: item.beatCount,
    });
  };

  return (
    <section className="relative h-[58dvh] min-h-[340px] max-h-[620px] w-full overflow-hidden">
      {item.coverImageUrl && (
        <Image
          src={item.coverImageUrl}
          alt=""
          fill
          priority
          sizes="100vw"
          referrerPolicy="no-referrer"
          className="object-cover"
        />
      )}

      {/* Scrims: bottom fade into the page, left fade behind the copy. */}
      <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/55 to-neutral-950/20" />
      <div className="absolute inset-0 bg-gradient-to-r from-neutral-950/85 via-neutral-950/35 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 px-4 pb-10 lg:px-8 lg:pb-14">
        <div className="max-w-2xl space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400/90">
            Featured storyline
          </p>

          <h1 className="font-serif text-3xl leading-tight text-neutral-50 md:text-5xl">
            {item.title}
          </h1>

          {item.intro && (
            <p className="line-clamp-2 max-w-xl text-sm text-neutral-300 md:text-base">
              {item.intro}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-400">
            {item.authorName && <span>by {item.authorName}</span>}
            {!!item.beatCount && (
              <span className="flex items-center gap-1">
                <BookOpen className="h-3.5 w-3.5" />
                {item.beatCount} beats
              </span>
            )}
            {item.viewCount > 0 && (
              <span className="flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" />
                {item.viewCount}
              </span>
            )}
            {item.likeCount > 0 && (
              <span className="flex items-center gap-1">
                <Heart className="h-3.5 w-3.5" />
                {item.likeCount}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              href={`/storyline/${item.id}`}
              onClick={handleOpen}
              className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-6 py-3 text-sm font-medium text-neutral-950 transition-colors hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
            >
              <Play className="h-4 w-4 fill-current" />
              Start reading
            </Link>

            {isLoggedIn && (
              <button
                type="button"
                onClick={() => onToggleSave(item.id, isSaved)}
                aria-pressed={isSaved}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm text-neutral-200 backdrop-blur-sm transition-colors hover:border-white/25 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
              >
                {isSaved ? (
                  <>
                    <BookmarkCheck className="h-4 w-4 text-emerald-400" />
                    Saved
                  </>
                ) : (
                  <>
                    <Bookmark className="h-4 w-4" />
                    My List
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
