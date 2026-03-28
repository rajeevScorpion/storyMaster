'use client';

import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'motion/react';
import { BookOpen, Eye, Heart } from 'lucide-react';

interface GalleryCardProps {
  id: string;
  title: string;
  coverImageUrl: string | null;
  beatCount: number;
  authorName: string | null;
  likeCount?: number;
  viewCount?: number;
}

export default function GalleryCard({
  id,
  title,
  coverImageUrl,
  beatCount,
  authorName,
  likeCount = 0,
  viewCount = 0,
}: GalleryCardProps) {
  const handleClick = () => {
    try {
      sessionStorage.setItem('storyline-nav-meta', JSON.stringify({
        title,
        coverImageUrl,
        authorName,
        beatCount,
      }));
    } catch {}
  };

  return (
    <Link href={`/storyline/${id}`} onClick={handleClick}>
      <motion.div
        whileHover={{ scale: 1.02 }}
        transition={{ duration: 0.2 }}
        className="relative group rounded-2xl overflow-hidden border border-white/5 hover:border-emerald-500/30 transition-all duration-300 aspect-[16/10] bg-neutral-900"
      >
        {/* Cover Image */}
        {coverImageUrl && (
          <Image
            src={coverImageUrl}
            alt={title}
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

        {/* Content */}
        <div className="absolute inset-x-0 bottom-0 p-4 space-y-1.5">
          <h3 className="text-base font-serif text-neutral-100 line-clamp-2 group-hover:text-white transition-colors">
            {title}
          </h3>
          <div className="flex items-center justify-between text-xs font-sans text-neutral-500">
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <BookOpen className="w-3 h-3" />
                {beatCount}
              </span>
              {viewCount > 0 && (
                <span className="flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  {viewCount}
                </span>
              )}
              {likeCount > 0 && (
                <span className="flex items-center gap-1">
                  <Heart className="w-3 h-3" />
                  {likeCount}
                </span>
              )}
            </span>
            {authorName && (
              <span className="truncate max-w-[120px]">by {authorName}</span>
            )}
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
