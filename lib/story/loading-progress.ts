export type StoryLoadingFlow = 'start_story' | 'continue_story';

export type StoryLoadingStepKey =
  | 'wallet'
  | 'beat'
  | 'visual'
  | 'image'
  | 'finish';

export interface StoryLoadingStepDefinition {
  key: StoryLoadingStepKey;
  label: string;
  description: string;
  tooltip: string;
}

export interface StoryLoadingStage {
  flow: StoryLoadingFlow;
  currentStepKey: StoryLoadingStepKey;
  detail: string;
  steps: StoryLoadingStepDefinition[];
  /** Optional reassurance note rendered under the progress rail (e.g. "safe to
   *  leave" once the work is durably queued server-side). */
  note?: string;
}

const SHARED_STEPS: StoryLoadingStepDefinition[] = [
  {
    key: 'wallet',
    label: 'Checking access',
    description: 'Making sure your story can continue smoothly.',
    tooltip: 'Checking your access',
  },
  {
    key: 'beat',
    label: 'Writing the beat',
    description: 'Shaping the next moment of the story.',
    tooltip: 'Writing the next beat',
  },
  {
    key: 'visual',
    label: 'Planning the visuals',
    description: 'Deciding how the scene should look and feel.',
    tooltip: 'Planning the scene look',
  },
  {
    key: 'image',
    label: 'Rendering the image',
    description: 'Painting the new scene.',
    tooltip: 'Rendering the scene image',
  },
  {
    key: 'finish',
    label: 'Finishing touches',
    description: 'Syncing narration and wrapping everything up.',
    tooltip: 'Adding final touches',
  },
];

const FLOW_DETAIL_OVERRIDES: Record<StoryLoadingFlow, Partial<Record<StoryLoadingStepKey, string>>> = {
  start_story: {
    wallet: 'Checking your wallet and preparing a fresh story.',
    beat: 'Writing the opening beat of your new story.',
    visual: 'Planning the look of the opening scene.',
    image: 'Rendering the first scene.',
    finish: 'Adding the finishing touches and preparing narration.',
  },
  continue_story: {
    wallet: 'Checking your wallet before creating a new path.',
    beat: 'Writing the next beat for this choice.',
    visual: 'Planning the new branch visually.',
    image: 'Rendering the next scene.',
    finish: 'Adding the finishing touches and preparing narration.',
  },
};

export function createStoryLoadingStage(
  flow: StoryLoadingFlow,
  currentStepKey: StoryLoadingStepKey,
  opts?: { deferImages?: boolean; note?: string }
): StoryLoadingStage {
  const steps = SHARED_STEPS
    // When live images are deferred (batch / prompt-only), no image is rendered,
    // so hide the "Rendering the image" step to avoid a misleading checkpoint.
    .filter((step) => !(opts?.deferImages && step.key === 'image'))
    .map((step) => ({
      ...step,
      description: FLOW_DETAIL_OVERRIDES[flow][step.key] || step.description,
    }));

  // If the requested step was removed (image while deferring), fall through to
  // the finishing step so progress still advances sensibly.
  const resolvedStepKey = opts?.deferImages && currentStepKey === 'image' ? 'finish' : currentStepKey;
  const currentStep = steps.find((step) => step.key === resolvedStepKey) || steps[0];

  return {
    flow,
    currentStepKey: resolvedStepKey,
    detail: currentStep.description,
    steps,
    ...(opts?.note ? { note: opts.note } : {}),
  };
}

export function getStoryLoadingProgress(stage: StoryLoadingStage | null): number {
  if (!stage) return 0;
  const index = stage.steps.findIndex((step) => step.key === stage.currentStepKey);
  if (index === -1 || stage.steps.length === 0) return 0;
  return (index + 1) / stage.steps.length;
}
