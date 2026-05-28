'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFeatureFlagValue } from '@/lib/ai/model-config';
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
  normalizeNarrationPreset,
  normalizeReelNarrationAdminSettings,
  normalizeReelNarrationSettings,
  storyLanguageToNarrationLanguage,
  type NarrationPreset,
  type ReelNarrationAdminSettings,
  type ReelNarrationSettings,
} from '@/lib/reel/narration';
import { normalizeStoryConfig } from '@/lib/ai/story-config';
import type { StoryConfig, StoryLanguage } from '@/lib/types/story';

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
        audio_synced_at: null,
      })
      .eq('story_id', input.storyId);
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
  storyLanguage?: StoryLanguage | string | null;
}): Promise<{ audioUrl: string; settings: ReelNarrationSettings }> {
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
      model: adminSettings.previewElevenLabsModel || settings.model,
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
      narrationSettings: previewSettings,
      generationMode: 'preview',
      logUserId: userId,
    }
  );

  return {
    audioUrl: result.audioUrl,
    settings,
  };
}
