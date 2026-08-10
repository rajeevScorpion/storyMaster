export type TabId = 'explored' | 'my-stories' | 'storylines' | 'reels' | 'characters';

/**
 * Rows fetched per drawer tab page. The lists used to be unbounded — every
 * story a user had ever made, plus a thumbnail lookup over all of them, on
 * every load — which got slower for good with each story written. A page plus
 * "Load more" keeps the first paint flat no matter how large the library gets.
 */
export const MY_STORIES_PAGE_SIZE = 30;

/** A page of list rows plus whether another page exists behind it. */
export interface PagedList<T> {
  items: T[];
  hasMore: boolean;
}

/** Tabs that page; the Characters tab loads as one snapshot. */
export type PagedTabId = 'my-stories' | 'storylines' | 'reels';

/**
 * Paging window for a list query. Lives here rather than beside the loaders
 * because a `'use server'` module may only export async functions.
 */
export interface ListPageInput {
  limit?: number;
  offset?: number;
}

export interface SavedStory {
  id: string;
  title: string;
  status: string;
  is_archived: boolean;
  updated_at: string;
  user_prompt: string;
  cover_image_url: string | null;
  episode_number?: number | null;
  is_vertical_story?: boolean | null;
  aspect_ratio?: string | null;
  /** Display-ready list thumbnail: cover image, else the first beat's image. */
  thumbnail_url?: string | null;
  /** True when the thumbnail is a storyboard grid (render its first panel). */
  thumbnail_is_storyboard?: boolean;
}

export interface UserReel {
  id: string;
  title: string;
  status: string;
  is_archived: boolean;
  updated_at: string;
  user_prompt: string;
  story_kind: 'reel';
  beat_count: number;
  cover_image_url: string | null;
  is_vertical_story?: boolean | null;
  aspect_ratio?: string | null;
  /** Display-ready list thumbnail: cover image, else the first beat's image. */
  thumbnail_url?: string | null;
  /** True when the thumbnail is a storyboard grid (render its first panel). */
  thumbnail_is_storyboard?: boolean;
}

export interface ExploredStory {
  id: string;
  story_id: string;
  last_node_id: string | null;
  updated_at: string;
  story: {
    id: string;
    title: string;
    user_prompt: string;
    status: string;
    user_id: string;
  };
}

export interface SavedStorylineItem {
  id: string;
  storyline_id: string;
  saved_at: string;
  is_owner: boolean;
  storyline: {
    id: string;
    title: string;
    beat_count: number;
    cover_image_url: string | null;
    author_name: string | null;
    story_id: string;
    is_vertical_story?: boolean | null;
    aspect_ratio?: string | null;
    /** Display-ready list thumbnail: cover image, else the first beat's image. */
    thumbnail_url?: string | null;
    /** True when the thumbnail is a storyboard grid (render its first panel). */
    thumbnail_is_storyboard?: boolean;
  };
}
