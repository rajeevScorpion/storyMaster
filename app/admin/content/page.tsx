'use client';

import { useState, useTransition } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, BookOpen, GitBranch, EyeOff, Trash2,
  Loader2, AlertTriangle, X, ChevronDown,
} from 'lucide-react';
import {
  searchStories, searchStorylines,
  adminUnpublishStoryline, adminDeleteStoryline, adminDeleteStory,
  type AdminStoryResult, type AdminStorylineResult,
} from '@/app/actions/admin';

type Tab = 'storylines' | 'stories';
type StorylineSearchBy = 'title' | 'id' | 'story_id';
type StorySearchBy = 'title' | 'id';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function truncateId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}...` : id;
}

export default function ContentPage() {
  const [tab, setTab] = useState<Tab>('storylines');
  const [query, setQuery] = useState('');
  const [storylineSearchBy, setStorylineSearchBy] = useState<StorylineSearchBy>('title');
  const [storySearchBy, setStorySearchBy] = useState<StorySearchBy>('title');
  const [isPending, startTransition] = useTransition();

  const [storylines, setStorylines] = useState<AdminStorylineResult[]>([]);
  const [stories, setStories] = useState<AdminStoryResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Confirm dialog state
  const [confirmAction, setConfirmAction] = useState<{
    type: 'unpublish' | 'delete-storyline' | 'delete-story';
    id: string;
    title: string;
  } | null>(null);
  const [confirmInput, setConfirmInput] = useState('');
  const [isActing, setIsActing] = useState(false);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setError(null);
    startTransition(async () => {
      try {
        if (tab === 'storylines') {
          const results = await searchStorylines(query, storylineSearchBy);
          setStorylines(results);
        } else {
          const results = await searchStories(query, storySearchBy);
          setStories(results);
        }
        setSearched(true);
      } catch (err: any) {
        setError(err.message);
      }
    });
  }

  async function executeAction() {
    if (!confirmAction) return;
    setIsActing(true);
    try {
      if (confirmAction.type === 'unpublish') {
        await adminUnpublishStoryline(confirmAction.id);
        setStorylines(prev => prev.map(s =>
          s.id === confirmAction.id ? { ...s, is_public: false } : s
        ));
      } else if (confirmAction.type === 'delete-storyline') {
        await adminDeleteStoryline(confirmAction.id);
        setStorylines(prev => prev.filter(s => s.id !== confirmAction.id));
      } else if (confirmAction.type === 'delete-story') {
        await adminDeleteStory(confirmAction.id);
        setStories(prev => prev.filter(s => s.id !== confirmAction.id));
      }
      setConfirmAction(null);
      setConfirmInput('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsActing(false);
    }
  }

  const isDestructive = confirmAction?.type !== 'unpublish';
  const canConfirm = isDestructive ? confirmInput === 'DELETE' : true;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-serif">Content Management</h1>

      {/* Tabs */}
      <div className="flex gap-2">
        {([
          { key: 'storylines' as Tab, label: 'Storylines', icon: BookOpen },
          { key: 'stories' as Tab, label: 'Stories', icon: GitBranch },
        ]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => { setTab(key); setSearched(false); setError(null); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
              tab === key
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'text-neutral-400 hover:text-neutral-200 bg-white/5 border border-white/10'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-3 items-end">
        <div className="flex-1">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`Search ${tab} by ${tab === 'storylines' ? storylineSearchBy : storySearchBy}...`}
            className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-emerald-500/50 transition-colors"
          />
        </div>
        <div className="relative">
          <select
            value={tab === 'storylines' ? storylineSearchBy : storySearchBy}
            onChange={e => {
              if (tab === 'storylines') setStorylineSearchBy(e.target.value as StorylineSearchBy);
              else setStorySearchBy(e.target.value as StorySearchBy);
            }}
            className="appearance-none px-4 py-2.5 pr-8 bg-white/5 border border-white/10 rounded-lg text-neutral-300 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors cursor-pointer"
          >
            <option value="title">Title</option>
            <option value="id">ID</option>
            {tab === 'storylines' && <option value="story_id">Story ID</option>}
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
        </div>
        <button
          type="submit"
          disabled={isPending || !query.trim()}
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
        >
          {isPending ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          Search
        </button>
      </form>

      {/* Error */}
      {error && (
        <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Results */}
      {searched && tab === 'storylines' && (
        <StorylineResults
          items={storylines}
          onUnpublish={item => { setConfirmAction({ type: 'unpublish', id: item.id, title: item.title }); setConfirmInput(''); }}
          onDelete={item => { setConfirmAction({ type: 'delete-storyline', id: item.id, title: item.title }); setConfirmInput(''); }}
        />
      )}

      {searched && tab === 'stories' && (
        <StoryResults
          items={stories}
          onDelete={item => { setConfirmAction({ type: 'delete-story', id: item.id, title: item.title }); setConfirmInput(''); }}
        />
      )}

      {/* Confirm Dialog */}
      <AnimatePresence>
        {confirmAction && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => !isActing && setConfirmAction(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="bg-neutral-900 border border-white/10 rounded-2xl p-6 max-w-md w-full mx-4 space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${isDestructive ? 'bg-red-500/20' : 'bg-amber-500/20'}`}>
                  {isDestructive ? <Trash2 size={20} className="text-red-400" /> : <EyeOff size={20} className="text-amber-400" />}
                </div>
                <h2 className="text-lg font-serif">
                  {confirmAction.type === 'unpublish' ? 'Unpublish Storyline' :
                   confirmAction.type === 'delete-storyline' ? 'Delete Storyline' : 'Delete Story'}
                </h2>
              </div>

              <p className="text-sm text-neutral-400">
                {confirmAction.type === 'unpublish'
                  ? <>This will hide <span className="text-neutral-200">&quot;{confirmAction.title}&quot;</span> from the public gallery.</>
                  : <>This will permanently delete <span className="text-neutral-200">&quot;{confirmAction.title}&quot;</span> and all associated data. This cannot be undone.</>
                }
              </p>

              {isDestructive && (
                <div>
                  <label className="text-xs text-neutral-500 block mb-1.5">
                    Type <span className="text-red-400 font-mono">DELETE</span> to confirm
                  </label>
                  <input
                    type="text"
                    value={confirmInput}
                    onChange={e => setConfirmInput(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-neutral-100 font-mono text-sm focus:outline-none focus:border-red-500/50"
                    autoFocus
                  />
                </div>
              )}

              <div className="flex gap-3 justify-end pt-2">
                <button
                  onClick={() => { setConfirmAction(null); setConfirmInput(''); }}
                  disabled={isActing}
                  className="px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={executeAction}
                  disabled={!canConfirm || isActing}
                  className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-50 ${
                    isDestructive
                      ? 'bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30'
                  }`}
                >
                  {isActing && <Loader2 size={14} className="animate-spin" />}
                  {confirmAction.type === 'unpublish' ? 'Unpublish' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function StorylineResults({
  items,
  onUnpublish,
  onDelete,
}: {
  items: AdminStorylineResult[];
  onUnpublish: (item: AdminStorylineResult) => void;
  onDelete: (item: AdminStorylineResult) => void;
}) {
  if (items.length === 0) {
    return <p className="text-neutral-500 text-sm py-8 text-center">No storylines found.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-neutral-500 border-b border-white/10 bg-white/5">
            <th className="px-4 py-3 font-medium">Title</th>
            <th className="px-4 py-3 font-medium">Author</th>
            <th className="px-4 py-3 font-medium">Story ID</th>
            <th className="px-4 py-3 font-medium">Public</th>
            <th className="px-4 py-3 font-medium text-right">Beats</th>
            <th className="px-4 py-3 font-medium text-right">Views</th>
            <th className="px-4 py-3 font-medium text-right">Likes</th>
            <th className="px-4 py-3 font-medium">Created</th>
            <th className="px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
              <td className="px-4 py-3 text-neutral-200 max-w-48 truncate" title={item.title}>{item.title}</td>
              <td className="px-4 py-3 text-neutral-400">{item.author_name || '—'}</td>
              <td className="px-4 py-3">
                <code className="text-xs text-neutral-500 bg-white/5 px-1.5 py-0.5 rounded" title={item.story_id}>
                  {truncateId(item.story_id)}
                </code>
              </td>
              <td className="px-4 py-3">
                <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                  item.is_public
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-neutral-700/50 text-neutral-500'
                }`}>
                  {item.is_public ? 'Yes' : 'No'}
                </span>
              </td>
              <td className="px-4 py-3 text-neutral-400 text-right">{item.beat_count}</td>
              <td className="px-4 py-3 text-neutral-400 text-right">{item.view_count}</td>
              <td className="px-4 py-3 text-neutral-400 text-right">{item.like_count}</td>
              <td className="px-4 py-3 text-neutral-400 whitespace-nowrap">{formatDate(item.created_at)}</td>
              <td className="px-4 py-3">
                <div className="flex gap-1">
                  {item.is_public && (
                    <button
                      onClick={() => onUnpublish(item)}
                      title="Unpublish"
                      className="p-1.5 rounded-md text-amber-400/70 hover:text-amber-300 hover:bg-amber-500/10 transition-colors"
                    >
                      <EyeOff size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => onDelete(item)}
                    title="Delete permanently"
                    className="p-1.5 rounded-md text-red-400/70 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StoryResults({
  items,
  onDelete,
}: {
  items: AdminStoryResult[];
  onDelete: (item: AdminStoryResult) => void;
}) {
  if (items.length === 0) {
    return <p className="text-neutral-500 text-sm py-8 text-center">No stories found.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-neutral-500 border-b border-white/10 bg-white/5">
            <th className="px-4 py-3 font-medium">Title</th>
            <th className="px-4 py-3 font-medium">Author</th>
            <th className="px-4 py-3 font-medium">Genre</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Archived</th>
            <th className="px-4 py-3 font-medium">Created</th>
            <th className="px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
              <td className="px-4 py-3 text-neutral-200 max-w-48 truncate" title={item.title}>{item.title}</td>
              <td className="px-4 py-3 text-neutral-400">{item.author_name || '—'}</td>
              <td className="px-4 py-3 text-neutral-400 capitalize">{item.genre || '—'}</td>
              <td className="px-4 py-3">
                <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                  item.status === 'active'
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : item.status === 'completed'
                    ? 'bg-indigo-500/20 text-indigo-300'
                    : 'bg-red-500/20 text-red-300'
                }`}>
                  {item.status}
                </span>
              </td>
              <td className="px-4 py-3">
                {item.is_archived && (
                  <span className="inline-block px-2 py-0.5 rounded text-xs bg-amber-500/20 text-amber-300">
                    Yes
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-neutral-400 whitespace-nowrap">{formatDate(item.created_at)}</td>
              <td className="px-4 py-3">
                <button
                  onClick={() => onDelete(item)}
                  title="Delete permanently"
                  className="p-1.5 rounded-md text-red-400/70 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
