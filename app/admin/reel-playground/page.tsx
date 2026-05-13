import PlaygroundStudio from '@/components/admin/PlaygroundStudio';

const REEL_TASK_KEYS = ['reel_story_generation', 'reel_visual_prompt', 'reel_image_generation', 'reel_tts'] as const;

export default function ReelPlaygroundPage() {
  return (
    <PlaygroundStudio
      title="Reel Playground"
      description="Tune short-form Reel Story prompts against the same draft, history, test, and publish workflow as the main playground."
      taskKeys={[...REEL_TASK_KEYS]}
      initialTask="reel_story_generation"
    />
  );
}

