'use client';

import Link from 'next/link';
import { BookOpen, Check, Play } from 'lucide-react';
import type { GalleryEpisodeSummary } from '@/lib/types/database';

interface SeriesEpisodeListProps {
  episodes: GalleryEpisodeSummary[];
  /** The episode the card's own CTA opens, marked so the two agree. */
  activeStorylineId: string | null;
  onOpen: (episode: GalleryEpisodeSummary) => void;
}

/**
 * The jump list inside an expanded series card: every published episode, in
 * order, each a direct way in.
 *
 * Text only, by design — the rail payload deliberately carries no artwork per
 * episode, because signing a cover for each one is what would make eagerly
 * loading the list expensive.
 */
export default function SeriesEpisodeList({
  episodes,
  activeStorylineId,
  onOpen,
}: SeriesEpisodeListProps) {
  if (episodes.length === 0) return null;

  return (
    <ol className="mt-1 flex max-h-40 flex-col gap-0.5 overflow-y-auto pr-1">
      {episodes.map((episode) => {
        const isActive = episode.storylineId === activeStorylineId;
        const isWatched = episode.progress?.completed === true;

        return (
          <li key={episode.storylineId}>
            <Link
              href={`/storyline/${episode.storylineId}`}
              onClick={() => onOpen(episode)}
              prefetch={false}
              aria-current={isActive ? 'true' : undefined}
              className={`group/ep flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 ${
                isActive
                  ? 'bg-emerald-500/15 text-emerald-100'
                  : 'text-neutral-300 hover:bg-white/5 hover:text-neutral-100'
              }`}
            >
              <span
                className={`w-8 shrink-0 font-medium tabular-nums ${
                  isActive ? 'text-emerald-300' : 'text-neutral-500'
                }`}
              >
                Ep {episode.episodeNumber}
              </span>
              <span className="min-w-0 flex-1 truncate">{episode.title}</span>
              {isWatched ? (
                <Check className="h-3 w-3 shrink-0 text-emerald-400" aria-label="Watched" />
              ) : (
                !!episode.beatCount && (
                  <span className="flex shrink-0 items-center gap-1 text-neutral-500">
                    <BookOpen className="h-3 w-3" aria-hidden="true" />
                    {episode.beatCount}
                  </span>
                )
              )}
              <Play
                className="h-3 w-3 shrink-0 fill-current opacity-0 transition-opacity group-hover/ep:opacity-100 group-focus-visible/ep:opacity-100"
                aria-hidden="true"
              />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
