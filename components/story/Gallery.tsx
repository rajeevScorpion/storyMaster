'use client';

import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import GalleryCard from './GalleryCard';
import { getPublicStorylines } from '@/app/actions/gallery';
import type { GalleryStoryline } from '@/lib/types/database';

export default function Gallery() {
  const [storylines, setStorylines] = useState<GalleryStoryline[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getPublicStorylines(6)
      .then(setStorylines)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  // Don't render anything if there are no storylines
  if (!isLoading && storylines.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.4 }}
      className="w-full max-w-5xl mx-auto py-20 px-4"
    >
      <div className="text-center mb-10">
        <h2 className="text-2xl md:text-3xl font-serif text-neutral-200 mb-3">
          Discover Stories
        </h2>
        <p className="text-sm text-neutral-500 font-sans max-w-md mx-auto">
          Experience stories created by people like us.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="aspect-[16/10] rounded-2xl bg-neutral-900/50 border border-white/5 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {storylines.map((storyline, index) => (
            <motion.div
              key={storyline.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: index * 0.1 }}
            >
              <GalleryCard
                id={storyline.id}
                title={storyline.title}
                coverImageUrl={storyline.cover_image_url}
                beatCount={storyline.beat_count}
                authorName={storyline.author_name}
                likeCount={storyline.like_count}
                viewCount={storyline.view_count}
              />
            </motion.div>
          ))}
        </div>
      )}

      {/* Browse Gallery link */}
      {!isLoading && storylines.length > 0 && (
        <div className="text-center mt-8">
          <Link
            href="/gallery"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-white/5 border border-white/10 text-neutral-400 hover:text-emerald-400 hover:border-emerald-500/30 hover:bg-white/10 transition-all duration-200 text-sm font-medium"
          >
            Browse Gallery
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      )}
    </motion.section>
  );
}
