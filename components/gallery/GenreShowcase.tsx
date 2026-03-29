'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Bookmark, BookmarkCheck } from 'lucide-react';
import type { GenreSection } from '@/lib/types/database';

interface GenreShowcaseProps {
  sections: GenreSection[];
  savedIds: Set<string>;
  isLoggedIn: boolean;
  onToggleSave: (storylineId: string, saved: boolean) => void;
  onGenreClick: (genre: string) => void;
  onAuthRequired?: (returnTo: string) => void;
}

function GenreRow({
  section,
  savedIds,
  isLoggedIn,
  onToggleSave,
  onGenreClick,
  onAuthRequired,
}: {
  section: GenreSection;
  savedIds: Set<string>;
  isLoggedIn: boolean;
  onToggleSave: (storylineId: string, saved: boolean) => void;
  onGenreClick: (genre: string) => void;
  onAuthRequired?: (returnTo: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const updateScrollState = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  };

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === 'left' ? -340 : 340, behavior: 'smooth' });
  };

  return (
    <div className="relative group/row">
      <button
        onClick={() => onGenreClick(section.genre.toLowerCase())}
        className="text-lg md:text-xl font-serif text-neutral-200 mb-3 hover:text-emerald-400 transition-colors cursor-pointer"
      >
        {section.genre}
      </button>

      {/* Scroll arrows */}
      {canScrollLeft && (
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-neutral-900/90 border border-white/10 text-neutral-300 hover:text-white hover:bg-neutral-800 transition-all opacity-0 group-hover/row:opacity-100"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
      )}
      {canScrollRight && (
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-neutral-900/90 border border-white/10 text-neutral-300 hover:text-white hover:bg-neutral-800 transition-all opacity-0 group-hover/row:opacity-100"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      )}

      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        className="flex gap-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-2"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {section.items.map((item) => {
          const href = item.type === 'tree' ? `/explore/${item.storyId}` : `/storyline/${item.id}`;
          const isSaved = savedIds.has(item.id);
          const needsAuth = item.type === 'tree' && !isLoggedIn;

          const handleClick = (e: React.MouseEvent) => {
            if (needsAuth && onAuthRequired) {
              e.preventDefault();
              onAuthRequired(href);
            }
          };

          return (
            <Link
              key={item.id}
              href={href}
              onClick={handleClick}
              className="flex-shrink-0 snap-start"
            >
              <motion.div
                whileHover={{ scale: 1.03 }}
                transition={{ duration: 0.2 }}
                className="relative w-[280px] md:w-[320px] aspect-[16/9] rounded-2xl overflow-hidden border border-white/5 hover:border-emerald-500/30 transition-all duration-300 bg-neutral-900 group"
              >
                {item.coverImageUrl && (
                  <Image
                    src={item.coverImageUrl}
                    alt={item.title}
                    fill
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                    referrerPolicy="no-referrer"
                    sizes="320px"
                  />
                )}

                <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/50 to-transparent" />

                {/* Type pill */}
                <div className="absolute top-3 right-3">
                  <span
                    className={`px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                      item.type === 'tree'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                    }`}
                  >
                    {item.type === 'tree' ? 'Explore' : 'Experience'}
                  </span>
                </div>

                {/* Bookmark */}
                {isLoggedIn && item.type === 'storyline' && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onToggleSave(item.id, isSaved);
                    }}
                    className="absolute top-3 left-3 p-1.5 rounded-full bg-black/40 backdrop-blur-sm border border-white/10 text-neutral-300 hover:text-emerald-400 transition-colors"
                  >
                    {isSaved ? (
                      <BookmarkCheck className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Bookmark className="w-4 h-4" />
                    )}
                  </button>
                )}

                {/* Content */}
                <div className="absolute inset-x-0 bottom-0 p-4">
                  <h3 className="text-sm font-serif text-neutral-100 line-clamp-2 group-hover:text-white transition-colors">
                    {item.title}
                  </h3>
                  {item.authorName && (
                    <p className="text-[11px] text-neutral-500 mt-1 truncate">
                      by {item.authorName}
                    </p>
                  )}
                </div>
              </motion.div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function GenreShowcase({
  sections,
  savedIds,
  isLoggedIn,
  onToggleSave,
  onGenreClick,
  onAuthRequired,
}: GenreShowcaseProps) {
  if (sections.length === 0) return null;

  return (
    <div className="space-y-8">
      {sections.map((section, i) => (
        <motion.div
          key={section.genre}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: i * 0.1 }}
        >
          <GenreRow
            section={section}
            savedIds={savedIds}
            isLoggedIn={isLoggedIn}
            onToggleSave={onToggleSave}
            onGenreClick={onGenreClick}
            onAuthRequired={onAuthRequired}
          />
        </motion.div>
      ))}
    </div>
  );
}

export function GenreShowcaseSkeleton() {
  return (
    <div className="space-y-8">
      {[0, 1].map((i) => (
        <div key={i}>
          <div className="h-6 w-32 bg-neutral-800 rounded animate-pulse mb-3" />
          <div className="flex gap-4">
            {[0, 1, 2, 3].map((j) => (
              <div
                key={j}
                className="flex-shrink-0 w-[280px] md:w-[320px] aspect-[16/9] rounded-2xl bg-neutral-900/50 border border-white/5 animate-pulse"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
