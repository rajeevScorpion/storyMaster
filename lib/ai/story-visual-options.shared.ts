export const STORY_VISUAL_CATEGORIES = ['style', 'mood', 'palette', 'detail'] as const;

export type StoryVisualCategory = (typeof STORY_VISUAL_CATEGORIES)[number];
export type StoryVisualOptionStatus = 'draft' | 'published' | 'archived';

export interface StoryVisualOption {
  id: string;
  category: StoryVisualCategory;
  key: string;
  label: string;
  description: string;
  visualPromptDefiner: string;
  narrativePromptDefiner: string | null;
  status: StoryVisualOptionStatus;
  sortOrder: number;
  isDefault: boolean;
}

export type StoryVisualOptionSnapshot = Pick<
  StoryVisualOption,
  'id' | 'category' | 'key' | 'label' | 'description' | 'visualPromptDefiner' | 'narrativePromptDefiner'
>;

export type StoryVisualOptionSnapshots = Partial<Record<StoryVisualCategory, StoryVisualOptionSnapshot>>;

export interface StoryVisualCatalog {
  styles: StoryVisualOption[];
  moods: StoryVisualOption[];
  palettes: StoryVisualOption[];
  details: StoryVisualOption[];
}

const CATEGORY_COLLECTION: Record<StoryVisualCategory, keyof StoryVisualCatalog> = {
  style: 'styles',
  mood: 'moods',
  palette: 'palettes',
  detail: 'details',
};

function builtInOption(
  category: StoryVisualCategory,
  key: string,
  label: string,
  description: string,
  visualPromptDefiner: string,
  options?: { narrativePromptDefiner?: string; sortOrder?: number; isDefault?: boolean }
): StoryVisualOption {
  return {
    id: `builtin:${category}:${key}`,
    category,
    key,
    label,
    description,
    visualPromptDefiner,
    narrativePromptDefiner: options?.narrativePromptDefiner ?? null,
    status: 'published',
    sortOrder: options?.sortOrder ?? 0,
    isDefault: options?.isDefault === true,
  };
}

const BUILT_IN_STYLES: StoryVisualOption[] = [
  builtInOption('style', 'storybook_illustration', 'Storybook Illustration', 'Painterly storybook frames with expressive, character-led appeal.', 'Painterly storybook illustration with tactile brush texture, expressive character acting, softened edges, and clear cinematic staging. Keep the rendering palette-neutral so the selected color and light direction can control the scene.', { sortOrder: 10, isDefault: true }),
  builtInOption('style', 'watercolor_fable', 'Watercolor Fable', 'Soft watercolor washes with dreamy edges and gentle paper texture.', 'Watercolor fable art with translucent pigment washes, delicate edges, visible paper tooth, restrained linework, and airy depth. Preserve readable character identity and let the selected color direction tint the pigments.', { sortOrder: 20 }),
  builtInOption('style', 'anime_cel', 'Anime Cel', 'Clean linework, expressive faces, and confident cel-shaded forms.', 'Anime cel illustration with crisp linework, expressive faces, confident shape language, controlled cel shading, and dynamic but readable staging. Avoid embedded typography and keep colors governed by the selected palette.', { sortOrder: 30 }),
  builtInOption('style', 'graphic_novel', 'Graphic Novel', 'Bold ink, dramatic silhouettes, and cinematic panel energy.', 'Graphic novel illustration with assertive ink contours, bold silhouettes, selective hatching, dramatic value structure, and cinematic framing. Keep character anatomy and identity consistent across panels.', { sortOrder: 40 }),
  builtInOption('style', 'three_d_animated', '3D Animated', 'Polished animated-film depth with dimensional characters and staging.', 'Polished 3D animated-film rendering with dimensional characters, appealing proportions, tactile materials, controlled depth, and expressive cinematic posing. Avoid plastic-looking skin and preserve stable character design.', { sortOrder: 50 }),
  builtInOption('style', 'cinematic_photo', 'Cinematic Realism', 'Stylized photographic realism with controlled depth and atmosphere.', 'Stylized cinematic realism with believable materials, natural anatomy, controlled depth of field, intentional lens language, and filmic lighting response. Keep the result story-led rather than documentary or editorial.', { sortOrder: 60 }),
  builtInOption('style', 'ink_wash', 'Ink Wash', 'Expressive brushwork, flowing ink values, and spacious negative space.', 'Expressive ink-wash illustration with fluid brush marks, varied ink density, organic edges, and purposeful negative space. Use restrained line accents to preserve faces, gestures, and important story objects.', { sortOrder: 70 }),
  builtInOption('style', 'paper_cutout', 'Paper Cutout', 'Layered paper shapes with tactile edges and gentle dimensional shadows.', 'Layered paper-cut illustration using hand-cut silhouettes, visible paper fibers, shallow dimensional stacking, and soft contact shadows. Keep shapes readable and characters recognizable across all panels.', { sortOrder: 80 }),
  builtInOption('style', 'clay_miniature', 'Clay Miniature', 'Handmade clay characters and sets with charming tactile detail.', 'Handcrafted clay miniature aesthetic with sculpted forms, subtle fingerprints, physical sets, soft material texture, and stop-motion-inspired staging. Maintain consistent scale and character construction.', { sortOrder: 90 }),
  builtInOption('style', 'flat_editorial', 'Flat Editorial', 'Bold simplified shapes, clean geometry, and modern visual clarity.', 'Flat editorial illustration with simplified geometry, bold readable silhouettes, clean shape rhythm, minimal gradients, and contemporary composition. Preserve story emotion through pose and scale rather than decorative clutter.', { sortOrder: 100 }),
  builtInOption('style', 'retro_print', 'Retro Print', 'Vintage print texture, limited ink behavior, and graphic shape rhythm.', 'Retro print illustration with offset ink character, subtle registration variation, halftone grain, bold shape rhythm, and matte paper texture. Let the selected palette determine the inks rather than imposing fixed colors.', { sortOrder: 110 }),
  builtInOption('style', 'mixed_media_collage', 'Mixed-Media Collage', 'Layered paper, paint, texture, and photographic fragments.', 'Mixed-media collage with layered cut paper, painted marks, tactile fibers, and carefully integrated photographic texture. Keep character silhouettes coherent and prevent the collage layers from obscuring the focal action.', { sortOrder: 120 }),
];

const BUILT_IN_MOODS: StoryVisualOption[] = [
  builtInOption('mood', 'match_story', 'Match the Story', 'Let each beat determine its own emotional atmosphere.', 'Match expression, staging, contrast, and atmosphere to the actual emotional beat. Do not impose a separate mood or add visual events that the story does not support.', { narrativePromptDefiner: 'Let the story request and established events determine the emotional tone. Do not force a named mood into the narration.', sortOrder: 0, isDefault: true }),
  builtInOption('mood', 'playful', 'Playful', 'Curious energy, gentle surprise, and light visual rhythm.', 'Create playful energy through buoyant poses, curious reactions, gentle surprise, and light compositional rhythm without adding comic props or jokes that are absent from the story.', { narrativePromptDefiner: 'Use curious pacing, gentle surprise, and light humor where the events support it. Never mention the mood setting itself.', sortOrder: 10 }),
  builtInOption('mood', 'cozy', 'Cozy', 'Intimate, reassuring, and emotionally close.', 'Create an intimate, reassuring atmosphere through close relationships, comfortable spacing, softened contrast, and calm visual rhythm. Do not invent fireplaces, blankets, or domestic props merely to signal comfort.', { narrativePromptDefiner: 'Favor intimate reactions, reassurance, and a gentle emotional rhythm while preserving the requested events.', sortOrder: 20 }),
  builtInOption('mood', 'wondrous', 'Wondrous', 'A sense of discovery, scale, and open-eyed amazement.', 'Emphasize discovery and awe through expressive scale, reveal-oriented staging, attentive gestures, and spacious depth while keeping every visual element grounded in the story.', { narrativePromptDefiner: 'Build a sense of discovery and sincere amazement through character reaction and pacing, without naming the mood.', sortOrder: 30 }),
  builtInOption('mood', 'adventurous', 'Adventurous', 'Forward motion, brave choices, and energetic stakes.', 'Use forward visual momentum, purposeful poses, directional composition, and readable stakes. Do not manufacture danger or action that the story does not contain.', { narrativePromptDefiner: 'Use decisive pacing, purposeful action, and readable stakes while remaining appropriate for the configured audience.', sortOrder: 40 }),
  builtInOption('mood', 'mysterious', 'Mysterious', 'Quiet uncertainty, partial discovery, and restrained tension.', 'Create quiet uncertainty through partial reveals, layered depth, occlusion, restrained reactions, and selective contrast. Do not add supernatural objects or plot clues not grounded in the story.', { narrativePromptDefiner: 'Build curiosity through partial discovery, restrained reactions, and unanswered details already supported by the story.', sortOrder: 50 }),
  builtInOption('mood', 'hopeful', 'Hopeful', 'Emotional lift, possibility, and forward-looking calm.', 'Create emotional lift through open composition, connected gestures, increasing clarity, and a sense of forward possibility without inventing symbolic objects.', { narrativePromptDefiner: 'Let setbacks retain a credible sense of possibility and emotional forward movement without forced optimism.', sortOrder: 60 }),
  builtInOption('mood', 'tender', 'Tender', 'Gentle vulnerability and close emotional attention.', 'Emphasize gentle vulnerability through subtle expressions, careful body language, respectful proximity, and unhurried composition. Avoid sentimentality that is not earned by the scene.', { narrativePromptDefiner: 'Give emotional reactions patience and specificity, favoring sincere connection over exaggerated sentiment.', sortOrder: 70 }),
  builtInOption('mood', 'comedic', 'Comedic', 'Clear timing, expressive reactions, and good-natured contrast.', 'Support comedy with readable setup-and-reaction staging, expressive but coherent poses, and visual timing. Do not add slapstick events or gag objects absent from the story.', { narrativePromptDefiner: 'Use clear comic timing and character reactions where appropriate, without inserting unrelated jokes or naming the selected mood.', sortOrder: 80 }),
  builtInOption('mood', 'suspenseful', 'Suspenseful', 'Controlled tension, anticipation, and visual uncertainty.', 'Build controlled tension through constrained framing, anticipation, partial visibility, and focused contrast while preserving age suitability and existing story facts.', { narrativePromptDefiner: 'Use anticipation, delayed information, and controlled tension without adding threats or events the story does not establish.', sortOrder: 90 }),
  builtInOption('mood', 'melancholic', 'Melancholic', 'Reflective restraint, emotional distance, and quiet weight.', 'Create reflective emotional weight through restrained gestures, measured spacing, softened activity, and contemplative composition. Do not introduce rain, abandonment, or loss merely as mood shorthand.', { narrativePromptDefiner: 'Use reflective pacing and emotionally precise restraint without forcing tragedy or naming the mood.', sortOrder: 100 }),
];

const BUILT_IN_PALETTES: StoryVisualOption[] = [
  builtInOption('palette', 'match_story', 'Match the Story', 'Use colors and illumination natural to the story setting.', 'Derive color and illumination from the established location, time, materials, and emotional beat. Preserve natural story relevance and avoid imposing a signature palette.', { sortOrder: 0, isDefault: true }),
  builtInOption('palette', 'natural_daylight', 'Natural Daylight', 'Clear, believable color under neutral natural illumination.', 'Use clear natural illumination and believable local color. Apply it to elements already present; do not change the story time, weather, or location to create daylight.', { sortOrder: 10 }),
  builtInOption('palette', 'warm', 'Golden', 'Warm-biased gold, amber, and restrained red accents.', 'Bias existing illumination and materials toward warm gold, amber, and restrained red accents. Do not add sunsets, flames, gold objects, red props, or warm-colored clothing solely to express the palette.', { sortOrder: 20 }),
  builtInOption('palette', 'vibrant', 'Vibrant', 'Saturated separation with energetic, readable color contrast.', 'Use confident saturation and clear color separation on story-grounded elements while protecting skin tones, focal hierarchy, and readability. Do not add colorful objects merely to fill the palette.', { sortOrder: 30 }),
  builtInOption('palette', 'pastel', 'Soft Pastel', 'Gentle chroma and smooth tonal transitions.', 'Map existing scene colors toward gentle pastel chroma and soft tonal transitions. Preserve contrast around faces and focal actions; do not make the story setting sugary or childlike by default.', { sortOrder: 40 }),
  builtInOption('palette', 'earthy', 'Earth & Mineral', 'Natural greens, mineral greys, muted browns, and grounded accents.', 'Bias existing materials toward natural greens, mineral greys, muted browns, clay, and stone-like accents. Do not introduce forests, soil, pottery, or rustic props unless the story calls for them.', { sortOrder: 50 }),
  builtInOption('palette', 'jewel_tone', 'Jewel Tone', 'Deep, luminous color with refined accent contrast.', 'Use deep luminous color inspired by jewel-like saturation on elements already in the scene, balanced by controlled neutrals. Do not add gems, jewelry, or royal objects as palette shorthand.', { sortOrder: 60 }),
  builtInOption('palette', 'twilight', 'Twilight', 'Cool-to-warm transition, softened distance, and fading illumination.', 'Use a twilight-like cool-to-warm color relationship and softened distance only as a grading treatment. Do not change the canonical time of day, add sunsets, or introduce evening events.', { sortOrder: 70 }),
  builtInOption('palette', 'moonlit', 'Moonlit', 'Cool restrained tones with focused silvery highlights.', 'Use cool restrained tones, quiet shadow separation, and focused silvery highlights as a lighting treatment. Do not add a moon, night sky, or nighttime setting unless established by the story.', { sortOrder: 80 }),
  builtInOption('palette', 'neon', 'Neon Night', 'Luminous colored accents and graphic contrast.', 'Apply luminous cyan, magenta, violet, or electric accent light to existing story-grounded surfaces with controlled dark contrast. Do not add neon signs, readable text, technology, nightlife, or futuristic architecture unless the story requires them.', { sortOrder: 90 }),
  builtInOption('palette', 'monochrome', 'Monochrome', 'A restrained single-hue family with strong value clarity.', 'Translate existing scene colors into a restrained single-hue family with strong value separation and one optional story-grounded accent. Preserve identity-defining colors when continuity requires them.', { sortOrder: 100 }),
  builtInOption('palette', 'muted_cinematic', 'Muted Cinematic', 'Controlled chroma, filmic neutrals, and selective accents.', 'Use controlled chroma, filmic neutrals, gentle highlight rolloff, and selective story-grounded accent color. Avoid turning the setting bleak or changing the emotional facts of the beat.', { sortOrder: 110 }),
  // Legacy key retained so existing saved stories still resolve cleanly.
  builtInOption('palette', 'moody', 'Deep Contrast', 'Deep shadows with restrained, selective highlights.', 'Use deeper value structure, restrained chroma, and selective highlights on existing scene elements. Do not add darkness, bad weather, danger, or nighttime merely to create contrast.', { sortOrder: 120 }),
];

const BUILT_IN_DETAILS: StoryVisualOption[] = [
  builtInOption('detail', 'simple', 'Focused', 'One dominant action with restrained supporting detail.', 'Keep one dominant focal action, simple readable silhouettes, and no more than two supporting environmental anchors per panel. Remove decorative clutter while retaining story-essential objects.', { sortOrder: 10 }),
  builtInOption('detail', 'balanced', 'Balanced', 'Clear characters with selective, story-relevant environment detail.', 'Keep a clear focal action with readable characters and roughly three to five story-relevant environmental details. Use foreground, midground, and background only when they improve comprehension.', { sortOrder: 20, isDefault: true }),
  builtInOption('detail', 'lush', 'Immersive', 'Layered environments with rich but relevant material texture.', 'Build layered foreground, midground, and background depth with rich story-relevant material texture and environmental context. Preserve focal hierarchy and avoid decorative objects that do not support the beat.', { sortOrder: 30 }),
];

export const BUILT_IN_STORY_VISUAL_CATALOG: StoryVisualCatalog = {
  styles: BUILT_IN_STYLES,
  moods: BUILT_IN_MOODS,
  palettes: BUILT_IN_PALETTES,
  details: BUILT_IN_DETAILS,
};

export function getStoryVisualOptions(
  catalog: StoryVisualCatalog,
  category: StoryVisualCategory
): StoryVisualOption[] {
  return catalog[CATEGORY_COLLECTION[category]];
}

export function flattenStoryVisualCatalog(catalog: StoryVisualCatalog): StoryVisualOption[] {
  return STORY_VISUAL_CATEGORIES.flatMap((category) => getStoryVisualOptions(catalog, category));
}

export function normalizeStoryVisualCatalog(
  options?: readonly StoryVisualOption[] | null
): StoryVisualCatalog {
  const published = (options ?? []).filter((option) => option.status === 'published');
  const resolveCategory = (category: StoryVisualCategory): StoryVisualOption[] => {
    const rows = published
      .filter((option) => option.category === category)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
    return rows.length > 0 ? rows : [...getStoryVisualOptions(BUILT_IN_STORY_VISUAL_CATALOG, category)];
  };

  return {
    styles: resolveCategory('style'),
    moods: resolveCategory('mood'),
    palettes: resolveCategory('palette'),
    details: resolveCategory('detail'),
  };
}

export function findStoryVisualOption(
  catalog: StoryVisualCatalog,
  category: StoryVisualCategory,
  key: string | null | undefined
): StoryVisualOption | undefined {
  return getStoryVisualOptions(catalog, category).find((option) => option.key === key);
}

export function getDefaultStoryVisualOption(
  catalog: StoryVisualCatalog,
  category: StoryVisualCategory
): StoryVisualOption {
  const options = getStoryVisualOptions(catalog, category);
  return options.find((option) => option.isDefault) ?? options[0]
    ?? getStoryVisualOptions(BUILT_IN_STORY_VISUAL_CATALOG, category)[0];
}

export function toStoryVisualOptionSnapshot(option: StoryVisualOption): StoryVisualOptionSnapshot {
  return {
    id: option.id,
    category: option.category,
    key: option.key,
    label: option.label,
    description: option.description,
    visualPromptDefiner: option.visualPromptDefiner,
    narrativePromptDefiner: option.narrativePromptDefiner,
  };
}

export function slugifyStoryVisualOption(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

export function isStoryVisualCategory(value: unknown): value is StoryVisualCategory {
  return STORY_VISUAL_CATEGORIES.includes(value as StoryVisualCategory);
}
