export type LearnChapterId = 'why' | 'how' | 'build';
export type LearnAccent = 'emerald' | 'ember' | 'balanced';
export type LearnScreenshotKey =
  | 'idea-entry-desktop'
  | 'character-setup'
  | 'story-beats'
  | 'scene-editing'
  | 'story-playback';
export type LearnVisualType =
  | 'statement'
  | 'audiences'
  | 'tool-fragmentation'
  | 'learning-curve'
  | 'guided-comparison'
  | 'calm-content'
  | 'guided-space'
  | 'story-equation'
  | 'timeline'
  | 'idea-entry'
  | 'story-beats'
  | 'character-world'
  | 'story-playback'
  | 'story-controls'
  | 'best-practices'
  | 'use-cases'
  | 'story-universe'
  | 'cta';

export interface LearnChapter {
  id: LearnChapterId;
  title: string;
  shortTitle: string;
  range: readonly [number, number];
}

export interface LearnSlide {
  id: string;
  chapter: LearnChapterId;
  index: number;
  eyebrow: string;
  title: string;
  body: string;
  visualType: LearnVisualType;
  accent: LearnAccent;
  supportingPoints?: readonly string[];
  expandableDetail?: string;
  screenshotKey?: LearnScreenshotKey;
  background?: string;
  backgroundPosition?: string;
}

export const LEARN_CHAPTERS: readonly LearnChapter[] = [
  {
    id: 'why',
    title: 'Why Kissago Exists',
    shortTitle: 'Why',
    range: [1, 7],
  },
  {
    id: 'how',
    title: 'How Kissago Works',
    shortTitle: 'How',
    range: [8, 15],
  },
  {
    id: 'build',
    title: 'What You Can Build',
    shortTitle: 'Build',
    range: [16, 18],
  },
] as const;

export const LEARN_SLIDES: readonly LearnSlide[] = [
  {
    id: 'welcome',
    chapter: 'why',
    index: 1,
    eyebrow: 'A guided storytelling platform',
    title: 'Turn an idea into a narrated visual story.',
    body: 'Kissago brings words, images, narration, spoken text, movement and effects into one connected creative journey.',
    visualType: 'statement',
    accent: 'balanced',
    background: '/learn/backgrounds/bg-01-story-seed.webp',
    backgroundPosition: 'center',
  },
  {
    id: 'everyone-has-a-story',
    chapter: 'why',
    index: 2,
    eyebrow: 'Everyone has something to tell',
    title: 'Imagination is not limited by age. Creation tools often are.',
    body: 'The idea is already there. Presenting it well is the difficult part.',
    visualType: 'audiences',
    accent: 'ember',
    supportingPoints: [
      'A child with a character',
      'A parent with a bedtime idea',
      'A teacher explaining a concept',
      'A creator building an episodic world',
    ],
  },
  {
    id: 'fragmented-creation',
    chapter: 'why',
    index: 3,
    eyebrow: 'Story creation is fragmented',
    title: 'One story can require too many tools.',
    body: 'Writing, images, voice, timing, subtitles, transitions, effects, editing and export are often spread across different applications.',
    visualType: 'tool-fragmentation',
    accent: 'ember',
    supportingPoints: [
      'Writing',
      'Images',
      'Voice',
      'Timing',
      'Spoken text',
      'Transitions',
      'Effects',
      'Export',
    ],
    background: '/learn/backgrounds/bg-02-fragmented-creation.webp',
  },
  {
    id: 'learning-curve',
    chapter: 'why',
    index: 4,
    eyebrow: 'The learning curve becomes the barrier',
    title: 'People begin with a story and end up learning software.',
    body: 'The technical process can consume the time and confidence that should have gone into the idea itself.',
    visualType: 'learning-curve',
    accent: 'ember',
    supportingPoints: ['Learn the interface', 'Move files', 'Match timing', 'Fix formats'],
    background: '/learn/backgrounds/bg-02-fragmented-creation.webp',
  },
  {
    id: 'faster-is-not-better',
    chapter: 'why',
    index: 5,
    eyebrow: 'Speed needs intention',
    title: 'AI can generate quickly. Meaning still needs direction.',
    body: 'Without thoughtful control, generated content can become inconsistent, visually noisy or narratively weak. Speed should support intention, not replace it.',
    visualType: 'guided-comparison',
    accent: 'balanced',
  },
  {
    id: 'calm-attention',
    chapter: 'why',
    index: 6,
    eyebrow: 'Attention without overstimulation',
    title: 'A story can hold attention without competing for it.',
    body: 'Pace, narration and visual detail should work together rather than overwhelm one another.',
    visualType: 'calm-content',
    accent: 'balanced',
    expandableDetail:
      'Kissago helps parents, educators and creators make deliberate choices about pacing, visuals and narrative progression.',
    background: '/learn/backgrounds/bg-03-calm-attention.webp',
    backgroundPosition: 'center',
  },
  {
    id: 'what-is-missing',
    chapter: 'why',
    index: 7,
    eyebrow: 'What is missing?',
    title: 'A simpler way to create, with more meaningful control.',
    body: 'People need one guided environment where they can shape an idea, review what is generated and decide how the story should feel.',
    visualType: 'guided-space',
    accent: 'emerald',
  },
  {
    id: 'process-together',
    chapter: 'how',
    index: 8,
    eyebrow: 'Kissago brings the process together',
    title: 'Story + Images + Narration + Spoken Text + Motion + Effects',
    body: 'Kissago connects the essential parts of multimedia storytelling so you can focus on meaning, characters and flow.',
    visualType: 'story-equation',
    accent: 'balanced',
    supportingPoints: ['Story', 'Images', 'Narration', 'Spoken text', 'Motion', 'Effects'],
    background: '/learn/backgrounds/bg-04-story-convergence.webp',
  },
  {
    id: 'minutes',
    chapter: 'how',
    index: 9,
    eyebrow: 'From idea to story in minutes',
    title: 'Begin with an idea. Move quickly toward something you can experience.',
    body: 'Depending on the story and level of refinement, a first version can often be created in approximately five to ten minutes.',
    visualType: 'timeline',
    accent: 'emerald',
    supportingPoints: ['Idea', 'Story beats', 'Characters', 'Scenes', 'Narration', 'Playable story'],
  },
  {
    id: 'begin-with-what-you-have',
    chapter: 'how',
    index: 10,
    eyebrow: 'Begin with what you have',
    title: 'A sentence is enough to begin.',
    body: 'Start with a spoken thought, a learning objective, a character, a personal experience, an existing premise or a simple question.',
    visualType: 'idea-entry',
    accent: 'balanced',
    supportingPoints: ['A thought', 'A character', 'A question'],
    screenshotKey: 'idea-entry-desktop',
  },
  {
    id: 'shape-the-story',
    chapter: 'how',
    index: 11,
    eyebrow: 'Shape the story',
    title: 'Kissago turns the idea into a sequence.',
    body: 'The story is organised into beats, scenes or panels so each moment has a clear purpose and the narrative can progress naturally.',
    visualType: 'story-beats',
    accent: 'emerald',
    screenshotKey: 'story-beats',
    supportingPoints: ['A curious beginning', 'A meaningful choice', 'A world that responds', 'A moment to continue'],
    expandableDetail:
      'Review, edit and refine the structure instead of accepting an uncontrolled block of generated content.',
  },
  {
    id: 'characters-and-worlds',
    chapter: 'how',
    index: 12,
    eyebrow: 'Build characters and worlds',
    title: 'Create once. Continue with consistency.',
    body: 'Character references, names, traits and environments help the story remain recognisable across scenes and future episodes.',
    visualType: 'character-world',
    accent: 'balanced',
    screenshotKey: 'character-setup',
    supportingPoints: ['One character', 'Distinct traits', 'Recurring places', 'Future episodes'],
    background: '/learn/backgrounds/bg-05-character-continuity.webp',
  },
  {
    id: 'bring-to-life',
    chapter: 'how',
    index: 13,
    eyebrow: 'Bring the story to life',
    title: 'The story becomes something you can watch, read and hear.',
    body: 'Images, narration, synchronized text, transitions, camera movement and environmental effects come together in the final experience.',
    visualType: 'story-playback',
    accent: 'balanced',
    screenshotKey: 'story-playback',
    supportingPoints: ['Narration', 'Spoken text', 'Movement', 'Atmosphere'],
  },
  {
    id: 'remain-in-control',
    chapter: 'how',
    index: 14,
    eyebrow: 'You remain in control',
    title: 'Refine one part without starting again.',
    body: 'Edit the story, adjust pacing, regenerate an image, improve narration or refine individual scenes while keeping the larger story intact.',
    visualType: 'story-controls',
    accent: 'emerald',
    screenshotKey: 'scene-editing',
    supportingPoints: ['Edit story', 'Adjust pace', 'Regenerate image', 'Refine narration'],
  },
  {
    id: 'best-practices',
    chapter: 'how',
    index: 15,
    eyebrow: 'Better stories begin with better choices',
    title: 'A few thoughtful decisions improve the whole experience.',
    body: 'Kissago keeps the creative process approachable while leaving the important decisions with you.',
    visualType: 'best-practices',
    accent: 'emerald',
    supportingPoints: [
      'Begin with one clear central idea',
      'Know who the story is for',
      'Keep the first cast manageable',
      'Give characters clear traits',
      'Choose a pace that supports the narrative',
      'Use effects to strengthen meaning',
      'Review text and narration before export',
      'Preserve continuity in the next episode',
    ],
  },
  {
    id: 'many-story-forms',
    chapter: 'build',
    index: 16,
    eyebrow: 'More than one kind of story',
    title: 'The same platform can support many forms of storytelling.',
    body: 'A single guided flow can open into personal, educational and character-led ways of sharing an idea.',
    visualType: 'use-cases',
    accent: 'balanced',
    supportingPoints: [
      'Parent-created stories',
      'Classroom explainers',
      'Educational narratives',
      "Children's creative projects",
      'Social storytelling',
      'Visual presentations',
      'Character-led series',
      'Personal and cultural stories',
    ],
  },
  {
    id: 'story-world',
    chapter: 'build',
    index: 17,
    eyebrow: 'From one character to a story world',
    title: 'One story can become a continuing creative identity.',
    body: 'Begin with one character, build new episodes, develop recurring locations and gradually form a connected story world.',
    visualType: 'story-universe',
    accent: 'balanced',
    supportingPoints: ['Character', 'Episode 01', 'Episode 02', 'Connected world'],
    expandableDetail:
      'Kissago supports character-led continuation today. Broader creator-economy and marketplace ideas remain a future direction.',
    background: '/learn/backgrounds/bg-06-episodic-world.webp',
  },
  {
    id: 'create',
    chapter: 'build',
    index: 18,
    eyebrow: 'Create your first story',
    title: 'The best way to understand Kissago is to begin.',
    body: 'Start with a thought, a character or a question. Kissago will help shape it into an experience you can share.',
    visualType: 'cta',
    accent: 'emerald',
    background: '/learn/backgrounds/bg-07-create-invitation.webp',
    backgroundPosition: 'center',
  },
] as const;

export function getLearnChapter(chapterId: LearnChapterId): LearnChapter {
  return LEARN_CHAPTERS.find((chapter) => chapter.id === chapterId) ?? LEARN_CHAPTERS[0];
}

export interface LearnScreenshotAsset {
  src: string;
  alt: string;
  caption: string;
}

/**
 * Add privacy-reviewed, stable product captures here as they become available.
 * Slides fall back to code-native product-flow compositions while this map is empty.
 */
export const LEARN_SCREENSHOT_ASSETS: Partial<
  Record<LearnScreenshotKey, LearnScreenshotAsset>
> = {};
