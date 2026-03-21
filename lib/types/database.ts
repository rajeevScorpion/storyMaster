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
  created_at: string;
}

export interface GalleryStoryline {
  id: string;
  title: string;
  cover_image_url: string | null;
  beat_count: number;
  author_name: string | null;
  created_at: string;
}
