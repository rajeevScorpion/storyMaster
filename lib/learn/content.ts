export type LearnChapterId = 'opportunity' | 'product' | 'platform' | 'partner';
export type LearnAccent = 'emerald' | 'ember' | 'balanced';
export type LearnScreenshotKey =
  | 'idea-entry-desktop'
  | 'character-setup'
  | 'story-beats'
  | 'scene-editing'
  | 'story-playback';
export type LearnVisualType =
  | 'hero-promise'
  | 'audiences'
  | 'tool-fragmentation'
  | 'learning-curve'
  | 'guided-comparison'
  | 'calm-content'
  | 'guided-space'
  | 'product-system'
  | 'story-equation'
  | 'timeline'
  | 'idea-entry'
  | 'story-beats'
  | 'character-world'
  | 'story-playback'
  | 'story-controls'
  | 'platform-flywheel'
  | 'character-portfolio'
  | 'business-model'
  | 'defensibility'
  | 'go-to-market'
  | 'roadmap'
  | 'collaboration-ask'
  | 'statement'
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
    id: 'opportunity',
    title: 'The Opportunity',
    shortTitle: 'Opportunity',
    range: [1, 5],
  },
  {
    id: 'product',
    title: 'The Product',
    shortTitle: 'Product',
    range: [6, 12],
  },
  {
    id: 'platform',
    title: 'The Platform',
    shortTitle: 'Platform',
    range: [13, 17],
  },
  {
    id: 'partner',
    title: 'Build With Us',
    shortTitle: 'Partner',
    range: [18, 20],
  },
] as const;

export const LEARN_SLIDES: readonly LearnSlide[] = [
  {
    id: 'welcome',
    chapter: 'opportunity',
    index: 1,
    eyebrow: 'From prompt to story world',
    title: 'Turn an idea into a narrated visual world.',
    body: 'Kissago is a guided AI storytelling platform that brings words, characters, images, narration, spoken text, movement and effects into one creative journey.',
    visualType: 'hero-promise',
    accent: 'balanced',
    supportingPoints: ['Story creation', 'Character continuity', 'Narrated video'],
    background: '/learn/backgrounds/bg-08-prompt-to-story-world.webp',
    backgroundPosition: 'center',
  },
  {
    id: 'creative-gap',
    chapter: 'opportunity',
    index: 2,
    eyebrow: 'The problem',
    title: 'The creative gap is not imagination.',
    body: 'People already have ideas. The friction begins when writing, images, voice, timing, effects, editing and export are split across different tools.',
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
    id: 'finish-gap',
    chapter: 'opportunity',
    index: 3,
    eyebrow: 'The finish gap',
    title: 'People begin with a story and end up learning software.',
    body: 'Starting is easy. Coordinating the production workflow—and reaching something watchable and shareable—is where confidence and time disappear.',
    visualType: 'learning-curve',
    accent: 'ember',
    supportingPoints: ['Learn the interface', 'Move files', 'Match timing', 'Fix formats'],
  },
  {
    id: 'meaning-needs-direction',
    chapter: 'opportunity',
    index: 4,
    eyebrow: 'A responsibility layer',
    title: 'Faster generation is not automatically better storytelling.',
    body: 'Meaning still needs direction. Pace, narration and visual detail should hold attention without competing for it.',
    visualType: 'calm-content',
    accent: 'balanced',
    expandableDetail:
      'Kissago is designed to give parents, educators and responsible creators deliberate control over pacing, visuals, continuity and narrative progression.',
    background: '/learn/backgrounds/bg-03-calm-attention.webp',
  },
  {
    id: 'guided-playground',
    chapter: 'opportunity',
    index: 5,
    eyebrow: 'The question worth asking',
    title: 'What if storytelling felt less like software and more like a guided creative playground?',
    body: 'A child should be able to move from idea to scene, a teacher from concept to visual lesson, and a creator from character to episode—without assembling a production team.',
    visualType: 'guided-space',
    accent: 'emerald',
  },
  {
    id: 'beat-based-engine',
    chapter: 'product',
    index: 6,
    eyebrow: 'The product',
    title: 'Kissago is a beat-based story engine.',
    body: 'It breaks storytelling into small creative decisions and connects them into a finished audiovisual experience.',
    visualType: 'product-system',
    accent: 'balanced',
    supportingPoints: ['Idea', 'Story beats', 'Characters', 'Scenes', 'Narration', 'Share'],
    background: '/learn/backgrounds/bg-09-product-experience.webp',
    backgroundPosition: 'center',
  },
  {
    id: 'minutes',
    chapter: 'product',
    index: 7,
    eyebrow: 'From idea to story in minutes',
    title: 'Begin with an idea. Move quickly toward something you can experience.',
    body: 'Depending on the story and level of refinement, a first version can often be created in approximately five to ten minutes.',
    visualType: 'timeline',
    accent: 'emerald',
    supportingPoints: ['Idea', 'Story beats', 'Characters', 'Scenes', 'Narration', 'Playable story'],
  },
  {
    id: 'begin-with-what-you-have',
    chapter: 'product',
    index: 8,
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
    chapter: 'product',
    index: 9,
    eyebrow: 'Shape the story',
    title: 'Kissago turns the idea into a sequence.',
    body: 'The story is organised into beats, scenes or panels so each moment has a purpose and the narrative can progress naturally.',
    visualType: 'story-beats',
    accent: 'emerald',
    screenshotKey: 'story-beats',
    supportingPoints: ['A curious beginning', 'A meaningful choice', 'A world that responds', 'A moment to continue'],
    expandableDetail:
      'The creator can review, edit and refine the structure instead of accepting an uncontrolled block of generated content.',
  },
  {
    id: 'characters-and-worlds',
    chapter: 'product',
    index: 10,
    eyebrow: 'Build characters and worlds',
    title: 'Create once. Continue with consistency.',
    body: 'Character references, names, traits and environments help a story remain recognisable across scenes and future episodes.',
    visualType: 'character-world',
    accent: 'balanced',
    screenshotKey: 'character-setup',
    supportingPoints: ['One character', 'Distinct traits', 'Recurring places', 'Future episodes'],
    background: '/learn/backgrounds/bg-05-character-continuity.webp',
  },
  {
    id: 'bring-to-life',
    chapter: 'product',
    index: 11,
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
    chapter: 'product',
    index: 12,
    eyebrow: 'You remain in control',
    title: 'Refine one part without starting again.',
    body: 'Edit the story, adjust pacing, regenerate an image, improve narration or refine individual scenes while keeping the larger story intact.',
    visualType: 'story-controls',
    accent: 'emerald',
    screenshotKey: 'scene-editing',
    supportingPoints: ['Edit story', 'Adjust pace', 'Regenerate image', 'Refine narration'],
  },
  {
    id: 'story-world-flywheel',
    chapter: 'platform',
    index: 13,
    eyebrow: 'The product flywheel',
    title: 'One finished story becomes the beginning of a reusable world.',
    body: 'Kissago preserves characters, settings, choices and episodes—turning one-off generation into creative continuity.',
    visualType: 'platform-flywheel',
    accent: 'balanced',
    supportingPoints: [
      'Create|Turn an idea into a finished story',
      'Remember|Keep characters, worlds and context',
      'Continue|Build episodes, branches and formats',
      'Share|Grow discovery through finished stories',
    ],
    background: '/learn/backgrounds/bg-06-episodic-world.webp',
  },
  {
    id: 'who-it-serves',
    chapter: 'platform',
    index: 14,
    eyebrow: 'Who Kissago serves first',
    title: 'Consumer joy, educational value and creator expansion.',
    body: 'The same engine supports play, learning and creative production without changing the core product.',
    visualType: 'audiences',
    accent: 'balanced',
    supportingPoints: [
      'Parents and children',
      'Schools and educators',
      'Creators and studios',
      'Design and media programmes',
    ],
    background: '/learn/backgrounds/bg-11-community-network.webp',
  },
  {
    id: 'many-story-identities',
    chapter: 'platform',
    index: 15,
    eyebrow: 'One engine, many story identities',
    title: 'Characters can carry culture, play, learning and continuing worlds.',
    body: 'Kissago is not tied to one visual genre or audience. A reusable character foundation can support many forms of storytelling.',
    visualType: 'character-portfolio',
    accent: 'balanced',
    supportingPoints: [
      'Mechanical companion|Playful science fiction',
      'Magical creature|Children’s fantasy',
      'Community storyteller|Personal and cultural stories',
      'Adventure character|Episodic world-building',
    ],
  },
  {
    id: 'business-model',
    chapter: 'platform',
    index: 16,
    eyebrow: 'Business model',
    title: 'Coins, tiers and a path toward a creator economy.',
    body: 'Usage-linked coins align platform cost with successful creative output, while plans can expand quality, retention and production depth.',
    visualType: 'business-model',
    accent: 'emerald',
    supportingPoints: [
      'Free discovery|A low-friction way to experience creation',
      'Paid tiers|More coins, quality and retained assets',
      'Coin economy|Generation and export map to usage',
      'Creator extension|A future, policy-controlled earning layer',
    ],
    expandableDetail:
      'Coins and paid tiers are part of the current product system. Creator rewards and marketplace economics are future directions, not current availability.',
  },
  {
    id: 'defensibility',
    chapter: 'platform',
    index: 17,
    eyebrow: 'Why the platform can be defensible',
    title: 'The advantage is the product system around AI—not a single model call.',
    body: 'Kissago becomes stronger as its story memory, orchestration, rendering pipeline and creator experience mature together.',
    visualType: 'defensibility',
    accent: 'balanced',
    supportingPoints: [
      'Story memory|Reusable characters, worlds, choices and episodes',
      'Multi-model orchestration|The right model for each creative task',
      'Rendering pipeline|Quality tiers and share-ready output',
      'Creative UX|Pacing, regeneration and guided control',
    ],
    background: '/learn/backgrounds/bg-10-platform-pipeline.webp',
  },
  {
    id: 'go-to-market',
    chapter: 'partner',
    index: 18,
    eyebrow: 'Go-to-market',
    title: 'Start where storytelling already matters.',
    body: 'Focused pilots can prove repeated creation and share-worthy output before Kissago expands into broader parent, educator and creator loops.',
    visualType: 'go-to-market',
    accent: 'emerald',
    supportingPoints: [
      'Phase 1|School and learning pilots',
      'Phase 2|Parent and creator loops',
      'Phase 3|Curated marketplace layer',
    ],
    expandableDetail:
      'The first goal is evidence of repeated story creation, stronger learning engagement and finished output—not broad acquisition at any cost.',
  },
  {
    id: 'roadmap',
    chapter: 'partner',
    index: 19,
    eyebrow: 'A focused path forward',
    title: 'Strengthen the core, prove the loops, then expand the network.',
    body: 'The roadmap keeps the current product honest while making the longer-term platform opportunity visible.',
    visualType: 'roadmap',
    accent: 'balanced',
    supportingPoints: [
      'Now|Stabilise creation flow, export quality and the core experience',
      'Next|School pilots, creator templates, dialogue and print formats',
      'Later|Marketplace, multilingual dubbing, role-play and interactive stories',
    ],
  },
  {
    id: 'build-with-us',
    chapter: 'partner',
    index: 20,
    eyebrow: 'Build with us',
    title: 'Help us turn Kissago into a story creation network.',
    body: 'We are looking for collaborators, pilot partners and aligned capital across creative learning, responsible AI and new media.',
    visualType: 'collaboration-ask',
    accent: 'emerald',
    supportingPoints: [
      'Collaborators|Product, storytelling and creative systems',
      'Pilot partners|Schools, educators and learning programmes',
      'Aligned capital|Patient support for a responsible media platform',
    ],
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
