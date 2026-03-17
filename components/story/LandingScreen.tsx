'use client';

import { useState } from 'react';
import { useStoryStore } from '@/lib/store/story-store';
import { Sparkles, BookOpen } from 'lucide-react';
import { motion } from 'motion/react';

export default function LandingScreen() {
  const [prompt, setPrompt] = useState('');
  const startStory = useStoryStore((state) => state.startStory);
  const isLoading = useStoryStore((state) => state.isLoading);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim() && !isLoading) {
      startStory(prompt.trim());
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-900/20 rounded-full blur-3xl mix-blend-screen" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-emerald-900/20 rounded-full blur-3xl mix-blend-screen" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="z-10 max-w-2xl w-full text-center space-y-8"
      >
        <div className="space-y-4">
          <div className="inline-flex items-center justify-center p-3 bg-white/5 rounded-2xl border border-white/10 mb-4">
            <BookOpen className="w-8 h-8 text-emerald-400" />
          </div>
          <h1 className="text-5xl md:text-7xl font-serif text-white tracking-tight">
            Story Master
          </h1>
          <p className="text-lg md:text-xl text-neutral-400 font-sans max-w-lg mx-auto leading-relaxed">
            Co-create magical, illustrated branching stories with an AI Story Master.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="relative max-w-xl mx-auto mt-12">
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 to-indigo-500 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200" />
            <div className="relative flex items-center bg-neutral-900 border border-white/10 rounded-2xl p-2 shadow-2xl">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Tell me a story of a monkey and an elephant..."
                className="w-full bg-transparent text-white placeholder-neutral-500 px-4 py-3 outline-none font-sans text-lg"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={!prompt.trim() || isLoading}
                className="ml-2 bg-white text-black px-6 py-3 rounded-xl font-medium hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <span>Begin</span>
                    <Sparkles className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </form>

        <div className="pt-12 flex gap-4 justify-center text-sm text-neutral-500 font-sans">
          <button 
            onClick={() => setPrompt("A brave little toaster's journey to the moon")}
            className="hover:text-neutral-300 transition-colors"
          >
            Try: &quot;A brave little toaster...&quot;
          </button>
          <span>•</span>
          <button 
            onClick={() => setPrompt("The mystery of the glowing forest")}
            className="hover:text-neutral-300 transition-colors"
          >
            &quot;The mystery of the glowing forest&quot;
          </button>
        </div>
      </motion.div>
    </div>
  );
}
