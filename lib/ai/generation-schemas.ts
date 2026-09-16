import { Type } from '@google/genai';

// Pack 2: the Story Bible Writer condenses a completed episode into an updated
// series bible plus a journal episode summary for episodic continuity.
export const storyBibleGenerationSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    worldSummary: { type: Type.STRING },
    toneRules: { type: Type.STRING },
    styleRules: { type: Type.STRING },
    characterRules: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    relationshipRules: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    settingRules: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    openThreads: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    episodeSummary: { type: Type.STRING },
  },
  required: [
    'title',
    'worldSummary',
    'toneRules',
    'styleRules',
    'characterRules',
    'relationshipRules',
    'settingRules',
    'openThreads',
    'episodeSummary',
  ],
};

// Discovery metadata for a published storyline: the catalogue intro shown in
// the gallery, plus a suggested genre and audience fit. Both suggestions are
// validated against the app's enums before anything is stored.
export const storylineDiscoveryMetadataSchema = {
  type: Type.OBJECT,
  properties: {
    intro: { type: Type.STRING },
    genre: { type: Type.STRING },
    ageFit: { type: Type.STRING },
  },
  required: ['intro'],
};

// Pack 1: options-only regeneration returns just fresh choices for the
// current beat (no story text, characters, or continuity fields).
export const optionsRegenerationSchema = {
  type: Type.OBJECT,
  properties: {
    options: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          intent: { type: Type.STRING },
        },
        required: ['label', 'intent'],
      },
    },
  },
  required: ['options'],
};

export const beatSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    beatNumber: { type: Type.INTEGER },
    isEnding: { type: Type.BOOLEAN },
    storyText: { type: Type.STRING },
    storyTextParts: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    sceneSummary: { type: Type.STRING },
    options: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          label: { type: Type.STRING },
          intent: { type: Type.STRING },
        },
        required: ['id', 'label', 'intent'],
      },
    },
    characters: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          name: { type: Type.STRING },
          type: { type: Type.STRING },
          appearanceSummary: { type: Type.STRING },
          personalitySummary: { type: Type.STRING },
        },
        required: ['id', 'name', 'type', 'appearanceSummary', 'personalitySummary'],
      },
    },
    continuityNotes: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    imagePrompt: { type: Type.STRING },
    clues: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    nextBeatGoal: { type: Type.STRING },
    endingForecast: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    newCharacterIds: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    changedCharacterIds: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: [
    'title',
    'beatNumber',
    'isEnding',
    'storyText',
    'storyTextParts',
    'sceneSummary',
    'options',
    'characters',
    'continuityNotes',
    'imagePrompt',
    'clues',
    'nextBeatGoal',
    'endingForecast',
    'newCharacterIds',
    'changedCharacterIds',
  ],
};

const reelDraftBeatSchema = {
  type: Type.OBJECT,
  properties: {
    beatIndex: { type: Type.INTEGER },
    title: { type: Type.STRING },
    storyText: { type: Type.STRING },
    sceneSummary: { type: Type.STRING },
    imagePrompt: { type: Type.STRING },
  },
  required: ['beatIndex', 'title', 'storyText', 'sceneSummary', 'imagePrompt'],
};

export const reelDraftSchema = {
  type: Type.OBJECT,
  properties: {
    beatCount: { type: Type.INTEGER },
    beats: {
      type: Type.ARRAY,
      items: reelDraftBeatSchema,
    },
  },
  required: ['beatCount', 'beats'],
};

const seedPlanOptionSchema = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING },
    label: { type: Type.STRING },
    intent: { type: Type.STRING },
    isCanonical: { type: Type.BOOLEAN },
  },
  required: ['id', 'label', 'intent', 'isCanonical'],
};

const seedBeatOutlineSchema = {
  type: Type.OBJECT,
  properties: {
    beatIndex: { type: Type.INTEGER },
    title: { type: Type.STRING },
    storyText: { type: Type.STRING },
    sceneSummary: { type: Type.STRING },
    isEnding: { type: Type.BOOLEAN },
    options: {
      type: Type.ARRAY,
      items: seedPlanOptionSchema,
    },
  },
  required: ['beatIndex', 'title', 'storyText', 'sceneSummary', 'isEnding', 'options'],
};

export const seedPlanSchema = {
  type: Type.OBJECT,
  properties: {
    beatCount: { type: Type.INTEGER },
    beats: {
      type: Type.ARRAY,
      items: seedBeatOutlineSchema,
    },
  },
  required: ['beatCount', 'beats'],
};

const storyboardFrameSchema = {
  type: Type.OBJECT,
  properties: {
    description: { type: Type.STRING },
    prompt: { type: Type.STRING },
    cameraAngle: { type: Type.STRING },
    visualFocus: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    emotion: { type: Type.STRING },
    continuityAnchor: { type: Type.STRING },
    charactersPresent: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: [
    'description',
    'prompt',
    'cameraAngle',
    'visualFocus',
    'emotion',
    'continuityAnchor',
    'charactersPresent',
  ],
};

const portraitTaskSchema = {
  type: Type.OBJECT,
  properties: {
    characterId: { type: Type.STRING },
    characterName: { type: Type.STRING },
    reason: { type: Type.STRING },
    prompt: { type: Type.STRING },
  },
  required: ['characterId', 'characterName', 'reason', 'prompt'],
};

export const storyboardPlanSchema = {
  type: Type.OBJECT,
  properties: {
    sharedVisualInvariants: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    portraitTasks: {
      type: Type.ARRAY,
      items: portraitTaskSchema,
    },
    topLeft: storyboardFrameSchema,
    topRight: storyboardFrameSchema,
    bottomLeft: storyboardFrameSchema,
    bottomRight: storyboardFrameSchema,
    negativeConstraints: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: [
    'sharedVisualInvariants',
    'portraitTasks',
    'topLeft',
    'topRight',
    'bottomLeft',
    'bottomRight',
    'negativeConstraints',
  ],
};

// Continuity framework (docs/visual-composer-continuity-framework.md §3, §6, §7,
// §14, §19): the non-reel `visual_prompt` schema. Reels keep storyboardPlanSchema
// unchanged (they carry no characters/continuity). The new fields are REQUIRED
// here -- both Gemini's constrained decoding and a strict OpenAI-compatible
// schema (lib/ai/text-gateway/openai-compatible.shared.ts) widen an OPTIONAL
// field to nullable, and a nullable enum is not something either provider can
// reliably satisfy, so every field below must always be emitted.
// `languageFallback` on StoryboardPlan is runtime-only (set by
// lib/ai/storyboard-plan.shared.ts) and never appears in this schema.

const STORY_TIME_RELATION_VALUES = [
  'continuous', 'same_session', 'hours_later', 'next_day', 'days_weeks_later',
  'months_later', 'years_later', 'flashback', 'memory', 'dream', 'unknown',
];

const STORY_LOCATION_RELATION_VALUES = [
  'same_exact', 'same_building_different_area', 'same_category_different_location',
  'new_location', 'unknown',
];

const CONTINUITY_MODE_VALUES = ['LOCKED', 'EVOLVE', 'FREE'];

const PANEL_STORY_FUNCTION_VALUES = [
  'ESTABLISH', 'REVEAL', 'ESCALATE', 'HESITATE', 'REACT', 'CHOOSE', 'ACT',
  'TRANSFORM', 'CONNECT', 'ISOLATE', 'RESOLVE', 'FORESHADOW', 'CONTRAST',
];

// `format: 'enum'` is how @google/genai's Schema marks a STRING as a fixed set of
// values (see its Schema.enum doc comment); the OpenAI-compatible JSON Schema
// conversion (geminiSchemaToJsonSchema) reads `enum` directly and ignores `format`,
// so one declaration serves both paths.
function enumStringSchema(values: string[], description: string) {
  return { type: Type.STRING, format: 'enum', enum: values, description };
}

const continuityModeSchema = enumStringSchema(CONTINUITY_MODE_VALUES, 'LOCKED, EVOLVE, or FREE.');

const storyboardContinuityFrameSchema = {
  type: Type.OBJECT,
  properties: {
    description: { type: Type.STRING },
    prompt: { type: Type.STRING },
    cameraAngle: { type: Type.STRING },
    visualFocus: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    emotion: { type: Type.STRING },
    continuityAnchor: { type: Type.STRING },
    charactersPresent: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    storyFunction: enumStringSchema(PANEL_STORY_FUNCTION_VALUES, 'This panel\'s dramatic function.'),
    timeRelationToPreviousPanel: enumStringSchema(
      STORY_TIME_RELATION_VALUES,
      'Time jump relative to the previous panel, or "continuous" within the same moment.'
    ),
    appearanceChanges: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    shotScale: { type: Type.STRING },
    cameraHeight: { type: Type.STRING },
    visualEcho: { type: Type.BOOLEAN },
  },
  required: [
    'description',
    'prompt',
    'cameraAngle',
    'visualFocus',
    'emotion',
    'continuityAnchor',
    'charactersPresent',
    'storyFunction',
    'timeRelationToPreviousPanel',
    'appearanceChanges',
    'shotScale',
    'cameraHeight',
    'visualEcho',
  ],
};

const storyboardCharacterVisualSchema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    englishName: { type: Type.STRING },
    identityAnchors: { type: Type.STRING },
    currentAppearance: { type: Type.STRING },
    modes: {
      type: Type.OBJECT,
      properties: {
        age: continuityModeSchema,
        hair: continuityModeSchema,
        wardrobe: continuityModeSchema,
        accessories: continuityModeSchema,
      },
      required: ['age', 'hair', 'wardrobe', 'accessories'],
    },
  },
  required: ['name', 'englishName', 'identityAnchors', 'currentAppearance', 'modes'],
};

export const storyboardContinuityPlanSchema = {
  type: Type.OBJECT,
  properties: {
    sharedVisualInvariants: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    portraitTasks: {
      type: Type.ARRAY,
      items: portraitTaskSchema,
    },
    topLeft: storyboardContinuityFrameSchema,
    topRight: storyboardContinuityFrameSchema,
    bottomLeft: storyboardContinuityFrameSchema,
    bottomRight: storyboardContinuityFrameSchema,
    negativeConstraints: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    transition: {
      type: Type.OBJECT,
      properties: {
        timeRelation: enumStringSchema(STORY_TIME_RELATION_VALUES, 'Time elapsed since the previous beat.'),
        locationRelation: enumStringSchema(STORY_LOCATION_RELATION_VALUES, 'Location relationship to the previous beat.'),
        evidence: { type: Type.STRING },
      },
      required: ['timeRelation', 'locationRelation', 'evidence'],
    },
    setting: {
      type: Type.OBJECT,
      properties: {
        location: { type: Type.STRING },
        timeOfDay: { type: Type.STRING },
        era: { type: Type.STRING },
      },
      required: ['location', 'timeOfDay', 'era'],
    },
    characterVisuals: {
      type: Type.ARRAY,
      items: storyboardCharacterVisualSchema,
    },
    mustNotInherit: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: [
    'sharedVisualInvariants',
    'portraitTasks',
    'topLeft',
    'topRight',
    'bottomLeft',
    'bottomRight',
    'negativeConstraints',
    'transition',
    'setting',
    'characterVisuals',
    'mustNotInherit',
  ],
};
