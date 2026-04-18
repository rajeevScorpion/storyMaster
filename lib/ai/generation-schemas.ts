import { Type } from '@google/genai';

export const beatSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    beatNumber: { type: Type.INTEGER },
    isEnding: { type: Type.BOOLEAN },
    storyText: { type: Type.STRING },
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
  },
  required: [
    'description',
    'prompt',
    'cameraAngle',
    'visualFocus',
    'emotion',
    'continuityAnchor',
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
