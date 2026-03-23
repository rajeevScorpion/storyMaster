export type TabId = 'explored' | 'my-stories' | 'storylines';

export interface SavedStory {
  id: string;
  title: string;
  status: string;
  is_archived: boolean;
  updated_at: string;
  user_prompt: string;
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
  storyline: {
    id: string;
    title: string;
    beat_count: number;
    cover_image_url: string | null;
    author_name: string | null;
    story_id: string;
  };
}
