'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { X, BookOpen, Trash2, Loader2, Clock, Compass, Library, Archive, ArchiveRestore, Play } from 'lucide-react';
import { deleteStory, archiveStory, unarchiveStory, unsaveStoryline } from '@/app/actions/persistence';
import { useMyStoriesStore } from '@/lib/store/my-stories-store';
import Link from 'next/link';
import type { TabId } from '@/lib/types/my-stories';

interface MyStoriesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

const TABS: { id: TabId; label: string; icon: typeof BookOpen }[] = [
  { id: 'explored', label: 'Explored', icon: Compass },
  { id: 'my-stories', label: 'My Stories', icon: BookOpen },
  { id: 'storylines', label: 'Storylines', icon: Library },
];

export default function MyStoriesDrawer({ isOpen, onClose }: MyStoriesDrawerProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>('my-stories');
  const [actionId, setActionId] = useState<string | null>(null);

  const stories = useMyStoriesStore((s) => s.stories);
  const exploredStories = useMyStoriesStore((s) => s.exploredStories);
  const savedStorylines = useMyStoriesStore((s) => s.savedStorylines);
  const loading = useMyStoriesStore((s) => s.loading);
  const fetchTab = useMyStoriesStore((s) => s.fetchTab);

  // Fetch current tab data when drawer opens or tab changes (serves cache if fresh)
  useEffect(() => {
    if (isOpen) fetchTab(activeTab);
  }, [isOpen, activeTab, fetchTab]);

  const isLoading = loading[activeTab];

  const handleLoadStory = (storyId: string) => {
    onClose();
    router.push(`/story/${storyId}`);
  };

  const handleExplore = (storyId: string) => {
    onClose();
    router.push(`/explore/${storyId}`);
  };

  const handleDeleteStory = async (storyId: string) => {
    setActionId(storyId);
    try {
      await deleteStory(storyId);
      useMyStoriesStore.getState().removeStory(storyId);
    } catch (error) {
      console.error('Failed to delete story:', error);
    } finally {
      setActionId(null);
    }
  };

  const handleArchiveStory = async (storyId: string) => {
    setActionId(storyId);
    try {
      await archiveStory(storyId);
      useMyStoriesStore.getState().updateStory(storyId, { is_archived: true });
    } catch (error) {
      console.error('Failed to archive story:', error);
    } finally {
      setActionId(null);
    }
  };

  const handleUnarchiveStory = async (storyId: string) => {
    setActionId(storyId);
    try {
      await unarchiveStory(storyId);
      useMyStoriesStore.getState().updateStory(storyId, { is_archived: false });
    } catch (error) {
      console.error('Failed to unarchive story:', error);
    } finally {
      setActionId(null);
    }
  };

  const handleUnsaveStoryline = async (storylineId: string) => {
    setActionId(storylineId);
    try {
      await unsaveStoryline(storylineId);
      useMyStoriesStore.getState().removeSavedStoryline(storylineId);
    } catch (error) {
      console.error('Failed to unsave storyline:', error);
    } finally {
      setActionId(null);
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

  const renderLoadingSkeletons = () => (
    <div className="space-y-3">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="h-24 rounded-2xl bg-neutral-900/50 border border-white/5 animate-pulse" />
      ))}
    </div>
  );

  const renderEmptyState = (icon: typeof BookOpen, title: string, description: string) => (
    <div className="flex flex-col items-center justify-center h-64 text-center px-8">
      {(() => { const Icon = icon; return <Icon className="w-12 h-12 text-neutral-700 mb-4" />; })()}
      <p className="text-neutral-400 font-serif text-lg mb-2">{title}</p>
      <p className="text-neutral-600 text-sm">{description}</p>
    </div>
  );

  const renderMyStories = () => {
    if (stories.length === 0) {
      return renderEmptyState(BookOpen, 'No stories yet', 'Your created stories will appear here.');
    }
    return stories.map((story) => (
      <motion.div
        key={story.id}
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className={`group relative rounded-2xl border transition-all overflow-hidden ${
          story.is_archived
            ? 'bg-neutral-900/30 border-white/5 opacity-60'
            : 'bg-neutral-900/60 border-white/5 hover:border-white/15'
        }`}
      >
        <button
          onClick={() => handleLoadStory(story.id)}
          className="w-full text-left p-5 pr-20"
        >
          <h3 className="text-base font-serif text-neutral-200 group-hover:text-white transition-colors truncate">
            {story.title}
          </h3>
          <p className="text-xs text-neutral-500 mt-1 line-clamp-1">{story.user_prompt}</p>
          <div className="flex items-center gap-3 mt-3">
            <span className={`text-[10px] uppercase tracking-widest font-medium px-2 py-0.5 rounded-full ${
              story.is_archived
                ? 'bg-neutral-500/10 text-neutral-500'
                : story.status === 'completed'
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'bg-amber-500/10 text-amber-400'
            }`}>
              {story.is_archived ? 'archived' : story.status}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-neutral-600">
              <Clock className="w-3 h-3" />
              {formatDate(story.updated_at)}
            </span>
          </div>
        </button>

        {/* Action buttons */}
        <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
          {story.is_archived ? (
            <button
              onClick={(e) => { e.stopPropagation(); handleUnarchiveStory(story.id); }}
              disabled={actionId === story.id}
              className="p-2 hover:bg-emerald-500/10 rounded-full transition-all"
              title="Restore story"
            >
              {actionId === story.id ? (
                <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
              ) : (
                <ArchiveRestore className="w-4 h-4 text-neutral-600 hover:text-emerald-400 transition-colors" />
              )}
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); handleArchiveStory(story.id); }}
              disabled={actionId === story.id}
              className="p-2 hover:bg-amber-500/10 rounded-full transition-all"
              title="Archive story"
            >
              {actionId === story.id ? (
                <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
              ) : (
                <Archive className="w-4 h-4 text-neutral-600 hover:text-amber-400 transition-colors" />
              )}
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); handleDeleteStory(story.id); }}
            disabled={actionId === story.id}
            className="p-2 hover:bg-red-500/10 rounded-full transition-all"
            title="Delete story permanently"
          >
            <Trash2 className="w-4 h-4 text-neutral-600 hover:text-red-400 transition-colors" />
          </button>
        </div>
      </motion.div>
    ));
  };

  const renderExploredStories = () => {
    if (exploredStories.length === 0) {
      return renderEmptyState(Compass, 'No explored stories', 'Stories you explore from the gallery will appear here.');
    }
    return exploredStories.map((item) => (
      <motion.div
        key={item.id}
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="group relative rounded-2xl bg-neutral-900/60 border border-white/5 hover:border-white/15 transition-all overflow-hidden"
      >
        <button
          onClick={() => handleExplore(item.story_id)}
          className="w-full text-left p-5"
        >
          <h3 className="text-base font-serif text-neutral-200 group-hover:text-white transition-colors truncate">
            {item.story?.title || 'Untitled Story'}
          </h3>
          <p className="text-xs text-neutral-500 mt-1 line-clamp-1">
            {item.story?.user_prompt || ''}
          </p>
          <div className="flex items-center gap-3 mt-3">
            <span className="text-[10px] uppercase tracking-widest font-medium px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400">
              explored
            </span>
            <span className="flex items-center gap-1 text-[10px] text-neutral-600">
              <Clock className="w-3 h-3" />
              {formatDate(item.updated_at)}
            </span>
          </div>
        </button>
      </motion.div>
    ));
  };

  const renderStorylines = () => {
    if (savedStorylines.length === 0) {
      return renderEmptyState(Library, 'No saved storylines', 'Completed storylines will appear here automatically.');
    }
    return savedStorylines.map((item) => (
      <motion.div
        key={item.id}
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="group relative rounded-2xl bg-neutral-900/60 border border-white/5 hover:border-white/15 transition-all overflow-hidden"
      >
        <div className="p-5 pr-20">
          <Link
            href={`/storyline/${item.storyline_id}`}
            onClick={() => {
              try {
                sessionStorage.setItem('storyline-nav-meta', JSON.stringify({
                  title: item.storyline?.title || 'Untitled Storyline',
                  coverImageUrl: item.storyline?.cover_image_url || null,
                  authorName: item.storyline?.author_name || null,
                  beatCount: item.storyline?.beat_count || null,
                }));
              } catch {}
              onClose();
            }}
            className="block"
          >
            <h3 className="text-base font-serif text-neutral-200 group-hover:text-white transition-colors truncate">
              {item.storyline?.title || 'Untitled Storyline'}
            </h3>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-[10px] uppercase tracking-widest font-medium px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400">
                {item.storyline?.beat_count || 0} beats
              </span>
              {item.storyline?.author_name && (
                <span className="text-[10px] text-neutral-600">
                  by {item.storyline.author_name}
                </span>
              )}
              <span className="flex items-center gap-1 text-[10px] text-neutral-600">
                <Clock className="w-3 h-3" />
                {formatDate(item.saved_at)}
              </span>
            </div>
          </Link>
        </div>

        {/* Action buttons */}
        <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
          <Link
            href={`/storyline/${item.storyline_id}`}
            onClick={() => {
              try {
                sessionStorage.setItem('storyline-nav-meta', JSON.stringify({
                  title: item.storyline?.title || 'Untitled Storyline',
                  coverImageUrl: item.storyline?.cover_image_url || null,
                  authorName: item.storyline?.author_name || null,
                  beatCount: item.storyline?.beat_count || null,
                }));
              } catch {}
              onClose();
            }}
            className="p-2 hover:bg-purple-500/10 rounded-full transition-all"
            title="Play storyline"
          >
            <Play className="w-4 h-4 text-neutral-600 hover:text-purple-400 transition-colors" />
          </Link>
          <button
            onClick={(e) => { e.stopPropagation(); handleUnsaveStoryline(item.storyline_id); }}
            disabled={actionId === item.storyline_id}
            className="p-2 hover:bg-red-500/10 rounded-full transition-all"
            title="Remove from saved"
          >
            {actionId === item.storyline_id ? (
              <Loader2 className="w-4 h-4 text-red-400 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4 text-neutral-600 hover:text-red-400 transition-colors" />
            )}
          </button>
        </div>
      </motion.div>
    ));
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
                <h2 className="text-lg font-serif text-neutral-200">Stories</h2>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/10 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-neutral-400" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-white/5">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 px-2 text-xs font-medium transition-all border-b-2 ${
                      isActive
                        ? 'border-emerald-400 text-emerald-400'
                        : 'border-transparent text-neutral-500 hover:text-neutral-300'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {isLoading ? (
                renderLoadingSkeletons()
              ) : activeTab === 'my-stories' ? (
                renderMyStories()
              ) : activeTab === 'explored' ? (
                renderExploredStories()
              ) : (
                renderStorylines()
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
