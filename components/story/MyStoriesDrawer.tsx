'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, BookOpen, Trash2, Loader2, Clock } from 'lucide-react';
import { listUserStories, deleteStory } from '@/app/actions/persistence';
import { useStoryStore } from '@/lib/store/story-store';

interface SavedStory {
  id: string;
  title: string;
  status: string;
  updated_at: string;
  user_prompt: string;
}

interface MyStoriesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function MyStoriesDrawer({ isOpen, onClose }: MyStoriesDrawerProps) {
  const [stories, setStories] = useState<SavedStory[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const loadStoryFromCloud = useStoryStore((s) => s.loadStoryFromCloud);

  const fetchStories = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await listUserStories();
      setStories(data);
    } catch (error) {
      console.error('Failed to fetch stories:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) fetchStories();
  }, [isOpen, fetchStories]);

  const handleLoad = async (storyId: string) => {
    setLoadingId(storyId);
    try {
      await loadStoryFromCloud(storyId);
      onClose();
    } catch (error) {
      console.error('Failed to load story:', error);
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async (storyId: string) => {
    setDeletingId(storyId);
    try {
      await deleteStory(storyId);
      setStories((prev) => prev.filter((s) => s.id !== storyId));
    } catch (error) {
      console.error('Failed to delete story:', error);
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-neutral-950/95 border-l border-white/10 backdrop-blur-xl z-50 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/5">
              <div className="flex items-center gap-3">
                <BookOpen className="w-5 h-5 text-emerald-400" />
                <h2 className="text-lg font-serif text-neutral-200">My Stories</h2>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/10 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-neutral-400" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {isLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <div
                      key={i}
                      className="h-24 rounded-2xl bg-neutral-900/50 border border-white/5 animate-pulse"
                    />
                  ))}
                </div>
              ) : stories.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-8">
                  <BookOpen className="w-12 h-12 text-neutral-700 mb-4" />
                  <p className="text-neutral-400 font-serif text-lg mb-2">No stories yet</p>
                  <p className="text-neutral-600 text-sm">
                    Your saved stories will appear here.
                  </p>
                </div>
              ) : (
                stories.map((story) => (
                  <motion.div
                    key={story.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="group relative rounded-2xl bg-neutral-900/60 border border-white/5 hover:border-white/15 transition-all overflow-hidden"
                  >
                    <button
                      onClick={() => handleLoad(story.id)}
                      disabled={loadingId === story.id}
                      className="w-full text-left p-5 pr-12"
                    >
                      <h3 className="text-base font-serif text-neutral-200 group-hover:text-white transition-colors truncate">
                        {story.title}
                      </h3>
                      <p className="text-xs text-neutral-500 mt-1 line-clamp-1">
                        {story.user_prompt}
                      </p>
                      <div className="flex items-center gap-3 mt-3">
                        <span className={`text-[10px] uppercase tracking-widest font-medium px-2 py-0.5 rounded-full ${
                          story.status === 'completed'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-amber-500/10 text-amber-400'
                        }`}>
                          {story.status}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] text-neutral-600">
                          <Clock className="w-3 h-3" />
                          {formatDate(story.updated_at)}
                        </span>
                      </div>
                      {loadingId === story.id && (
                        <div className="absolute inset-0 bg-neutral-950/80 flex items-center justify-center rounded-2xl">
                          <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
                        </div>
                      )}
                    </button>

                    {/* Delete button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(story.id);
                      }}
                      disabled={deletingId === story.id}
                      className="absolute top-4 right-3 p-2 opacity-0 group-hover:opacity-100 hover:bg-red-500/10 rounded-full transition-all"
                      title="Delete story"
                    >
                      {deletingId === story.id ? (
                        <Loader2 className="w-4 h-4 text-red-400 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4 text-neutral-600 hover:text-red-400 transition-colors" />
                      )}
                    </button>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
