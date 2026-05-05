import type { StoryBeat, StorySession } from '@/lib/types/story';
import type { StorylineFormat, StorylineOrientation } from '@/lib/types/database';

export type StoryCoverPromptVariant = 'social' | 'youtube' | 'reel' | 'audio';

export type StoryCoverPromptInput = {
  title: string;
  userPrompt?: string | null;
  genre?: string | null;
  tone?: string | null;
  targetAge?: string | null;
  language?: string | null;
  visualStyle?: string | null;
  setting?: string | null;
  summary?: string | null;
  storyFormat?: StorylineFormat | null;
  orientation?: StorylineOrientation | null;
  characters?: Array<{ name?: string; type?: string; appearanceSummary?: string; personalitySummary?: string }>;
  beats?: Array<Pick<StoryBeat, 'title' | 'sceneSummary' | 'storyText' | 'characters'>>;
  narrationMood?: string | null;
};

function compact(value: unknown, maxLength = 260): string {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function joinLines(lines: Array<string | false | null | undefined>): string {
  return lines.filter(Boolean).join('\n');
}

function buildCharacterLine(characters?: StoryCoverPromptInput['characters']): string {
  const items = (characters ?? [])
    .filter((character) => character?.name)
    .slice(0, 5)
    .map((character) => {
      const details = [character.type, character.appearanceSummary, character.personalitySummary]
        .map((value) => compact(value, 90))
        .filter(Boolean)
        .join(', ');
      return details ? `${character.name}: ${details}` : String(character.name);
    });
  return items.length ? items.join('; ') : 'Use symbolic or story-specific figures if no named character is clear.';
}

function buildKeySceneLine(beats?: StoryCoverPromptInput['beats']): string {
  const scenes = (beats ?? [])
    .slice(0, 6)
    .map((beat, index) => {
      const scene = compact(beat.sceneSummary || beat.storyText || beat.title, 120);
      return scene ? `${index + 1}. ${scene}` : '';
    })
    .filter(Boolean);
  return scenes.length ? scenes.join(' ') : 'Infer key scenes from the title, premise, and mood.';
}

export function buildStoryCoverPromptInputFromSession(
  session: StorySession,
  beats: StoryBeat[],
  options: { storyFormat?: StorylineFormat | null } = {}
): StoryCoverPromptInput {
  return {
    title: session.title,
    userPrompt: session.userPrompt,
    genre: session.genre,
    tone: session.tone,
    targetAge: session.targetAge || session.storyConfig.ageGroup,
    language: session.storyConfig.language,
    visualStyle: session.visualStyle,
    setting: session.setting?.world || session.storyConfig.settingCountry,
    summary: beats.map((beat) => compact(beat.storyText, 140)).filter(Boolean).join(' '),
    storyFormat: options.storyFormat ?? 'visual_story',
    orientation: session.storyConfig.isVerticalStory || session.storyConfig.aspectRatio === '9:16' ? 'portrait' : 'landscape',
    characters: session.characters,
    beats,
    narrationMood: session.narratorVoice || session.narrationVoiceMode || session.tone,
  };
}

export function generateStoryCoverPrompt(
  input: StoryCoverPromptInput,
  options: { variant: StoryCoverPromptVariant } = { variant: 'social' }
): string {
  const title = compact(input.title || 'Untitled Story', 90);
  const characters = buildCharacterLine(input.characters);
  const keyScenes = buildKeySceneLine(input.beats);
  const sharedContext = [
    `Story title: ${title}`,
    input.userPrompt && `Original premise: ${compact(input.userPrompt, 220)}`,
    input.summary && `Story summary: ${compact(input.summary, 420)}`,
    `Main characters: ${characters}`,
    `Key scenes: ${keyScenes}`,
    input.setting && `Setting: ${compact(input.setting, 120)}`,
    input.genre && `Genre: ${compact(input.genre, 80)}`,
    input.tone && `Emotional tone: ${compact(input.tone, 90)}`,
    input.targetAge && `Target age group: ${compact(input.targetAge, 60)}`,
    input.language && `Language: ${compact(input.language, 50)}`,
    input.visualStyle && `Visual style: ${compact(input.visualStyle, 160)}`,
  ];

  if (options.variant === 'reel') {
    return joinLines([
      'Create a 9:16 cinematic vertical poster / reel thumbnail for this Kissago story.',
      ...sharedContext,
      'Composition requirements: main character dominant, expressive face and body language, secondary scenes or characters layered behind them, bold readable title typography, safe margins for face and title, avoid placing the title too close to top or bottom edges, match the story mood and visual style, suitable for Instagram Reels, YouTube Shorts, and Facebook Reels.',
      'Avoid clutter, tiny text, low contrast typography, watermarks, UI chrome, or extra captions.',
    ]);
  }

  if (options.variant === 'audio') {
    return joinLines([
      'Create a cinematic illustrated audiobook-style social cover for this audio story.',
      ...sharedContext,
      input.narrationMood && `Narration mood: ${compact(input.narrationMood, 120)}`,
      'Composition requirements: visually interpret the story mood and narration, symbolic or character-led composition, bold readable story title typography, strong small-size readability, elegant audiobook/poster feel, no clutter, no tiny unreadable text, no watermarks, no UI chrome.',
      'The cover should work as a WhatsApp preview, social thumbnail, and audiobook poster.',
    ]);
  }

  const kind = options.variant === 'youtube' ? 'YouTube thumbnail' : 'social share cover';
  return joinLines([
    `Create a cinematic 16:9 movie-poster-like ${kind} for this Kissago story.`,
    ...sharedContext,
    'Composition requirements: cinematic collage of key characters and scenes, bold readable story title typography, strong emotional hook, expressive characters, clear focal point, high contrast, readable at small preview size, suitable for YouTube thumbnail, WhatsApp preview, and social sharing.',
    'Avoid clutter, small unreadable text, watermarks, UI chrome, extra captions, and duplicate copies of the same named character unless the scene clearly requires it.',
  ]);
}
