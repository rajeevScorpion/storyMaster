'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFeatureFlagValue } from '@/lib/ai/model-config';
import { splitBase64DataUrl } from '@/lib/utils/data-url';
import { getNarrationVoiceSettings } from '@/lib/ai/narration-voice-settings';
import { generateReelNarrationOnly } from '@/app/actions/narration';
import {
  DEFAULT_REEL_STORY_SETTINGS,
  parseReelStorySettingsValue,
} from '@/lib/reel/settings';
import {
  DEFAULT_REEL_NARRATION_ADMIN_SETTINGS,
  SYSTEM_NARRATION_PRESETS,
  applyPresetToNarrationSettings,
  buildPresetInputFromSettings,
  normalizeNarrationPreviewMetadata,
  normalizeNarrationPreset,
  normalizeReelNarrationAdminSettings,
  normalizeReelNarrationSettings,
  resolvePreviewElevenLabsModel,
  storyLanguageToNarrationLanguage,
  type ActiveNarration,
  type BeatNarrationMetadata,
  type NarrationPreset,
  type NarrationPreviewMetadata,
  type NarrationVoicePreviewScope,
  type ReelNarrationAdminSettings,
  type ReelNarrationSettings,
  type ReelNarrationVoicePreview,
} from '@/lib/reel/narration';
import { normalizeStoryConfig } from '@/lib/ai/story-config';
import { putR2Object, createR2SignedGetUrl, deleteR2Object } from '@/lib/media/r2-server';
import type { StoryConfig, StoryLanguage } from '@/lib/types/story';
import { updateBeatMediaState } from '@/app/actions/persistence';

function isMissingNarrationTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error?.message) return false;
  return error.code === '42P01'
    || error.code === 'PGRST205'
    || /relation .*narration_presets/i.test(error.message)
    || /schema cache/i.test(error.message);
}

function rowToPreset(row: Record<string, any>): NarrationPreset {
  return normalizeNarrationPreset({
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    description: row.description,
    provider: row.provider,
    model: row.model,
    voice_id: row.voice_id,
    language_mode: row.language_mode,
    speed: row.speed,
    stability: row.stability,
    similarity_boost: row.similarity_boost,
    style: row.style,
    speaker_boost: row.speaker_boost,
    tone: row.tone,
    emotional_intensity: row.emotional_intensity,
    pacing: row.pacing,
    delivery_style: row.delivery_style,
    narration_instruction: row.narration_instruction,
    preset_scope: row.preset_scope,
    preset_visibility: row.preset_visibility,
    is_default: row.is_default,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

function presetToRow(
  preset: Partial<NarrationPreset>,
  userId: string,
  options: { id?: string; isDefault?: boolean } = {}
): Record<string, unknown> {
  return {
    ...(options.id ? { id: options.id } : {}),
    user_id: userId,
    name: preset.name,
    description: preset.description ?? null,
    provider: preset.provider ?? 'elevenlabs',
    model: preset.model,
    voice_id: preset.voiceId,
    language_mode: preset.languageMode ?? 'reel_language',
    speed: preset.speed,
    stability: preset.stability,
    similarity_boost: preset.similarityBoost,
    style: preset.style,
    speaker_boost: preset.speakerBoost,
    tone: preset.tone,
    emotional_intensity: preset.emotionalIntensity,
    pacing: preset.pacing,
    delivery_style: preset.deliveryStyle,
    narration_instruction: preset.narrationInstruction,
    preset_scope: 'user',
    preset_visibility: 'private',
    ...(typeof options.isDefault === 'boolean' ? { is_default: options.isDefault } : {}),
    updated_at: new Date().toISOString(),
  };
}

function settingsToRow(
  storyId: string,
  userId: string,
  settings: ReelNarrationSettings
): Record<string, unknown> {
  return {
    story_id: storyId,
    user_id: userId,
    provider: settings.provider,
    fallback_provider: settings.fallbackProvider,
    language: settings.language,
    language_source: settings.languageSource,
    detected_language: settings.detectedLanguage,
    is_mixed_language: settings.isMixedLanguage,
    voice_id: settings.voiceId,
    model: settings.model,
    preset_id: settings.presetId,
    speed: settings.speed,
    stability: settings.stability,
    similarity_boost: settings.similarityBoost,
    style: settings.style,
    speaker_boost: settings.speakerBoost,
    emotional_intensity: settings.emotionalIntensity,
    pacing: settings.pacing,
    tone: settings.tone,
    delivery_style: settings.deliveryStyle,
    narration_instruction: settings.narrationInstruction,
    language_mode: settings.languageMode,
    use_expressive_tags: settings.useExpressiveTags,
    use_pronunciation_dictionary: settings.usePronunciationDictionary,
    pause_style: settings.pauseStyle,
    updated_at: new Date().toISOString(),
  };
}

function rowToSettings(
  row: Record<string, any>,
  storyLanguage: string,
  adminSettings: ReelNarrationAdminSettings
): ReelNarrationSettings {
  return normalizeReelNarrationSettings({
    provider: row.provider,
    fallback_provider: row.fallback_provider,
    language: row.language,
    language_source: row.language_source,
    detected_language: row.detected_language,
    is_mixed_language: row.is_mixed_language,
    voice_id: row.voice_id,
    model: row.model,
    preset_id: row.preset_id,
    speed: row.speed,
    stability: row.stability,
    similarity_boost: row.similarity_boost,
    style: row.style,
    speaker_boost: row.speaker_boost,
    emotional_intensity: row.emotional_intensity,
    pacing: row.pacing,
    tone: row.tone,
    delivery_style: row.delivery_style,
    narration_instruction: row.narration_instruction,
    language_mode: row.language_mode,
    use_expressive_tags: row.use_expressive_tags,
    use_pronunciation_dictionary: row.use_pronunciation_dictionary,
    pause_style: row.pause_style,
  }, { storyLanguage, adminSettings });
}

export async function getReelNarrationAdminSettings(): Promise<ReelNarrationAdminSettings> {
  const value = await getFeatureFlagValue('reel_story_settings').catch(() => null);
  const settings = parseReelStorySettingsValue(value);
  return settings.narration ?? normalizeReelNarrationAdminSettings(null, settings.elevenLabs);
}

async function getCurrentUserId(required = false): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if ((error || !user) && required) {
    throw new Error('Not authenticated');
  }
  return user?.id ?? null;
}

export async function listNarrationPresetsAction(): Promise<{
  presets: NarrationPreset[];
  adminSettings: ReelNarrationAdminSettings;
}> {
  const [adminSettings, userId] = await Promise.all([
    getReelNarrationAdminSettings(),
    getCurrentUserId(false),
  ]);
  const enabledSystemIds = new Set(adminSettings.enabledSystemPresetIds);
  const fallbackSystemPresets = SYSTEM_NARRATION_PRESETS
    .filter((preset) => enabledSystemIds.has(preset.id))
    .map((preset) => ({
      ...preset,
      model: preset.model || adminSettings.finalElevenLabsModel,
      voiceId: preset.voiceId || adminSettings.defaultVoiceId,
      isDefault: preset.id === adminSettings.defaultPresetId || preset.isDefault,
    }));

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('narration_presets')
      .select('*')
      .or(userId
        ? `preset_scope.eq.system,user_id.eq.${userId}`
        : 'preset_scope.eq.system')
      .order('preset_scope', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      if (isMissingNarrationTableError(error)) {
        return { presets: fallbackSystemPresets, adminSettings };
      }
      throw new Error(error.message);
    }

    const rows = (data || []).map(rowToPreset);
    const visible = rows.filter((preset) => (
      preset.presetScope === 'user'
      || enabledSystemIds.has(preset.id)
      || !SYSTEM_NARRATION_PRESETS.some((systemPreset) => systemPreset.id === preset.id)
    ));
    return {
      presets: visible.length > 0 ? visible : fallbackSystemPresets,
      adminSettings,
    };
  } catch (error) {
    console.error('Failed to list narration presets:', error);
    return { presets: fallbackSystemPresets, adminSettings };
  }
}

export async function createNarrationPresetAction(input: Partial<NarrationPreset>): Promise<NarrationPreset> {
  const userId = await getCurrentUserId(true);
  const normalized = normalizeNarrationPreset({
    ...input,
    id: crypto.randomUUID(),
    userId,
    presetScope: 'user',
    presetVisibility: 'private',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('narration_presets')
    .insert(presetToRow(normalized, userId!, { id: normalized.id, isDefault: normalized.isDefault }))
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create preset: ${error.message}`);
  return rowToPreset(data);
}

export async function saveNarrationSettingsAsPresetAction(input: {
  settings: ReelNarrationSettings;
  name: string;
  description?: string;
}): Promise<NarrationPreset> {
  const presetInput = buildPresetInputFromSettings(input.settings, input.name, input.description ?? '');
  return createNarrationPresetAction(presetInput);
}

export async function updateNarrationPresetAction(
  id: string,
  input: Partial<NarrationPreset>
): Promise<NarrationPreset> {
  const userId = await getCurrentUserId(true);
  const existing = normalizeNarrationPreset({ ...input, id });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('narration_presets')
    .update(presetToRow(existing, userId!))
    .eq('id', id)
    .eq('user_id', userId!)
    .eq('preset_scope', 'user')
    .select('*')
    .single();

  if (error) throw new Error(`Failed to update preset: ${error.message}`);
  return rowToPreset(data);
}

export async function duplicateNarrationPresetAction(id: string): Promise<NarrationPreset> {
  const userId = await getCurrentUserId(true);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('narration_presets')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  let source: NarrationPreset | null = data ? rowToPreset(data) : null;
  source = source ?? SYSTEM_NARRATION_PRESETS.find((preset) => preset.id === id) ?? null;
  if (error && !isMissingNarrationTableError(error)) throw new Error(error.message);
  if (!source) throw new Error('Preset not found.');

  const copy = {
    ...source,
    id: crypto.randomUUID(),
    userId,
    name: `${source.name} Copy`,
    presetScope: 'user' as const,
    presetVisibility: 'private' as const,
    isDefault: false,
  };
  const { data: inserted, error: insertError } = await supabase
    .from('narration_presets')
    .insert(presetToRow(copy, userId!, { id: copy.id, isDefault: false }))
    .select('*')
    .single();

  if (insertError) throw new Error(`Failed to duplicate preset: ${insertError.message}`);
  return rowToPreset(inserted);
}

export async function deleteNarrationPresetAction(id: string): Promise<void> {
  const userId = await getCurrentUserId(true);
  const supabase = await createClient();
  const { error } = await supabase
    .from('narration_presets')
    .delete()
    .eq('id', id)
    .eq('user_id', userId!)
    .eq('preset_scope', 'user');

  if (error) throw new Error(`Failed to delete preset: ${error.message}`);
}

export async function saveDefaultNarrationPresetAction(id: string): Promise<void> {
  const userId = await getCurrentUserId(true);
  const supabase = await createClient();
  await supabase
    .from('narration_presets')
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq('user_id', userId!)
    .eq('preset_scope', 'user');

  const { error } = await supabase
    .from('narration_presets')
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId!)
    .eq('preset_scope', 'user');

  if (error) throw new Error(`Failed to set default preset: ${error.message}`);
}

async function loadStoryForNarrationSettings(storyId: string): Promise<{
  userId: string;
  storyConfig: StoryConfig;
}> {
  const userId = await getCurrentUserId(true);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('stories')
    .select('user_id, story_config')
    .eq('id', storyId)
    .eq('user_id', userId!)
    .single();

  if (error || !data) {
    throw new Error(`Failed to load reel story: ${error?.message || 'not found'}`);
  }

  return {
    userId: data.user_id,
    storyConfig: normalizeStoryConfig((data.story_config as Record<string, unknown> | null) ?? null),
  };
}

export async function getReelNarrationSettingsAction(
  storyId: string,
  storyLanguage?: StoryLanguage | string | null
): Promise<ReelNarrationSettings> {
  const adminSettings = await getReelNarrationAdminSettings();
  try {
    const story = await loadStoryForNarrationSettings(storyId);
    const language = storyLanguage ?? story.storyConfig.language;
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('reel_narration_settings')
      .select('*')
      .eq('story_id', storyId)
      .maybeSingle();

    if (error) {
      if (isMissingNarrationTableError(error)) {
        return normalizeReelNarrationSettings(story.storyConfig.reel.narrationSettings, {
          storyLanguage: language,
          adminSettings,
        });
      }
      throw new Error(error.message);
    }

    if (data) {
      return rowToSettings(data, String(language), adminSettings);
    }

    return normalizeReelNarrationSettings(story.storyConfig.reel.narrationSettings, {
      storyLanguage: language,
      adminSettings,
    });
  } catch {
    return normalizeReelNarrationSettings(null, { storyLanguage, adminSettings });
  }
}

export async function saveReelNarrationSettingsAction(input: {
  storyId: string;
  settings: ReelNarrationSettings;
  clearExistingAudio?: boolean;
}): Promise<ReelNarrationSettings> {
  const adminSettings = await getReelNarrationAdminSettings();
  const story = await loadStoryForNarrationSettings(input.storyId);
  const normalized = normalizeReelNarrationSettings(input.settings, {
    storyLanguage: story.storyConfig.language,
    adminSettings,
  });
  const supabase = await createClient();

  const { error: upsertError } = await supabase
    .from('reel_narration_settings')
    .upsert(settingsToRow(input.storyId, story.userId, normalized), { onConflict: 'story_id' });

  if (upsertError && !isMissingNarrationTableError(upsertError)) {
    throw new Error(`Failed to save narration settings: ${upsertError.message}`);
  }

  const nextConfig = normalizeStoryConfig({
    ...story.storyConfig,
    reel: {
      ...story.storyConfig.reel,
      narrationSettings: normalized,
    },
  });
  const { error: storyError } = await supabase
    .from('stories')
    .update({
      story_config: nextConfig as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.storyId)
    .eq('user_id', story.userId);

  if (storyError) {
    throw new Error(`Failed to update story narration settings: ${storyError.message}`);
  }

  if (input.clearExistingAudio) {
    const admin = createAdminClient();
    await admin
      .from('beats')
      .update({
        audio_url: null,
        audio_status: 'not_requested',
        audio_error: null,
        narration_voice_id: null,
        narration_metadata: null,
        active_narration_preview_id: null,
        audio_synced_at: null,
      })
      .eq('story_id', input.storyId);

    const { error: clearPreviewError } = await admin
      .from('reel_narration_voice_previews')
      .update({ is_active: false, active_narration: null })
      .eq('story_id', input.storyId);
    if (clearPreviewError && !isMissingNarrationTableError(clearPreviewError)) {
      console.warn('Failed to clear active narration previews:', clearPreviewError.message);
    }
  }

  return normalized;
}

export async function applyNarrationPresetToSettingsAction(input: {
  settings: ReelNarrationSettings;
  presetId: string;
}): Promise<ReelNarrationSettings> {
  const { presets, adminSettings } = await listNarrationPresetsAction();
  const preset = presets.find((candidate) => candidate.id === input.presetId);
  if (!preset) throw new Error('Preset not found.');
  return applyPresetToNarrationSettings(input.settings, preset, adminSettings);
}

export async function previewReelNarrationAction(input: {
  text: string;
  settings: ReelNarrationSettings;
  scope?: NarrationVoicePreviewScope;
  reelCaptions?: ReelNarrationVoicePreview['reelCaptions'];
  storyLanguage?: StoryLanguage | string | null;
  panelPauseMs?: number;
}): Promise<{
  audioUrl: string;
  settings: ReelNarrationSettings;
  narrationMetadata: BeatNarrationMetadata;
  reelCaptions?: ReelNarrationVoicePreview['reelCaptions'];
}> {
  const userId = await getCurrentUserId(true);
  const [adminSettings, voiceSettings] = await Promise.all([
    getReelNarrationAdminSettings(),
    getNarrationVoiceSettings().catch(() => null),
  ]);
  const settings = normalizeReelNarrationSettings(
    {
      ...input.settings,
      language: input.settings.language || storyLanguageToNarrationLanguage(input.storyLanguage),
    },
    {
      storyLanguage: input.storyLanguage,
      adminSettings,
    }
  );
  const previewSettings = normalizeReelNarrationSettings(
    {
      ...settings,
      model: resolvePreviewElevenLabsModel(settings, adminSettings),
    },
    {
      storyLanguage: input.storyLanguage,
      adminSettings,
    }
  );
  const geminiFallbackVoice = adminSettings.fallbackGeminiVoice
    || voiceSettings?.defaultFemaleVoice
    || DEFAULT_REEL_NARRATION_ADMIN_SETTINGS.fallbackGeminiVoice;
  const sample = input.text.trim().slice(0, Math.min(adminSettings.maxNarrationLength, 700))
    || 'Every quiet moment has a story waiting inside it.';

  const result = await generateReelNarrationOnly(
    sample,
    previewSettings.tone,
    'Kissago reel narration preview',
    geminiFallbackVoice,
    previewSettings.language,
    undefined,
    {
      narrationStyle: previewSettings.narrationInstruction,
      reelSettings: {
        ...DEFAULT_REEL_STORY_SETTINGS,
        narration: adminSettings,
      },
      reelCaptions: input.reelCaptions,
      narrationSettings: previewSettings,
      generationMode: 'preview',
      previewScope: previewScopeToMetadataScope(input.scope ?? '1_beat'),
      panelPauseMs: input.panelPauseMs,
      logUserId: userId,
    }
  );

  return {
    audioUrl: result.audioUrl,
    settings: previewSettings,
    narrationMetadata: result.narrationMetadata,
    reelCaptions: result.reelCaptions,
  };
}

// ---------------------------------------------------------------------------
// Voice preview history
// ---------------------------------------------------------------------------

const MAX_VOICE_PREVIEWS = 4;

function previewScopeToMetadataScope(scope: NarrationVoicePreviewScope): 'sample' | 'full' {
  return scope === 'full' ? 'full' : 'sample';
}

function buildPreviewMetadataFromRow(row: Record<string, unknown>, audioUrl: string | null): NarrationPreviewMetadata | undefined {
  const rawMetadata = row.generation_metadata && typeof row.generation_metadata === 'object'
    ? row.generation_metadata as Record<string, unknown>
    : {};
  const hasMetadata = Object.keys(rawMetadata).length > 0 || row.provider_used || row.selected_model;
  if (!hasMetadata) return undefined;

  return normalizeNarrationPreviewMetadata({
    ...rawMetadata,
    scope: previewScopeToMetadataScope((row.preview_scope as NarrationVoicePreviewScope) ?? '1_beat'),
    provider: rawMetadata.provider ?? row.provider_used,
    model: rawMetadata.model ?? row.selected_model,
    voiceId: rawMetadata.voiceId ?? row.voice_id,
    voiceName: rawMetadata.voiceName ?? row.voice_display_name,
    language: rawMetadata.language ?? row.language,
    audioUrl: audioUrl ?? rawMetadata.audioUrl,
    durationMs: rawMetadata.durationMs ?? row.duration_ms,
    wordTimestamps: rawMetadata.wordTimestamps ?? row.word_timestamps,
    timestampSource: rawMetadata.timestampSource ?? row.timestamp_source,
    fallbackUsed: rawMetadata.fallbackUsed ?? row.fallback_used,
    fallbackReason: rawMetadata.fallbackReason ?? row.fallback_reason,
    charsUsed: rawMetadata.charsUsed ?? row.chars_used,
    tokensUsed: rawMetadata.tokensUsed ?? row.tokens_used,
    createdAt: rawMetadata.createdAt ?? row.created_at,
  });
}

function rowToVoicePreview(row: Record<string, unknown>, audioUrl: string | null): ReelNarrationVoicePreview {
  const generationMetadata = buildPreviewMetadataFromRow(row, audioUrl);
  const activeNarration = row.active_narration && typeof row.active_narration === 'object'
    ? row.active_narration as ActiveNarration
    : undefined;
  return {
    id: row.id as string,
    storyId: row.story_id as string,
    nodeId: (row.node_id as string | null) || undefined,
    userId: row.user_id as string,
    label: row.label as string,
    voiceDisplayName: (row.voice_display_name as string) ?? '',
    audioR2Key: row.audio_r2_key as string,
    audioMimeType: (row.audio_mime_type as string) ?? 'audio/mpeg',
    audioUrl,
    settingsSnapshot: row.settings_snapshot as ReelNarrationSettings,
    previewScope: (row.preview_scope as NarrationVoicePreviewScope) ?? '1_beat',
    generationMetadata,
    activeNarration,
    reelCaptions: Array.isArray(row.reel_captions)
      ? row.reel_captions as ReelNarrationVoicePreview['reelCaptions']
      : undefined,
    isActive: (row.is_active as boolean) ?? false,
    createdAt: row.created_at as string,
  };
}

export async function listReelNarrationVoicePreviewsAction(
  storyId: string,
  nodeId?: string | null
): Promise<ReelNarrationVoicePreview[]> {
  const userId = await getCurrentUserId(true);
  const supabase = await createClient();
  let query = supabase
    .from('reel_narration_voice_previews')
    .select('*')
    .eq('story_id', storyId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(MAX_VOICE_PREVIEWS);

  if (nodeId) {
    query = query.or(`node_id.is.null,node_id.eq.${nodeId}`);
  }

  const { data, error } = await query;

  if (error) {
    if (isMissingNarrationTableError(error)) return [];
    throw new Error(`Failed to list voice previews: ${error.message}`);
  }

  const previews = await Promise.all(
    (data ?? []).map(async (row) => {
      const audioUrl = await createR2SignedGetUrl(row.audio_r2_key as string).catch(() => null);
      return rowToVoicePreview(row as Record<string, unknown>, audioUrl);
    })
  );
  return previews;
}

export async function saveReelNarrationVoicePreviewAction(input: {
  storyId: string;
  nodeId?: string;
  audioDataUrl: string;
  settings: ReelNarrationSettings;
  scope: NarrationVoicePreviewScope;
  voiceDisplayName: string;
  generationMetadata?: BeatNarrationMetadata | NarrationPreviewMetadata;
  reelCaptions?: ReelNarrationVoicePreview['reelCaptions'];
}): Promise<ReelNarrationVoicePreview> {
  const userId = await getCurrentUserId(true);
  const supabase = await createClient();

  // Parse the data URL: data:<mime>;base64,<data>
  const parsed = splitBase64DataUrl(input.audioDataUrl);
  if (!parsed) throw new Error('Invalid audio data URL');
  const { mimeType, base64: base64Data } = parsed;
  const audioBuffer = Buffer.from(base64Data, 'base64');

  // Enforce max 4: delete oldest if at capacity
  let existingQuery = supabase
    .from('reel_narration_voice_previews')
    .select('id, label, audio_r2_key, created_at')
    .eq('story_id', input.storyId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  existingQuery = input.nodeId
    ? existingQuery.eq('node_id', input.nodeId)
    : existingQuery.is('node_id', null);
  const { data: existing } = await existingQuery;

  if (existing && existing.length >= MAX_VOICE_PREVIEWS) {
    const oldest = existing[0];
    await deleteR2Object(oldest.audio_r2_key as string).catch(() => {});
    await supabase.from('reel_narration_voice_previews').delete().eq('id', oldest.id);
  }

  // Determine next label number by finding the lowest unused slot (01–04)
  const survivingAfterEviction = (existing && existing.length >= MAX_VOICE_PREVIEWS)
    ? (existing ?? []).slice(1)
    : (existing ?? []);
  const takenNumbers = new Set(
    survivingAfterEviction.map((r: Record<string, unknown>) => {
      const m = String(r['label'] ?? '').match(/(\d+)$/);
      return m ? parseInt(m[1], 10) : 0;
    })
  );
  let labelNumber = 1;
  while (takenNumbers.has(labelNumber) && labelNumber <= MAX_VOICE_PREVIEWS) labelNumber++;
  const label = `Preview ${String(labelNumber).padStart(2, '0')}`;

  // Upload to R2 — store the full r2://bucket/key reference so signed URL resolution works
  const ext = mimeType === 'audio/wav' ? 'wav' : 'mp3';
  const objectKey = `stories/${input.storyId}/voice-previews/${crypto.randomUUID()}.${ext}`;
  const { urlOrReference } = await putR2Object({
    access: 'private',
    objectKey,
    body: audioBuffer,
    contentType: mimeType,
  });

  // Insert DB record
  const { data: inserted, error: insertError } = await supabase
    .from('reel_narration_voice_previews')
    .insert({
      story_id: input.storyId,
      node_id: input.nodeId ?? null,
      user_id: userId,
      label,
      voice_display_name: input.voiceDisplayName,
      audio_r2_key: urlOrReference,
      audio_mime_type: mimeType,
      settings_snapshot: input.settings as unknown as Record<string, unknown>,
      preview_scope: input.scope,
      provider_used: input.generationMetadata?.provider ?? null,
      selected_model: input.generationMetadata?.model ?? null,
      voice_id: input.generationMetadata?.voiceId ?? input.settings.voiceId,
      language: input.generationMetadata?.language ?? input.settings.language,
      duration_ms: input.generationMetadata?.durationMs ?? null,
      word_timestamps: (input.generationMetadata?.wordTimestamps as unknown as Record<string, unknown>[] | undefined) ?? null,
      text_highlight_supported: input.generationMetadata?.textHighlightSupported ?? false,
      timestamp_source: input.generationMetadata?.timestampSource ?? 'none',
      fallback_used: input.generationMetadata?.fallbackUsed ?? false,
      fallback_reason: input.generationMetadata?.fallbackReason ?? null,
      chars_used: input.generationMetadata?.charsUsed ?? null,
      tokens_used: input.generationMetadata?.tokensUsed ?? null,
      reel_captions: (input.reelCaptions as unknown as Record<string, unknown>[] | undefined) ?? null,
      generation_metadata: input.generationMetadata
        ? {
            ...input.generationMetadata,
            audioUrl: urlOrReference,
            voiceName: input.voiceDisplayName,
            scope: previewScopeToMetadataScope(input.scope),
          } as unknown as Record<string, unknown>
        : {},
      is_active: false,
    })
    .select()
    .single();

  if (insertError) throw new Error(`Failed to save voice preview: ${insertError.message}`);

  const audioUrl = await createR2SignedGetUrl(urlOrReference).catch(() => null);
  return rowToVoicePreview(inserted as Record<string, unknown>, audioUrl);
}

export async function deleteReelNarrationVoicePreviewAction(id: string): Promise<void> {
  const userId = await getCurrentUserId(true);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reel_narration_voice_previews')
    .select('story_id, node_id, audio_r2_key, is_active')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (error) throw new Error(`Voice preview not found: ${error.message}`);
  if (data.is_active && data.node_id) {
    await updateBeatMediaState(data.story_id as string, data.node_id as string, {
      audioUrl: null,
      audioStatus: 'not_requested',
      audioError: null,
      narrationMetadata: null,
      activeNarrationPreviewId: null,
    });
  }
  await deleteR2Object(data.audio_r2_key as string).catch(() => {});
  await supabase.from('reel_narration_voice_previews').delete().eq('id', id).eq('user_id', userId);
}

export async function clearReelNarrationForBeatAction(
  storyId: string,
  nodeId: string
): Promise<{ deletedPreviewIds: string[] }> {
  const userId = await getCurrentUserId(true);
  const supabase = await createClient();
  const matchingNodeFilter = `node_id.is.null,node_id.eq.${nodeId}`;

  const { data: previews, error: previewListError } = await supabase
    .from('reel_narration_voice_previews')
    .select('id, audio_r2_key')
    .eq('story_id', storyId)
    .eq('user_id', userId)
    .or(matchingNodeFilter);

  if (previewListError && !isMissingNarrationTableError(previewListError)) {
    throw new Error(`Failed to load narration previews for clearing: ${previewListError.message}`);
  }

  await updateBeatMediaState(storyId, nodeId, {
    audioUrl: null,
    audioStatus: 'not_requested',
    audioError: null,
    narrationVoiceId: null,
    narrationMetadata: null,
    activeNarrationPreviewId: null,
  });

  const deletedPreviewIds = (previews ?? []).map((preview) => preview.id as string);
  if (deletedPreviewIds.length === 0) {
    return { deletedPreviewIds };
  }

  const { error: previewDeleteError } = await supabase
    .from('reel_narration_voice_previews')
    .delete()
    .eq('story_id', storyId)
    .eq('user_id', userId)
    .or(matchingNodeFilter);

  if (previewDeleteError && !isMissingNarrationTableError(previewDeleteError)) {
    throw new Error(`Failed to clear narration previews: ${previewDeleteError.message}`);
  }

  await Promise.allSettled(
    (previews ?? []).map((preview) => deleteR2Object(preview.audio_r2_key as string))
  );

  return { deletedPreviewIds };
}

export async function applyReelNarrationVoicePreviewAction(
  id: string,
  targetNodeId?: string | null
): Promise<{ settings: ReelNarrationSettings; preview: ReelNarrationVoicePreview }> {
  const userId = await getCurrentUserId(true);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('reel_narration_voice_previews')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (error) throw new Error(`Voice preview not found: ${error.message}`);
  if ((data.preview_scope as NarrationVoicePreviewScope) !== 'full') {
    throw new Error('Only full beat previews can be applied.');
  }
  const applyNodeId = (data.node_id as string | null) || targetNodeId || null;

  // Mark this one active, clear older active previews for the same beat.
  let clearActiveQuery = supabase
    .from('reel_narration_voice_previews')
    .update({ is_active: false, active_narration: null })
    .eq('story_id', data.story_id)
    .eq('user_id', userId);
  clearActiveQuery = applyNodeId
    ? clearActiveQuery.eq('node_id', applyNodeId)
    : clearActiveQuery.is('node_id', null);
  await clearActiveQuery;
  await supabase
    .from('reel_narration_voice_previews')
    .update({
      is_active: true,
      ...(applyNodeId ? { node_id: applyNodeId } : {}),
    })
    .eq('id', id);

  const signedAudioUrl = await createR2SignedGetUrl(data.audio_r2_key as string).catch(() => null);
  const preview = rowToVoicePreview(data as Record<string, unknown>, signedAudioUrl);
  const previewMetadata: NarrationPreviewMetadata | undefined = preview.generationMetadata
    ? {
        ...preview.generationMetadata,
        scope: 'full',
        audioUrl: data.audio_r2_key as string,
      }
    : undefined;
  const beatMetadata: BeatNarrationMetadata | undefined = previewMetadata
    ? {
        ...previewMetadata,
        previewId: id,
      }
    : undefined;
  const activeNarration: ActiveNarration | undefined = previewMetadata
    ? {
        ...previewMetadata,
        previewId: id,
        scope: 'full',
        audioUrl: data.audio_r2_key as string,
      }
    : undefined;

  if (applyNodeId) {
    await updateBeatMediaState(data.story_id as string, applyNodeId, {
      audioUrl: data.audio_r2_key as string,
      audioStatus: 'ready',
      audioError: null,
      narrationVoiceId: preview.settingsSnapshot.voiceId,
      narrationMetadata: beatMetadata,
      activeNarrationPreviewId: id,
      ...(preview.reelCaptions?.length ? { reelCaptions: preview.reelCaptions } : {}),
    });
  }

  await supabase
    .from('reel_narration_voice_previews')
    .update({ active_narration: activeNarration ? activeNarration as unknown as Record<string, unknown> : null })
    .eq('id', id);

  return {
    settings: data.settings_snapshot as unknown as ReelNarrationSettings,
    preview: {
      ...preview,
      nodeId: applyNodeId ?? preview.nodeId,
      isActive: true,
      activeNarration,
      generationMetadata: previewMetadata,
    },
  };
}
