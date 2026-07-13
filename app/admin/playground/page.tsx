import PlaygroundStudio from '@/components/admin/PlaygroundStudio';

const STORY_TASK_KEYS = [
  'story_generation',
  'seed_plan_generation',
  'seeded_beat_materialization',
  'story_bible_generation',
  'visual_prompt',
  'image_generation',
  'portrait_generation',
  'tts',
  'voice_selection',
] as const;

export default function PlaygroundPage() {
  return (
    <PlaygroundStudio
      title="Story Playground"
      description="Tune story prompts, models, drafts, tests, and published prompt versions."
      taskKeys={[...STORY_TASK_KEYS]}
      initialTask="story_generation"
    />
  );
}
