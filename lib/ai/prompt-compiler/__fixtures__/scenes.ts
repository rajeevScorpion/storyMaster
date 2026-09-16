// Shared fixtures for the image prompt compiler tests. The medieval-market
// scene is mapped from Kissago_JSON_Image_Prompt_Optimization_Pack/examples/
// scene_input.json and deliberately carries a database-style uuid `id`,
// `personalitySummary`, and a `internal-ref-*`-style storage reference so the
// tests can assert those never leak into the canonical scene or the compiled
// prompt.

import type { Character, StoryboardPlan, StoryboardFramePlan } from '@/lib/types/story';
import type { BuildCanonicalSceneInput } from '@/lib/ai/prompt-compiler/scene-spec.shared';

function character(overrides: Partial<Character> & Pick<Character, 'id' | 'name' | 'appearanceSummary'>): Character {
  return {
    type: 'human',
    personalitySummary: '',
    ...overrides,
  } as Character;
}

export const ELRICK: Character = character({
  id: 'b3f1c2d4-5678-4abc-9def-0123456789ab',
  name: 'Master Elrick',
  type: 'human',
  appearanceSummary: 'elderly scholar with a long white beard, spectacles and scholarly medieval robes',
  personalitySummary: 'a patient mentor who loves a teaching moment',
  portraitUrl: 'r2://characters/elrick-portrait.webp',
});

export const LEO: Character = character({
  id: 'a1b2c3d4-9999-4eee-8fff-abcdef012345',
  name: 'Leo',
  type: 'human',
  appearanceSummary: 'curious boy with messy brown hair and a simple medieval tunic',
  personalitySummary: 'an eager, inquisitive apprentice',
  portraitUrl: 'r2://characters/leo-portrait.webp',
});

function frame(overrides: Partial<StoryboardFramePlan> & Pick<StoryboardFramePlan, 'description'>): StoryboardFramePlan {
  return {
    prompt: `REDUNDANT COMPOSER PROMPT — should never be read by the scene builder: ${overrides.description}`,
    cameraAngle: 'medium shot',
    visualFocus: [],
    emotion: 'neutral',
    continuityAnchor: '',
    ...overrides,
  };
}

export const MEDIEVAL_MARKET_PLAN: StoryboardPlan = {
  sharedVisualInvariants: [
    'Whimsical medieval storybook illustration with painterly textures and expressive acting',
    'Warm golden sunlight with amber and rich red tones',
    'Lively medieval European market with cobblestone streets, wooden stalls and bread baskets',
  ],
  portraitTasks: [],
  topLeft: frame({
    description: 'A lively market square filled with colourful wooden stalls, bread baskets and animated merchants.',
    cameraAngle: 'wide establishing shot',
    visualFocus: ['market atmosphere', 'stalls', 'bread baskets'],
    emotion: 'cheerful',
    continuityAnchor: 'Establish the shared market setting.',
    charactersPresent: [],
  }),
  topRight: frame({
    description: 'Leo stands beside Master Elrick in the centre of the busy market.',
    cameraAngle: 'medium shot',
    visualFocus: ['Leo', 'Master Elrick'],
    emotion: 'Leo is curious and expectant; Elrick is calm and attentive',
    continuityAnchor: 'Same market, same characters as the story establishes.',
    charactersPresent: ['Leo', 'Master Elrick'],
  }),
  bottomLeft: frame({
    description:
      'Master Elrick smiles, strokes his beard with one hand and tosses a bright red apple with the other; the apple is suspended in mid-air. Leo is absent.',
    cameraAngle: 'medium close-up',
    visualFocus: ['Master Elrick', 'red apple'],
    emotion: 'playful and instructive',
    continuityAnchor: 'The same bright red apple introduced here is carried into the next panel.',
    charactersPresent: ['Master Elrick'],
  }),
  bottomRight: frame({
    description: 'Master Elrick holds the same red apple in his open palm while Leo studies it.',
    cameraAngle: 'medium shot',
    visualFocus: ["Leo's expression", 'Master Elrick', 'red apple'],
    emotion: 'warmth, wonder and thoughtful curiosity',
    continuityAnchor: 'The same red apple from the previous panel, now held still.',
    charactersPresent: ['Master Elrick', 'Leo'],
  }),
  negativeConstraints: ['text', 'captions', 'modern elements', 'duplicated named characters'],
};

export const MEDIEVAL_MARKET_INPUT: BuildCanonicalSceneInput = {
  storyboardPlan: MEDIEVAL_MARKET_PLAN,
  continuityNotes: [
    'The bright red apple is one continuous object across the bottom two panels.',
    'Keep the same medieval market throughout.',
  ],
  characters: [ELRICK, LEO],
  visualStyle: 'Whimsical medieval storybook illustration, painterly, warm golden light',
  aspectRatio: '9:16',
  worldAnchor: 'A sunlit medieval European market with cobblestones, wooden stalls and bread baskets.',
};

/** Minimal two-character plan, 16:9, no world anchor, no regen. */
export const MINIMAL_PLAN: StoryboardPlan = {
  sharedVisualInvariants: ['Clean flat vector illustration', 'Cool blue palette'],
  portraitTasks: [],
  topLeft: frame({ description: 'Ada waves from a doorway.', charactersPresent: ['Ada'], visualFocus: ['Ada'] }),
  topRight: frame({ description: 'Ben reads a map at a table.', charactersPresent: ['Ben'], visualFocus: ['Ben', 'map'] }),
  bottomLeft: frame({ description: 'Ada and Ben study the map together.', charactersPresent: ['Ada', 'Ben'] }),
  bottomRight: frame({ description: 'An empty street at dusk.', charactersPresent: [], visualFocus: ['street'] }),
  negativeConstraints: ['text'],
};

export const MINIMAL_INPUT: BuildCanonicalSceneInput = {
  storyboardPlan: MINIMAL_PLAN,
  characters: [
    character({ id: '11111111-1111-4111-8111-111111111111', name: 'Ada', appearanceSummary: 'young woman with short black hair' }),
    character({ id: '22222222-2222-4222-8222-222222222222', name: 'Ben', appearanceSummary: 'older man with a grey coat' }),
  ],
  visualStyle: 'Clean flat vector illustration',
  aspectRatio: '16:9',
};

// --- Non-English fixtures (Unicode-safety regression coverage) ------------
// Invented and anonymized — not copied from any real story. Exercises the
// Devanagari/Arabic/Japanese paths the compiler's tokenizer and name matcher
// used to silently destroy (see docs/image-composer-continuity-handoff.md
// section 2a).

export const ANVI: Character = character({
  id: 'c1a2b3c4-1111-4abc-9def-abcdefabcdef',
  name: 'अन्वी',
  type: 'human',
  appearanceSummary: 'दस साल की लड़की, काले बाल और पीली फ्रॉक',
  portraitUrl: 'r2://characters/anvi-portrait.webp',
});

export const RAGHAV: Character = character({
  id: 'd2b3c4d5-2222-4abc-9def-abcdefabcdef',
  name: 'राघव',
  type: 'human',
  appearanceSummary: 'बुज़ुर्ग किसान, सफ़ेद कुर्ता और घनी मूंछें',
  portraitUrl: 'r2://characters/raghav-portrait.webp',
});

export const HINDI_VILLAGE_PLAN: StoryboardPlan = {
  sharedVisualInvariants: [
    'धुंधली सुबह की रोशनी खेतों पर फैली हुई है',
    'गाँव के घरों की मिट्टी की दीवारें और खपरैल छतें',
    'दूर पहाड़ों की हल्की नीली रूपरेखा',
    'गाँव के बीचोंबीच एक पुराना बरगद का पेड़',
  ],
  portraitTasks: [],
  topLeft: frame({
    description: 'राघव अपने खेत की मेड़ पर खड़े होकर सूरज की ओर देख रहे हैं।',
    cameraAngle: 'चौड़ा स्थापना शॉट',
    visualFocus: ['हरे-भरे खेत', 'सुबह की धुंध', 'दूर के पहाड़'],
    emotion: 'शांत और संतुष्ट',
    continuityAnchor: 'यही सुबह की रोशनी अगले दृश्य में भी बनी रहती है।',
    charactersPresent: ['राघव'],
  }),
  topRight: frame({
    description: 'अन्वी दौड़ती हुई राघव के पास आती है और उनका हाथ पकड़ लेती है।',
    cameraAngle: 'मध्यम शॉट',
    visualFocus: ['अन्वी की पीली फ्रॉक', 'राघव की मुस्कान'],
    emotion: 'अन्वी उत्साहित है; राघव स्नेहपूर्ण हैं',
    continuityAnchor: 'राघव वही खेत की मेड़ पर खड़े हैं।',
    charactersPresent: ['अन्वी', 'राघव'],
  }),
  bottomLeft: frame({
    description: 'राघव अन्वी को कंधे पर बिठाकर बरगद के पेड़ की ओर चलते हैं; अन्वी हँस रही है।',
    cameraAngle: 'मध्यम क्लोज़-अप',
    visualFocus: ['बरगद का घना पेड़', 'अन्वी की खिलखिलाहट'],
    emotion: 'खुशी और अपनापन',
    continuityAnchor: 'वही बरगद का पेड़ जो शुरुआती दृश्य में दिखा था।',
    charactersPresent: ['राघव', 'अन्वी'],
  }),
  bottomRight: frame({
    description: 'अन्वी अकेली बरगद के पेड़ के नीचे बैठी किताब पढ़ रही है। राघव अनुपस्थित हैं।',
    cameraAngle: 'चौड़ा शॉट',
    visualFocus: ['खुली हुई पुरानी किताब', 'पेड़ की घनी छाया'],
    emotion: 'गहरी एकाग्रता',
    continuityAnchor: 'वही बरगद का पेड़, अब शांत दोपहर में।',
    charactersPresent: ['अन्वी'],
  }),
  negativeConstraints: ['टेक्स्ट', 'कैप्शन', 'आधुनिक वस्तुएँ', 'डुप्लिकेट पात्र'],
};

export const HINDI_VILLAGE_INPUT: BuildCanonicalSceneInput = {
  storyboardPlan: HINDI_VILLAGE_PLAN,
  continuityNotes: ['बरगद का पेड़ पूरी कहानी में एक जैसा रहता है।'],
  characters: [RAGHAV, ANVI],
  visualStyle: 'गर्म रंगों वाली भारतीय ग्रामीण चित्रण शैली, नरम रोशनी',
  aspectRatio: '16:9',
  worldAnchor: 'सुबह की सुनहरी रोशनी में एक शांत भारतीय गाँव, मिट्टी के घर और बरगद का पेड़।',
};

/** Small Arabic character, for name-matching tests (no full scene needed). */
export const LAYLA: Character = character({
  id: 'e3c4d5e6-3333-4abc-9def-abcdefabcdef',
  name: 'ليلى',
  type: 'human',
  appearanceSummary: 'فتاة صغيرة ذات شعر أسود طويل وفستان أزرق',
});

/** Small Japanese character, for name-matching tests (no full scene needed). */
export const SAKURA: Character = character({
  id: 'f4d5e6f7-4444-4abc-9def-abcdefabcdef',
  name: 'さくら',
  type: 'human',
  appearanceSummary: '黒い髪の少女、赤い着物を着ている',
});

/** Legacy conversion input: no storyboard plan, only a rendered brief. */
export const LEGACY_TEXT_INPUT: BuildCanonicalSceneInput = {
  storyboardPlan: null,
  storyboardPromptText:
    'Shared visual invariants:\n- warm golden market\n\nTop Left:\nDescription: A market square.\nPrompt: A market square.',
  characters: [ELRICK],
  visualStyle: 'Whimsical medieval storybook illustration',
  aspectRatio: '16:9',
};
