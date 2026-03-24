'use client';

import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'motion/react';
import { BookOpen, Bookmark, BookmarkCheck } from 'lucide-react';
import type { GalleryItem } from '@/lib/types/database';

interface GalleryItemCardProps {
  item: GalleryItem;
  isSaved: boolean;
  isLoggedIn: boolean;
  onToggleSave: (storylineId: string, saved: boolean) => void;
}

export default function GalleryItemCard({
  item,
  isSaved,
  isLoggedIn,
  onToggleSave,
}: GalleryItemCardProps) {
  const href = item.type === 'tree' ? `/explore/${item.storyId}` : `/storyline/${item.id}`;

  return (
    <Link href={href}>
      <motion.div
        whileHover={{ scale: 1.02 }}
        transition={{ duration: 0.2 }}
        className="relative group rounded-2xl overflow-hidden border border-white/5 hover:border-emerald-500/30 transition-all duration-300 aspect-[16/10] bg-neutral-900"
      >
        {/* Cover Image */}
        {item.coverImageUrl && (
          <Image
            src={item.coverImageUrl}
            alt={item.title}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            referrerPolicy="no-referrer"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/60 to-transparent" />

        {/* Hover glow */}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ring-1 ring-inset ring-emerald-500/20 rounded-2xl" />

        {/* Type pill — top-right */}
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

        {/* Bookmark — top-left (storylines only, logged-in only) */}
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
        <div className="absolute inset-x-0 bottom-0 p-4 space-y-1.5">
          <h3 className="text-base font-serif text-neutral-100 line-clamp-2 group-hover:text-white transition-colors">
            {item.title}
          </h3>
          <div className="flex items-center justify-between text-xs font-sans text-neutral-500">
            <span className="flex items-center gap-1.5">
              {item.type === 'storyline' && item.beatCount && (
                <>
                  <BookOpen className="w-3 h-3" />
                  {item.beatCount} beats
                </>
              )}
              {item.type === 'tree' && item.genre && (
                <span className="capitalize">{item.genre}</span>
              )}
            </span>
            {item.authorName && (
              <span className="truncate max-w-[120px]">by {item.authorName}</span>
            )}
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
