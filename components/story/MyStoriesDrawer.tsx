'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { X, BookOpen, Trash2, Loader2, Clock, Library, Archive, ArchiveRestore, Play, Share2, ImageIcon, Clapperboard, UserRound, RectangleHorizontal, RectangleVertical } from 'lucide-react';
import { deleteStory, archiveStory, unarchiveStory, unsaveStoryline } from '@/app/actions/persistence';
import { useMyStoriesStore } from '@/lib/store/my-stories-store';
import { writeOpenFlowNavMeta } from '@/lib/story/open-flow-nav';
import Link from 'next/link';
import type { PagedTabId, SavedStory, SavedStorylineItem, TabId, UserReel } from '@/lib/types/my-stories';
import type { CharacterMaster } from '@/lib/types/character-library';

import ManageStorylineCoverDialog from './ManageStorylineCoverDialog';
import CharacterMasterCard from './CharacterMasterCard';
import CharacterMasterDialog from './CharacterMasterDialog';
import StoryboardThumbnail from './StoryboardThumbnail';
import FilterDropdown from '@/components/ui/FilterDropdown';
import RowActionsMenu, { type RowAction } from '@/components/ui/RowActionsMenu';

interface MyStoriesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

const TABS: { id: TabId; label: string; icon: typeof BookOpen }[] = [
  { id: 'my-stories', label: 'My Stories', icon: BookOpen },
  { id: 'storylines', label: 'Storylines', icon: Library },
  { id: 'reels', label: 'Reels', icon: Clapperboard },
];

const CHARACTERS_TAB: { id: TabId; label: string; icon: typeof BookOpen } = {
  id: 'characters',
  label: 'Characters',
  icon: UserRound,
};

export default function MyStoriesDrawer({ isOpen, onClose }: MyStoriesDrawerProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>('my-stories');
  const [actionId, setActionId] = useState<string | null>(null);
  const [managedStorylineId, setManagedStorylineId] = useState<string | null>(null);
  const [characterFilter, setCharacterFilter] = useState('active');
  const [openMasterId, setOpenMasterId] = useState<string | null>(null);

  const stories = useMyStoriesStore((s) => s.stories);
  const reels = useMyStoriesStore((s) => s.reels);
  const savedStorylines = useMyStoriesStore((s) => s.savedStorylines);
  const characters = useMyStoriesStore((s) => s.characters);
  const characterSettings = useMyStoriesStore((s) => s.characterSettings);
  const loading = useMyStoriesStore((s) => s.loading);
  const hasMore = useMyStoriesStore((s) => s.hasMore);
  const loadingMore = useMyStoriesStore((s) => s.loadingMore);
  const fetchTab = useMyStoriesStore((s) => s.fetchTab);
  const loadMore = useMyStoriesStore((s) => s.loadMore);
  const ensureCharacterUniverse = useMyStoriesStore((s) => s.ensureCharacterUniverse);

  // Flag-gated: fail closed until the snapshot loads. Prefetched on login, so
  // this is usually already populated by the time the drawer opens.
  const libraryEnabled = characterSettings?.libraryEnabled ?? false;
  const visibleTabs = libraryEnabled ? [...TABS, CHARACTERS_TAB] : TABS;
  // Fall back if the flag turned off while the characters tab was selected.
  const effectiveTab: TabId =
    activeTab === 'characters' && !libraryEnabled ? 'my-stories' : activeTab;

  // Fetch current tab data when drawer opens or tab changes (serves cache if
  // fresh). The Characters tab is owned by ensureCharacterUniverse below.
  useEffect(() => {
    if (isOpen && effectiveTab !== 'characters') fetchTab(effectiveTab);
  }, [isOpen, effectiveTab, fetchTab]);

  // Character-universe snapshot + masters (tab visibility + card list).
  useEffect(() => {
    if (isOpen) ensureCharacterUniverse();
  }, [isOpen, ensureCharacterUniverse]);

  useEffect(() => {
    if (!isOpen) {
      setManagedStorylineId(null);
    }
  }, [isOpen]);

  const isLoading = loading[effectiveTab];

  // Cached rows from the last visit are painted immediately and revalidated in
  // the background, so skeletons are only right when there is genuinely
  // nothing to show — otherwise a refresh would blank content already on screen.
  const rowsOnScreen =
    effectiveTab === 'my-stories'
      ? stories.length
      : effectiveTab === 'reels'
        ? reels.length
        : effectiveTab === 'characters'
          ? characters.length
          : savedStorylines.length;
  const showSkeletons = isLoading && rowsOnScreen === 0;

  const handleLoadStory = (story: SavedStory) => {
    writeOpenFlowNavMeta({
      kind: 'story',
      title: story.title,
      coverImageUrl: story.cover_image_url,
      status: story.status,
      userPrompt: story.user_prompt,
    });
    onClose();
    router.push(`/story/${story.id}`);
  };

  const handleLoadReel = (reel: UserReel) => {
    writeOpenFlowNavMeta({
      kind: 'reel',
      title: reel.title,
      coverImageUrl: reel.cover_image_url,
      status: reel.status,
      beatCount: reel.beat_count,
      userPrompt: reel.user_prompt,
    });
    onClose();
    router.push(`/story/${reel.id}`);
  };

  const handleOpenStoryline = (item: SavedStorylineItem) => {
    writeOpenFlowNavMeta({
      kind: 'storyline',
      title: item.storyline?.title || 'Untitled Storyline',
      coverImageUrl: item.storyline?.cover_image_url || null,
      beatCount: item.storyline?.beat_count || null,
    });
    onClose();
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
      useMyStoriesStore.getState().updateReel(storyId, { is_archived: true });
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
      useMyStoriesStore.getState().updateReel(storyId, { is_archived: false });
    } catch (error) {
      console.error('Failed to unarchive story:', error);
    } finally {
      setActionId(null);
    }
  };

  const handleShareStoryline = (item: SavedStorylineItem) => {
    const url = `${window.location.origin}/storyline/${item.storyline_id}`;
    if (navigator.share) {
      navigator.share({ title: item.storyline?.title || 'Storyline', url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).catch(() => {});
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

  // Same portrait rule the gallery uses: the flag wins, aspect ratio backs it up.
  const isPortraitRow = (row?: { is_vertical_story?: boolean | null; aspect_ratio?: string | null } | null) =>
    row?.is_vertical_story === true || row?.aspect_ratio === '9:16';

  const renderOrientationBadge = (row: { is_vertical_story?: boolean | null; aspect_ratio?: string | null }) => {
    const isPortrait = isPortraitRow(row);
    const Icon = isPortrait ? RectangleVertical : RectangleHorizontal;
    const label = isPortrait ? 'Portrait (9:16)' : 'Landscape (16:9)';
    return (
      <span className="flex items-center text-neutral-600" title={label} aria-label={label}>
        <Icon className="w-3.5 h-3.5" />
      </span>
    );
  };

  // List thumbnail: server resolves cover → first-beat fallback plus the
  // storyboard flag; storyboard grids render only their first panel via
  // StoryboardThumbnail's static crop. The box follows the story orientation
  // (16:9 landscape / 9:16 portrait), and is sized to fill the card's height
  // rather than float in the middle of it — artwork is what makes a row
  // recognizable, so it gets the space the padding used to take.
  const renderThumbnail = (
    url: string | null | undefined,
    isStoryboard: boolean | null | undefined,
    alt: string,
    FallbackIcon: typeof BookOpen,
    isPortrait: boolean
  ) => (
    <div
      className={`relative flex-shrink-0 rounded-xl overflow-hidden bg-neutral-800/60 border border-white/5 ${
        isPortrait ? 'h-24 aspect-[9/16]' : 'h-20 aspect-video'
      }`}
    >
      {url ? (
        <StoryboardThumbnail
          src={url}
          alt={alt}
          // Matches the rendered box so the optimizer picks a source that fits
          // instead of upscaling a thumbnail cut for the old smaller slot.
          sizes={isPortrait ? '56px' : '144px'}
          isPreviewing={false}
          previewSessionId={0}
          isStoryboard={isStoryboard === true}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <FallbackIcon className="w-6 h-6 text-neutral-700" />
        </div>
      )}
    </div>
  );

  const renderLoadingSkeletons = () => (
    <div className="space-y-3">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="h-24 rounded-2xl bg-neutral-900/50 border border-white/5 animate-pulse" />
      ))}
    </div>
  );

  /**
   * Paged tabs load 30 rows at a time; the rest arrive on request rather than
   * making every drawer open pay for a library that only grows.
   */
  const renderLoadMore = (tab: PagedTabId) => {
    if (!hasMore[tab]) return null;
    return (
      <button
        type="button"
        onClick={() => loadMore(tab)}
        disabled={loadingMore[tab]}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/5 bg-neutral-900/40 py-3 text-xs font-medium uppercase tracking-widest text-neutral-400 transition-colors hover:border-white/15 hover:text-neutral-200 disabled:opacity-60"
      >
        {loadingMore[tab] ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading
          </>
        ) : (
          'Load more'
        )}
      </button>
    );
  };

  const renderEmptyState = (icon: typeof BookOpen, title: string, description: string) => (
    <div className="flex flex-col items-center justify-center h-64 text-center px-8">
      {(() => { const Icon = icon; return <Icon className="w-12 h-12 text-neutral-700 mb-4" />; })()}
      <p className="text-neutral-400 font-serif text-lg mb-2">{title}</p>
      <p className="text-neutral-600 text-sm">{description}</p>
    </div>
  );

  /**
   * Archive/restore + delete, shared by the story and reel rows — the same two
   * actions, differing only in what the labels call the row.
   */
  const buildStoryActions = (
    row: SavedStory | UserReel,
    noun: 'story' | 'reel'
  ): RowAction[] => {
    const busy = actionId === row.id;
    return [
      row.is_archived
        ? {
            key: 'restore',
            label: `Restore ${noun}`,
            icon: ArchiveRestore,
            onSelect: () => handleUnarchiveStory(row.id),
            disabled: busy,
          }
        : {
            key: 'archive',
            label: `Archive ${noun}`,
            icon: Archive,
            onSelect: () => handleArchiveStory(row.id),
            disabled: busy,
          },
      {
        key: 'delete',
        label: `Delete ${noun} permanently`,
        icon: Trash2,
        tone: 'danger',
        onSelect: () => handleDeleteStory(row.id),
        disabled: busy,
      },
    ];
  };

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
        className={`group relative flex items-center gap-2 rounded-2xl border p-2 transition-all overflow-hidden ${
          story.is_archived
            ? 'bg-neutral-900/30 border-white/5 opacity-60'
            : 'bg-neutral-900/60 border-white/5 hover:border-white/15'
        }`}
      >
        <button
          onClick={() => handleLoadStory(story)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {renderThumbnail(story.thumbnail_url, story.thumbnail_is_storyboard, story.title, BookOpen, isPortraitRow(story))}
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-serif text-neutral-200 group-hover:text-white transition-colors truncate">
              {story.title}
            </h3>
            <p className="text-xs text-neutral-500 mt-1 line-clamp-1">{story.user_prompt}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
              <span className={`whitespace-nowrap text-[10px] uppercase tracking-widest font-medium px-2 py-0.5 rounded-full ${
                story.is_archived
                  ? 'bg-neutral-500/10 text-neutral-500'
                  : story.status === 'completed'
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-amber-500/10 text-amber-400'
              }`}>
                {story.is_archived ? 'archived' : story.status}
              </span>
              {typeof story.episode_number === 'number' && story.episode_number > 0 && (
                <span className="whitespace-nowrap text-[10px] uppercase tracking-widest font-medium px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300">
                  Ep {story.episode_number}
                </span>
              )}
              {renderOrientationBadge(story)}
              <span className="flex items-center gap-1 whitespace-nowrap text-[10px] text-neutral-600">
                <Clock className="w-3 h-3" />
                {formatDate(story.updated_at)}
              </span>
            </div>
          </div>
        </button>

        <RowActionsMenu
          ariaLabel={`Actions for ${story.title}`}
          busy={actionId === story.id}
          actions={buildStoryActions(story, 'story')}
        />
      </motion.div>
    ));
  };

  const renderReels = () => {
    if (reels.length === 0) {
      return renderEmptyState(Clapperboard, 'No reels yet', 'Your generated reels will appear here.');
    }
    return reels.map((reel) => (
      <motion.div
        key={reel.id}
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className={`group relative flex items-center gap-2 rounded-2xl border p-2 transition-all overflow-hidden ${
          reel.is_archived
            ? 'bg-neutral-900/30 border-white/5 opacity-60'
            : 'bg-neutral-900/60 border-white/5 hover:border-white/15'
        }`}
      >
        <button
          onClick={() => handleLoadReel(reel)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {renderThumbnail(reel.thumbnail_url, reel.thumbnail_is_storyboard, reel.title, Clapperboard, isPortraitRow(reel))}
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-serif text-neutral-200 group-hover:text-white transition-colors truncate">
              {reel.title}
            </h3>
            <p className="text-xs text-neutral-500 mt-1 line-clamp-1">{reel.user_prompt}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
              <span className={`whitespace-nowrap text-[10px] uppercase tracking-widest font-medium px-2 py-0.5 rounded-full ${
                reel.is_archived
                  ? 'bg-neutral-500/10 text-neutral-500'
                  : reel.status === 'completed'
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-cyan-500/10 text-cyan-300'
              }`}>
                {reel.is_archived ? 'archived' : reel.status}
              </span>
              <span className="whitespace-nowrap text-[10px] uppercase tracking-widest font-medium px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300">
                {reel.beat_count} beats
              </span>
              <span className="flex items-center gap-1 whitespace-nowrap text-[10px] text-neutral-600">
                <Clock className="w-3 h-3" />
                {formatDate(reel.updated_at)}
              </span>
            </div>
          </div>
        </button>

        <RowActionsMenu
          ariaLabel={`Actions for ${reel.title}`}
          busy={actionId === reel.id}
          actions={buildStoryActions(reel, 'reel')}
        />
      </motion.div>
    ));
  };

  const renderStorylines = () => {
    if (savedStorylines.length === 0) {
      return renderEmptyState(Library, 'No saved storylines', 'Completed storylines will appear here automatically.');
    }
    return savedStorylines.map((item) => {
      const title = item.storyline?.title || 'Untitled Storyline';
      const actions: RowAction[] = [
        {
          key: 'play',
          label: 'Play storyline',
          icon: Play,
          href: `/storyline/${item.storyline_id}`,
          onSelect: () => handleOpenStoryline(item),
        },
        {
          key: 'share',
          label: 'Share storyline',
          icon: Share2,
          onSelect: () => handleShareStoryline(item),
        },
        ...(item.is_owner
          ? [{
              key: 'cover',
              label: 'Manage cover',
              icon: ImageIcon,
              onSelect: () => setManagedStorylineId(item.storyline_id),
            } satisfies RowAction]
          : []),
        {
          key: 'remove',
          label: 'Remove from saved',
          icon: Trash2,
          tone: 'danger',
          onSelect: () => handleUnsaveStoryline(item.storyline_id),
          disabled: actionId === item.storyline_id,
        },
      ];

      return (
        <motion.div
          key={item.id}
          layout
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="group relative flex items-center gap-2 rounded-2xl bg-neutral-900/60 border border-white/5 p-2 hover:border-white/15 transition-all overflow-hidden"
        >
          <Link
            href={`/storyline/${item.storyline_id}`}
            onClick={() => handleOpenStoryline(item)}
            className="flex min-w-0 flex-1 items-center gap-3"
          >
            {renderThumbnail(
              item.storyline?.thumbnail_url,
              item.storyline?.thumbnail_is_storyboard,
              title,
              Library,
              isPortraitRow(item.storyline)
            )}
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-serif text-neutral-200 group-hover:text-white transition-colors truncate">
                {title}
              </h3>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                <span className="whitespace-nowrap text-[10px] uppercase tracking-widest font-medium px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400">
                  {item.storyline?.beat_count || 0} beats
                </span>
                {item.storyline && renderOrientationBadge(item.storyline)}
                <span className="flex items-center gap-1 whitespace-nowrap text-[10px] text-neutral-600">
                  <Clock className="w-3 h-3" />
                  {formatDate(item.saved_at)}
                </span>
              </div>
            </div>
          </Link>

          <RowActionsMenu
            ariaLabel={`Actions for ${title}`}
            busy={actionId === item.storyline_id}
            actions={actions}
          />
        </motion.div>
      );
    });
  };

  const renderCharacters = () => {
    const filtered = characters.filter((master) =>
      characterFilter === 'archived'
        ? Boolean(master.archivedAt)
        : characterFilter === 'all'
          ? true
          : !master.archivedAt
    );
    return (
      <>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-neutral-500">
            Saved characters can join new stories and future episodes.
          </p>
          <FilterDropdown
            value={characterFilter}
            onChange={setCharacterFilter}
            ariaLabel="Filter characters"
            options={[
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
              { value: 'all', label: 'All' },
            ]}
          />
        </div>
        {filtered.length === 0 ? (
          renderEmptyState(
            UserRound,
            characterFilter === 'archived' ? 'No archived characters' : 'No saved characters yet',
            'Save a character from one of your stories and it will appear here, ready to reuse.'
          )
        ) : (
          filtered.map((master) => (
            <CharacterMasterCard key={master.id} master={master} onOpen={(m) => setOpenMasterId(m.id)} />
          ))
        )}
      </>
    );
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
              {visibleTabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = effectiveTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 py-3 px-1 text-[11px] font-medium transition-all border-b-2 sm:gap-2 sm:px-2 sm:text-xs ${
                      isActive
                        ? 'border-emerald-400 text-emerald-400'
                        : 'border-transparent text-neutral-500 hover:text-neutral-300'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="truncate">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {showSkeletons ? (
                renderLoadingSkeletons()
              ) : effectiveTab === 'my-stories' ? (
                <>
                  {renderMyStories()}
                  {renderLoadMore('my-stories')}
                </>
              ) : effectiveTab === 'reels' ? (
                <>
                  {renderReels()}
                  {renderLoadMore('reels')}
                </>
              ) : effectiveTab === 'characters' ? (
                renderCharacters()
              ) : (
                <>
                  {renderStorylines()}
                  {renderLoadMore('storylines')}
                </>
              )}
            </div>
          </motion.div>

          <ManageStorylineCoverDialog
            isOpen={Boolean(managedStorylineId)}
            storylineId={managedStorylineId}
            onClose={() => setManagedStorylineId(null)}
          />

          <CharacterMasterDialog
            master={characters.find((master) => master.id === openMasterId) ?? null}
            onClose={() => setOpenMasterId(null)}
          />
        </>
      )}
    </AnimatePresence>
  );
}
