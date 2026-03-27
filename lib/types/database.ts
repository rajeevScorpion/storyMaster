export interface DbProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface DbStory {
  id: string;
  user_id: string;
  title: string;
  user_prompt: string;
  genre: string | null;
  tone: string | null;
  visual_style: string | null;
  target_age: string | null;
  story_config: Record<string, unknown> | null;
  story_map: Record<string, unknown>;
  characters: Record<string, unknown>[] | null;
  setting: Record<string, unknown> | null;
  status: string;
  narrator_voice: string | null;
  is_archived: boolean;
  current_node_id: string | null;
  cover_image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbStoryline {
  id: string;
  story_id: string;
  user_id: string;
  title: string;
  beat_count: number;
  cover_image_url: string | null;
  node_path: string[];
  beats: Record<string, unknown>[];
  choices: Record<string, unknown>[];
  author_name: string | null;
  is_public: boolean;
  path_hash: string | null;
  like_count: number;
  view_count: number;
  created_at: string;
}

export interface GalleryStoryline {
  id: string;
  title: string;
  cover_image_url: string | null;
  beat_count: number;
  author_name: string | null;
  story_id: string | null;
  like_count: number;
  view_count: number;
  created_at: string;
}

export interface DbBeat {
  id: string;
  story_id: string;
  node_id: string;
  beat_number: number;
  parent_node_id: string | null;
  selected_option_id: string | null;
  generated_by: string | null;
  title: string;
  is_ending: boolean;
  story_text: string;
  scene_summary: string | null;
  options: Record<string, unknown>[] | null;
  characters: Record<string, unknown>[] | null;
  continuity_notes: string[] | null;
  image_prompt: string | null;
  clues: string[] | null;
  next_beat_goal: string | null;
  ending_forecast: string[] | null;
  image_url: string | null;
  audio_url: string | null;
  created_at: string;
}

export interface DbStorylineBeat {
  id: string;
  storyline_id: string;
  beat_id: string;
  position: number;
  choice_label: string | null;
}

export interface DbSavedStoryline {
  id: string;
  user_id: string;
  storyline_id: string;
  saved_at: string;
}

export interface DbExploredStory {
  id: string;
  user_id: string;
  story_id: string;
  last_node_id: string | null;
  explored_at: string;
  updated_at: string;
}

// Gallery types

export interface GalleryItem {
  id: string;
  type: 'tree' | 'storyline';
  title: string;
  coverImageUrl: string | null;
  authorName: string | null;
  storyId: string;
  beatCount: number | null;
  genre: string | null;
  ageGroup: string | null;
  settingCountry: string | null;
  likeCount: number;
  viewCount: number;
  createdAt: string;
}

export interface DbStorylineLike {
  id: string;
  user_id: string;
  storyline_id: string;
  created_at: string;
}

export interface DbStorylineView {
  id: string;
  user_id: string;
  storyline_id: string;
  viewed_at: string;
}

export interface GalleryFilters {
  search: string;
  type: 'storylines' | 'trees';
  genre: string;
  ageGroup: string;
  country: string;
  language: string;
}

export interface GalleryPage {
  items: GalleryItem[];
  total: number;
  hasMore: boolean;
}

export interface GenreSection {
  genre: string;
  items: GalleryItem[];
}
