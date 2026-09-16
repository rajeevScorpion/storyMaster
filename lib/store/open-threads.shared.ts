// Pure, isomorphic (Unit 5 Q3). Previously this also re-injected every non-
// ending beat's continuityNotes as an "open thread", which meant a purely
// visual note ("yellow hair clips") persisted in the story-generation prompt
// indefinitely -- long after the beat that needed it had passed, and
// regardless of any later time jump that made it stop being true. nextBeatGoal
// is the story's own forward-looking summary and is the only source this uses
// now; the composer's continuityNotes are handled separately, at image-prompt
// time, by resolveContinuityContradictions
// (lib/ai/storyboard-plan.shared.ts).
import type { StoryBeat } from '@/lib/types/story';

const MAX_OPEN_THREADS = 6;

export function deriveOpenThreads(beats: StoryBeat[]): string[] {
  const threads = beats
    .filter((beat) => !beat.isEnding)
    .map((beat) => beat.nextBeatGoal.trim())
    .filter(Boolean);

  return Array.from(new Set(threads)).slice(-MAX_OPEN_THREADS);
}
