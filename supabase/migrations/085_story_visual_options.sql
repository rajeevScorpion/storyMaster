-- 085_story_visual_options.sql
-- Manual migration: admin-managed, text-only visual controls for story creation.

CREATE TABLE IF NOT EXISTS public.story_visual_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  option_key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  visual_prompt_definer TEXT NOT NULL,
  narrative_prompt_definer TEXT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ NULL,
  CONSTRAINT story_visual_options_category_check CHECK (category IN ('style', 'mood', 'palette', 'detail')),
  CONSTRAINT story_visual_options_status_check CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT story_visual_options_category_key_unique UNIQUE (category, option_key),
  CONSTRAINT story_visual_options_mood_narrative_check CHECK (
    category <> 'mood' OR length(trim(COALESCE(narrative_prompt_definer, ''))) > 0
  ),
  CONSTRAINT story_visual_options_default_published_check CHECK (NOT is_default OR status = 'published')
);

CREATE INDEX IF NOT EXISTS story_visual_options_status_sort_idx
  ON public.story_visual_options (status, category, sort_order, label);

CREATE UNIQUE INDEX IF NOT EXISTS story_visual_options_one_default_idx
  ON public.story_visual_options (category)
  WHERE is_default = true AND status = 'published';

CREATE OR REPLACE FUNCTION public.touch_story_visual_options_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS story_visual_options_touch_updated_at ON public.story_visual_options;
CREATE TRIGGER story_visual_options_touch_updated_at
  BEFORE UPDATE ON public.story_visual_options
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_story_visual_options_updated_at();

ALTER TABLE public.story_visual_options ENABLE ROW LEVEL SECURITY;

-- Story style prompts stay palette-neutral so color/light options compose cleanly.
INSERT INTO public.story_visual_options
  (category, option_key, label, description, visual_prompt_definer, narrative_prompt_definer, status, sort_order, is_default, published_at)
VALUES
  ('style', 'storybook_illustration', 'Storybook Illustration', 'Painterly storybook frames with expressive, character-led appeal.', 'Painterly storybook illustration with tactile brush texture, expressive character acting, softened edges, and clear cinematic staging. Keep the rendering palette-neutral so the selected color and light direction can control the scene.', NULL, 'published', 10, true, now()),
  ('style', 'watercolor_fable', 'Watercolor Fable', 'Soft watercolor washes with dreamy edges and gentle paper texture.', 'Watercolor fable art with translucent pigment washes, delicate edges, visible paper tooth, restrained linework, and airy depth. Preserve readable character identity and let the selected color direction tint the pigments.', NULL, 'published', 20, false, now()),
  ('style', 'anime_cel', 'Anime Cel', 'Clean linework, expressive faces, and confident cel-shaded forms.', 'Anime cel illustration with crisp linework, expressive faces, confident shape language, controlled cel shading, and dynamic but readable staging. Avoid embedded typography and keep colors governed by the selected palette.', NULL, 'published', 30, false, now()),
  ('style', 'graphic_novel', 'Graphic Novel', 'Bold ink, dramatic silhouettes, and cinematic panel energy.', 'Graphic novel illustration with assertive ink contours, bold silhouettes, selective hatching, dramatic value structure, and cinematic framing. Keep character anatomy and identity consistent across panels.', NULL, 'published', 40, false, now()),
  ('style', 'three_d_animated', '3D Animated', 'Polished animated-film depth with dimensional characters and staging.', 'Polished 3D animated-film rendering with dimensional characters, appealing proportions, tactile materials, controlled depth, and expressive cinematic posing. Avoid plastic-looking skin and preserve stable character design.', NULL, 'published', 50, false, now()),
  ('style', 'cinematic_photo', 'Cinematic Realism', 'Stylized photographic realism with controlled depth and atmosphere.', 'Stylized cinematic realism with believable materials, natural anatomy, controlled depth of field, intentional lens language, and filmic lighting response. Keep the result story-led rather than documentary or editorial.', NULL, 'published', 60, false, now()),
  ('style', 'ink_wash', 'Ink Wash', 'Expressive brushwork, flowing ink values, and spacious negative space.', 'Expressive ink-wash illustration with fluid brush marks, varied ink density, organic edges, and purposeful negative space. Use restrained line accents to preserve faces, gestures, and important story objects.', NULL, 'published', 70, false, now()),
  ('style', 'paper_cutout', 'Paper Cutout', 'Layered paper shapes with tactile edges and gentle dimensional shadows.', 'Layered paper-cut illustration using hand-cut silhouettes, visible paper fibers, shallow dimensional stacking, and soft contact shadows. Keep shapes readable and characters recognizable across all panels.', NULL, 'published', 80, false, now()),
  ('style', 'clay_miniature', 'Clay Miniature', 'Handmade clay characters and sets with charming tactile detail.', 'Handcrafted clay miniature aesthetic with sculpted forms, subtle fingerprints, physical sets, soft material texture, and stop-motion-inspired staging. Maintain consistent scale and character construction.', NULL, 'published', 90, false, now()),
  ('style', 'flat_editorial', 'Flat Editorial', 'Bold simplified shapes, clean geometry, and modern visual clarity.', 'Flat editorial illustration with simplified geometry, bold readable silhouettes, clean shape rhythm, minimal gradients, and contemporary composition. Preserve story emotion through pose and scale rather than decorative clutter.', NULL, 'published', 100, false, now()),
  ('style', 'retro_print', 'Retro Print', 'Vintage print texture, limited ink behavior, and graphic shape rhythm.', 'Retro print illustration with offset ink character, subtle registration variation, halftone grain, bold shape rhythm, and matte paper texture. Let the selected palette determine the inks rather than imposing fixed colors.', NULL, 'published', 110, false, now()),
  ('style', 'mixed_media_collage', 'Mixed-Media Collage', 'Layered paper, paint, texture, and photographic fragments.', 'Mixed-media collage with layered cut paper, painted marks, tactile fibers, and carefully integrated photographic texture. Keep character silhouettes coherent and prevent the collage layers from obscuring the focal action.', NULL, 'published', 120, false, now()),

  ('mood', 'match_story', 'Match the Story', 'Let each beat determine its own emotional atmosphere.', 'Match expression, staging, contrast, and atmosphere to the actual emotional beat. Do not impose a separate mood or add visual events that the story does not support.', 'Let the story request and established events determine the emotional tone. Do not force a named mood into the narration.', 'published', 0, true, now()),
  ('mood', 'playful', 'Playful', 'Curious energy, gentle surprise, and light visual rhythm.', 'Create playful energy through buoyant poses, curious reactions, gentle surprise, and light compositional rhythm without adding comic props or jokes that are absent from the story.', 'Use curious pacing, gentle surprise, and light humor where the events support it. Never mention the mood setting itself.', 'published', 10, false, now()),
  ('mood', 'cozy', 'Cozy', 'Intimate, reassuring, and emotionally close.', 'Create an intimate, reassuring atmosphere through close relationships, comfortable spacing, softened contrast, and calm visual rhythm. Do not invent fireplaces, blankets, or domestic props merely to signal comfort.', 'Favor intimate reactions, reassurance, and a gentle emotional rhythm while preserving the requested events.', 'published', 20, false, now()),
  ('mood', 'wondrous', 'Wondrous', 'A sense of discovery, scale, and open-eyed amazement.', 'Emphasize discovery and awe through expressive scale, reveal-oriented staging, attentive gestures, and spacious depth while keeping every visual element grounded in the story.', 'Build a sense of discovery and sincere amazement through character reaction and pacing, without naming the mood.', 'published', 30, false, now()),
  ('mood', 'adventurous', 'Adventurous', 'Forward motion, brave choices, and energetic stakes.', 'Use forward visual momentum, purposeful poses, directional composition, and readable stakes. Do not manufacture danger or action that the story does not contain.', 'Use decisive pacing, purposeful action, and readable stakes while remaining appropriate for the configured audience.', 'published', 40, false, now()),
  ('mood', 'mysterious', 'Mysterious', 'Quiet uncertainty, partial discovery, and restrained tension.', 'Create quiet uncertainty through partial reveals, layered depth, occlusion, restrained reactions, and selective contrast. Do not add supernatural objects or plot clues not grounded in the story.', 'Build curiosity through partial discovery, restrained reactions, and unanswered details already supported by the story.', 'published', 50, false, now()),
  ('mood', 'hopeful', 'Hopeful', 'Emotional lift, possibility, and forward-looking calm.', 'Create emotional lift through open composition, connected gestures, increasing clarity, and a sense of forward possibility without inventing symbolic objects.', 'Let setbacks retain a credible sense of possibility and emotional forward movement without forced optimism.', 'published', 60, false, now()),
  ('mood', 'tender', 'Tender', 'Gentle vulnerability and close emotional attention.', 'Emphasize gentle vulnerability through subtle expressions, careful body language, respectful proximity, and unhurried composition. Avoid sentimentality that is not earned by the scene.', 'Give emotional reactions patience and specificity, favoring sincere connection over exaggerated sentiment.', 'published', 70, false, now()),
  ('mood', 'comedic', 'Comedic', 'Clear timing, expressive reactions, and good-natured contrast.', 'Support comedy with readable setup-and-reaction staging, expressive but coherent poses, and visual timing. Do not add slapstick events or gag objects absent from the story.', 'Use clear comic timing and character reactions where appropriate, without inserting unrelated jokes or naming the selected mood.', 'published', 80, false, now()),
  ('mood', 'suspenseful', 'Suspenseful', 'Controlled tension, anticipation, and visual uncertainty.', 'Build controlled tension through constrained framing, anticipation, partial visibility, and focused contrast while preserving age suitability and existing story facts.', 'Use anticipation, delayed information, and controlled tension without adding threats or events the story does not establish.', 'published', 90, false, now()),
  ('mood', 'melancholic', 'Melancholic', 'Reflective restraint, emotional distance, and quiet weight.', 'Create reflective emotional weight through restrained gestures, measured spacing, softened activity, and contemplative composition. Do not introduce rain, abandonment, or loss merely as mood shorthand.', 'Use reflective pacing and emotionally precise restraint without forcing tragedy or naming the mood.', 'published', 100, false, now()),

  ('palette', 'match_story', 'Match the Story', 'Use colors and illumination natural to the story setting.', 'Derive color and illumination from the established location, time, materials, and emotional beat. Preserve natural story relevance and avoid imposing a signature palette.', NULL, 'published', 0, true, now()),
  ('palette', 'natural_daylight', 'Natural Daylight', 'Clear, believable color under neutral natural illumination.', 'Use clear natural illumination and believable local color. Apply it to elements already present; do not change the story time, weather, or location to create daylight.', NULL, 'published', 10, false, now()),
  ('palette', 'warm', 'Golden', 'Warm-biased gold, amber, and restrained red accents.', 'Bias existing illumination and materials toward warm gold, amber, and restrained red accents. Do not add sunsets, flames, gold objects, red props, or warm-colored clothing solely to express the palette.', NULL, 'published', 20, false, now()),
  ('palette', 'vibrant', 'Vibrant', 'Saturated separation with energetic, readable color contrast.', 'Use confident saturation and clear color separation on story-grounded elements while protecting skin tones, focal hierarchy, and readability. Do not add colorful objects merely to fill the palette.', NULL, 'published', 30, false, now()),
  ('palette', 'pastel', 'Soft Pastel', 'Gentle chroma and smooth tonal transitions.', 'Map existing scene colors toward gentle pastel chroma and soft tonal transitions. Preserve contrast around faces and focal actions; do not make the story setting sugary or childlike by default.', NULL, 'published', 40, false, now()),
  ('palette', 'earthy', 'Earth & Mineral', 'Natural greens, mineral greys, muted browns, and grounded accents.', 'Bias existing materials toward natural greens, mineral greys, muted browns, clay, and stone-like accents. Do not introduce forests, soil, pottery, or rustic props unless the story calls for them.', NULL, 'published', 50, false, now()),
  ('palette', 'jewel_tone', 'Jewel Tone', 'Deep, luminous color with refined accent contrast.', 'Use deep luminous color inspired by jewel-like saturation on elements already in the scene, balanced by controlled neutrals. Do not add gems, jewelry, or royal objects as palette shorthand.', NULL, 'published', 60, false, now()),
  ('palette', 'twilight', 'Twilight', 'Cool-to-warm transition, softened distance, and fading illumination.', 'Use a twilight-like cool-to-warm color relationship and softened distance only as a grading treatment. Do not change the canonical time of day, add sunsets, or introduce evening events.', NULL, 'published', 70, false, now()),
  ('palette', 'moonlit', 'Moonlit', 'Cool restrained tones with focused silvery highlights.', 'Use cool restrained tones, quiet shadow separation, and focused silvery highlights as a lighting treatment. Do not add a moon, night sky, or nighttime setting unless established by the story.', NULL, 'published', 80, false, now()),
  ('palette', 'neon', 'Neon Night', 'Luminous colored accents and graphic contrast.', 'Apply luminous cyan, magenta, violet, or electric accent light to existing story-grounded surfaces with controlled dark contrast. Do not add neon signs, readable text, technology, nightlife, or futuristic architecture unless the story requires them.', NULL, 'published', 90, false, now()),
  ('palette', 'monochrome', 'Monochrome', 'A restrained single-hue family with strong value clarity.', 'Translate existing scene colors into a restrained single-hue family with strong value separation and one optional story-grounded accent. Preserve identity-defining colors when continuity requires them.', NULL, 'published', 100, false, now()),
  ('palette', 'muted_cinematic', 'Muted Cinematic', 'Controlled chroma, filmic neutrals, and selective accents.', 'Use controlled chroma, filmic neutrals, gentle highlight rolloff, and selective story-grounded accent color. Avoid turning the setting bleak or changing the emotional facts of the beat.', NULL, 'published', 110, false, now()),
  ('palette', 'moody', 'Deep Contrast', 'Deep shadows with restrained, selective highlights.', 'Use deeper value structure, restrained chroma, and selective highlights on existing scene elements. Do not add darkness, bad weather, danger, or nighttime merely to create contrast.', NULL, 'published', 120, false, now()),

  ('detail', 'simple', 'Focused', 'One dominant action with restrained supporting detail.', 'Keep one dominant focal action, simple readable silhouettes, and no more than two supporting environmental anchors per panel. Remove decorative clutter while retaining story-essential objects.', NULL, 'published', 10, false, now()),
  ('detail', 'balanced', 'Balanced', 'Clear characters with selective, story-relevant environment detail.', 'Keep a clear focal action with readable characters and roughly three to five story-relevant environmental details. Use foreground, midground, and background only when they improve comprehension.', NULL, 'published', 20, true, now()),
  ('detail', 'lush', 'Immersive', 'Layered environments with rich but relevant material texture.', 'Build layered foreground, midground, and background depth with rich story-relevant material texture and environmental context. Preserve focal hierarchy and avoid decorative objects that do not support the beat.', NULL, 'published', 30, false, now())
ON CONFLICT (category, option_key) DO NOTHING;
