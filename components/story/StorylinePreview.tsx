'use client';

import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'motion/react';
import KissagoLogo from '@/components/ui/KissagoLogo';
import { BookOpen, LogIn } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';

interface StorylinePreviewProps {
  storylineId: string;
  title: string;
  authorName: string | null;
  coverImageUrl: string | null;
  beatCount: number;
}

export default function StorylinePreview({
  storylineId,
  title,
  authorName,
  coverImageUrl,
  beatCount,
}: StorylinePreviewProps) {
  const { signInWithGoogle } = useAuth();

  const handleSignIn = () => {
    // Store the storyline ID so we can redirect back after login
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('kissago_pending_storyline', storylineId);
    }
    signInWithGoogle();
  };

  return (
    <div className="relative h-screen bg-neutral-950 text-neutral-200 overflow-hidden flex flex-col">
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        {coverImageUrl && (
          <Image
            src={coverImageUrl}
            alt={title}
            fill
            className="object-cover opacity-30"
            referrerPolicy="no-referrer"
            priority
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/80 to-neutral-950/40" />
      </div>

      {/* Header */}
      <header className="relative z-10 p-4 md:p-6 flex justify-between items-center shrink-0">
        <KissagoLogo fixed={false} />
        <Link
          href="/gallery"
          className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-neutral-400 hover:text-neutral-200 hover:bg-white/10 transition-all"
        >
          Browse Gallery
        </Link>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex items-center justify-center p-4 md:p-12">
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-lg w-full"
        >
          {/* Preview Card */}
          <div className="rounded-3xl border border-white/10 bg-neutral-900/60 backdrop-blur-xl shadow-2xl overflow-hidden">
            {/* Cover Image */}
            {coverImageUrl && (
              <div className="relative aspect-[16/9]">
                <Image
                  src={coverImageUrl}
                  alt={title}
                  fill
                  className="object-cover"
                  referrerPolicy="no-referrer"
                  sizes="(max-width: 640px) 100vw, 512px"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-neutral-900/90 to-transparent" />
              </div>
            )}

            {/* Card Content */}
            <div className="p-8 space-y-6">
              <div>
                <h1 className="text-2xl md:text-3xl font-serif text-neutral-100 leading-tight">
                  {title}
                </h1>
                {authorName && (
                  <p className="text-sm text-neutral-500 mt-2 font-sans">
                    by {authorName}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 text-sm text-neutral-400">
                <BookOpen className="w-4 h-4" />
                <span>{beatCount} beats</span>
              </div>

              {/* Sign In CTA */}
              <button
                onClick={handleSignIn}
                className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30 hover:border-emerald-500/50 transition-all duration-200 font-medium"
              >
                <LogIn className="w-5 h-5" />
                Sign in to experience this story
              </button>

              <p className="text-xs text-neutral-600 text-center">
                Sign in with Google to read the full story, listen to narration, and explore branching paths.
              </p>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
