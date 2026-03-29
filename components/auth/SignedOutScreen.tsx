'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'motion/react';
import { LogIn, BookOpen } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useStoryStore } from '@/lib/store/story-store';
import { useMyStoriesStore } from '@/lib/store/my-stories-store';
import KissagoLogo from '@/components/ui/KissagoLogo';

interface SignedOutScreenProps {
  coverImageUrl: string | null;
}

export default function SignedOutScreen({ coverImageUrl }: SignedOutScreenProps) {
  const { signInWithGoogle } = useAuth();

  // Clear all client-side state on mount
  useEffect(() => {
    useStoryStore.getState().resetStory();
    useMyStoriesStore.getState().clear();
  }, []);

  return (
    <div className="relative h-screen bg-neutral-950 text-neutral-200 overflow-hidden flex flex-col">
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        {coverImageUrl && (
          <Image
            src={coverImageUrl}
            alt="Story cover"
            fill
            className="object-cover opacity-70"
            referrerPolicy="no-referrer"
            priority
          />
        )}
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.6) 50%, rgba(0,0,0,0.95) 100%)' }} />
      </div>

      {/* Header */}
      <header className="relative z-10 p-4 md:p-6 shrink-0">
        <KissagoLogo fixed={false} />
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex items-center justify-center p-4 md:p-12">
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-md w-full"
        >
          <div className="rounded-3xl border border-white/10 bg-neutral-900/60 backdrop-blur-xl shadow-2xl overflow-hidden p-8 space-y-6 text-center">
            <h1 className="text-2xl md:text-3xl font-serif text-neutral-100 leading-tight">
              Thanks for your time!
            </h1>
            <p className="text-neutral-400 text-sm leading-relaxed">
              Come back soon to check latest stories.
            </p>

            <div className="space-y-3 pt-2">
              <button
                onClick={() => signInWithGoogle('/')}
                className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30 hover:border-emerald-500/50 transition-all duration-200 font-medium"
              >
                <LogIn className="w-5 h-5" />
                Sign in again
              </button>

              <Link
                href="/gallery"
                className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl bg-white/5 border border-white/10 text-neutral-300 hover:bg-white/10 hover:border-white/20 transition-all duration-200 font-medium"
              >
                <BookOpen className="w-5 h-5" />
                Browse Gallery
              </Link>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
