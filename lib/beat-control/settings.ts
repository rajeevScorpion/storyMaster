// Shared types and flag keys for Pack 1 beat-control features (beat text
// editing, timeline rewrite, image/narration/options regeneration, custom
// options, image version history). Server actions read these flags from the
// feature_flags table; the client receives a snapshot and fails closed.

export const BEAT_CONTROL_FLAG_KEYS = [
  'beat_text_edit_enabled',
  'beat_timeline_rewrite_enabled',
  'beat_image_regen_enabled',
  'beat_image_version_history_enabled',
  'beat_narration_regen_enabled',
  'beat_options_regen_enabled',
  'beat_custom_options_enabled',
  'beat_panel_suggestions_enabled',
] as const;

export type BeatControlFlagKey = (typeof BEAT_CONTROL_FLAG_KEYS)[number];

export const BEAT_IMAGE_MAX_VERSIONS_FLAG_KEY = 'beat_image_max_versions_per_beat';

export const MIN_BEAT_IMAGE_VERSIONS_PER_BEAT = 3;
export const MAX_BEAT_IMAGE_VERSIONS_PER_BEAT = 50;
export const DEFAULT_BEAT_IMAGE_VERSIONS_PER_BEAT = 10;

export interface BeatControlRuntimeSettings {
  textEditEnabled: boolean;
  timelineRewriteEnabled: boolean;
  imageRegenEnabled: boolean;
  imageVersionHistoryEnabled: boolean;
  narrationRegenEnabled: boolean;
  optionsRegenEnabled: boolean;
  customOptionsEnabled: boolean;
  panelSuggestionsEnabled: boolean;
  maxImageVersionsPerBeat: number;
}

// Fail-closed defaults: controls stay hidden until the server snapshot loads.
export const DEFAULT_BEAT_CONTROL_RUNTIME_SETTINGS: BeatControlRuntimeSettings = {
  textEditEnabled: false,
  timelineRewriteEnabled: false,
  imageRegenEnabled: false,
  imageVersionHistoryEnabled: false,
  narrationRegenEnabled: false,
  optionsRegenEnabled: false,
  customOptionsEnabled: false,
  panelSuggestionsEnabled: false,
  maxImageVersionsPerBeat: DEFAULT_BEAT_IMAGE_VERSIONS_PER_BEAT,
};

export const RUNTIME_SETTING_BY_FLAG_KEY: Record<
  BeatControlFlagKey,
  keyof Omit<BeatControlRuntimeSettings, 'maxImageVersionsPerBeat'>
> = {
  beat_text_edit_enabled: 'textEditEnabled',
  beat_timeline_rewrite_enabled: 'timelineRewriteEnabled',
  beat_image_regen_enabled: 'imageRegenEnabled',
  beat_image_version_history_enabled: 'imageVersionHistoryEnabled',
  beat_narration_regen_enabled: 'narrationRegenEnabled',
  beat_options_regen_enabled: 'optionsRegenEnabled',
  beat_custom_options_enabled: 'customOptionsEnabled',
  beat_panel_suggestions_enabled: 'panelSuggestionsEnabled',
};

export function normalizeMaxImageVersionsPerBeat(raw: string | null | undefined): number {
  const parsed = parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_BEAT_IMAGE_VERSIONS_PER_BEAT;
  return Math.min(MAX_BEAT_IMAGE_VERSIONS_PER_BEAT, Math.max(MIN_BEAT_IMAGE_VERSIONS_PER_BEAT, parsed));
}
