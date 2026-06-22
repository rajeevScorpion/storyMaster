'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Pause, Play, Sparkles, Trash2, X } from 'lucide-react';

import {
  createStoryEffectPresetAction,
  deleteStoryEffectPresetAction,
  listStoryEffectPresetsAction,
  updateStoryEffectPresetAction,
} from '@/app/actions/story-effects';
import { useAudioPlayer } from '@/lib/hooks/useAudioPlayer';
import { SYSTEM_STORY_EFFECT_PRESETS, applyStoryEffectPreset, type StoryEffectPreset } from '@/lib/story-effects/presets';
import { normalizeStoryEffectConfig, type StoryEffectConfig } from '@/lib/story-effects/settings';
import type { StoryAspectRatio, StoryBeat } from '@/lib/types/story';
import StoryStoryboardPlayer from './StoryStoryboardPlayer';

function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  suffix = '',
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <label className="block rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2.5">
      <span className="flex items-center justify-between text-xs text-neutral-300">
        <span>{label}</span><span className="tabular-nums text-neutral-500">{Number(value.toFixed(2))}{suffix}</span>
      </span>
      <input className="mt-2 h-1.5 w-full cursor-pointer accent-emerald-400" type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function SectionToggle({ label, enabled, onChange }: { label: string; enabled: boolean; onChange: (enabled: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between text-sm font-medium text-white">
      {label}
      <input type="checkbox" checked={enabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-emerald-400" />
    </label>
  );
}

export default function StoryEffectsDialog({
  open,
  nodeId,
  beat,
  aspectRatio,
  vignetteEnabled,
  vignetteAmountPercent,
  totalBeatCount,
  onClose,
  onSave,
  onApplyAll,
}: {
  open: boolean;
  nodeId: string;
  beat: StoryBeat;
  aspectRatio: StoryAspectRatio;
  vignetteEnabled: boolean;
  vignetteAmountPercent: number;
  totalBeatCount: number;
  onClose: () => void;
  onSave: (config: StoryEffectConfig) => Promise<void>;
  onApplyAll: (config: StoryEffectConfig) => Promise<number>;
}) {
  const [draft, setDraft] = useState(() => normalizeStoryEffectConfig(beat.storyEffects));
  const [personalPresets, setPersonalPresets] = useState<StoryEffectPreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audio = useAudioPlayer(open ? beat.audioUrl : undefined, `story-effects:${nodeId}`);
  const presets = useMemo(() => [...SYSTEM_STORY_EFFECT_PRESETS, ...personalPresets], [personalPresets]);
  const selectedPersonalPreset = personalPresets.find((preset) => preset.id === draft.sourcePresetId);

  useEffect(() => {
    if (!open) return;
    setDraft(normalizeStoryEffectConfig(beat.storyEffects));
    setMessage(null);
    setError(null);
    void listStoryEffectPresetsAction()
      .then(setPersonalPresets)
      .catch(() => setPersonalPresets([]));
  }, [beat.storyEffects, open]);

  if (!open || !beat.imageUrl) return null;

  const update = (next: StoryEffectConfig) => {
    setDraft(normalizeStoryEffectConfig(next));
    setMessage(null);
    setError(null);
  };
  const run = async (action: () => Promise<void>) => {
    setIsSaving(true);
    setError(null);
    setMessage(null);
    try { await action(); } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Unable to save story effects.');
    } finally { setIsSaving(false); }
  };

  const selectPreset = (id: string) => {
    const preset = presets.find((item) => item.id === id);
    if (preset) update(applyStoryEffectPreset(preset));
  };

  // Switching particle type swaps the underlying physics, so seed sensible
  // values: rain needs a gentle downward slant and quick fall to read as rain
  // immediately; leaving rain restores the upward float default for dust/snow.
  const setParticleType = (type: StoryEffectConfig['particles']['type']) => {
    const current = draft.particles;
    if (type === 'rain' && current.type !== 'rain') {
      update({ ...draft, particles: { ...current, type, direction: 12, speed: Math.max(current.speed, 1.6), size: Math.min(current.size, 0.8), opacity: Math.min(Math.max(current.opacity, 0.4), 0.6) } });
    } else if (type !== 'rain' && current.type === 'rain') {
      update({ ...draft, particles: { ...current, type, direction: -90 } });
    } else {
      update({ ...draft, particles: { ...current, type } });
    }
  };
  const isRain = draft.particles.type === 'rain';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-3 backdrop-blur-md" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSaving) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="story-effects-title" className="flex max-h-[96dvh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950 shadow-2xl">
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-3"><Sparkles className="h-5 w-5 text-emerald-300" /><div><h2 id="story-effects-title" className="font-semibold text-white">Story Effects</h2><p className="text-xs text-neutral-500">Beat {beat.beatNumber} · all four panels</p></div></div>
          <button type="button" onClick={onClose} disabled={isSaving} className="rounded-full p-2 text-neutral-400 hover:bg-white/10 hover:text-white" aria-label="Close story effects"><X className="h-5 w-5" /></button>
        </header>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(320px,0.9fr)_minmax(360px,1.1fr)]">
          <div className="border-b border-white/10 p-5 lg:border-b-0 lg:border-r">
            <div className={`relative mx-auto overflow-hidden rounded-2xl border border-white/10 bg-black ${aspectRatio === '9:16' ? 'aspect-[9/16] max-h-[62vh]' : 'aspect-video w-full'}`}>
              <StoryStoryboardPlayer
                gridUrl={beat.imageUrl}
                audioUrl={beat.audioUrl}
                audioElapsedMs={audio.currentTimeMs}
                audioDurationMs={audio.durationMs}
                cycleOverride={false}
                cycleMs={2500}
                vignetteEnabled={vignetteEnabled}
                vignetteAmountPercent={vignetteAmountPercent}
                playbackState={audio.playbackState}
                narrationTiming={beat.storyboardNarrationTiming}
                storyTextOverlayCaptions={beat.storyTextOverlayCaptions}
                storyTextOverlayEnabled={beat.storyTextOverlayEnabled !== false}
                storyTextOverlayMode={beat.storyTextOverlayMode}
                storyTextOverlayStyle={beat.storyTextOverlayStyle}
                storyEffects={draft}
                effectSeed={nodeId}
                showIndicators
              />
            </div>
            {beat.audioUrl && <button type="button" onClick={audio.togglePlayPause} className="mx-auto mt-4 flex h-10 items-center gap-2 rounded-full bg-emerald-400 px-5 text-sm font-semibold text-neutral-950">{audio.playbackState === 'playing' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{audio.playbackState === 'playing' ? 'Pause' : 'Preview'}</button>}
            <label className="mt-5 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white">Enable effects<input type="checkbox" checked={draft.enabled} onChange={(event) => update({ ...draft, enabled: event.target.checked })} className="h-5 w-5 accent-emerald-400" /></label>

            <div className="mt-4">
              <label className="text-xs uppercase tracking-wider text-neutral-500">Preset</label>
              <select value={draft.sourcePresetId || ''} onChange={(event) => selectPreset(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-neutral-900 px-3 py-2.5 text-sm text-white">
                <option value="">Custom</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}{preset.isSystem ? '' : ' · Mine'}</option>)}
              </select>
              <div className="mt-3 flex gap-2"><input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="New preset name" maxLength={80} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-600" /><button type="button" disabled={isSaving || !presetName.trim()} onClick={() => void run(async () => { const preset = await createStoryEffectPresetAction({ name: presetName, config: draft }); setPersonalPresets((current) => [preset, ...current]); setPresetName(''); update(applyStoryEffectPreset(preset)); setMessage('Preset saved.'); })} className="rounded-xl border border-emerald-400/30 px-3 text-xs font-semibold text-emerald-200 disabled:opacity-40">Save preset</button></div>
              {selectedPersonalPreset && <div className="mt-2 flex gap-2"><button type="button" disabled={isSaving} onClick={() => void run(async () => { const preset = await updateStoryEffectPresetAction({ id: selectedPersonalPreset.id, name: selectedPersonalPreset.name, description: selectedPersonalPreset.description, config: draft }); setPersonalPresets((current) => current.map((item) => item.id === preset.id ? preset : item)); setMessage('Preset updated; existing beats were not changed.'); })} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-neutral-300">Update preset</button><button type="button" disabled={isSaving} onClick={() => void run(async () => { await deleteStoryEffectPresetAction(selectedPersonalPreset.id); setPersonalPresets((current) => current.filter((item) => item.id !== selectedPersonalPreset.id)); update({ ...draft, sourcePresetId: undefined }); setMessage('Preset deleted; applied beat effects remain.'); })} className="rounded-lg border border-rose-400/20 px-3 py-1.5 text-xs text-rose-300"><Trash2 className="mr-1 inline h-3 w-3" />Delete</button></div>}
            </div>
          </div>

          <div className="space-y-4 p-5">
            <section className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4"><SectionToggle label="Cinematic motion" enabled={draft.motion.enabled} onChange={(enabled) => update({ ...draft, motion: { ...draft.motion, enabled } })} /><div className="grid gap-2 sm:grid-cols-2"><RangeField label="Zoom start" value={draft.motion.zoomStart} min={1} max={1.3} step={0.01} onChange={(zoomStart) => update({ ...draft, motion: { ...draft.motion, zoomStart } })} /><RangeField label="Zoom end" value={draft.motion.zoomEnd} min={1} max={1.3} step={0.01} onChange={(zoomEnd) => update({ ...draft, motion: { ...draft.motion, zoomEnd } })} /><RangeField label="Horizontal drift" value={draft.motion.driftX} min={-20} max={20} step={1} suffix="%" onChange={(driftX) => update({ ...draft, motion: { ...draft.motion, driftX } })} /><RangeField label="Vertical drift" value={draft.motion.driftY} min={-20} max={20} step={1} suffix="%" onChange={(driftY) => update({ ...draft, motion: { ...draft.motion, driftY } })} /><RangeField label="Intensity" value={draft.motion.intensity} min={0} max={100} step={1} suffix="%" onChange={(intensity) => update({ ...draft, motion: { ...draft.motion, intensity } })} /></div></section>

            <section className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4"><SectionToggle label="Particles" enabled={draft.particles.enabled} onChange={(enabled) => update({ ...draft, particles: { ...draft.particles, enabled } })} /><select value={draft.particles.type} onChange={(event) => setParticleType(event.target.value as StoryEffectConfig['particles']['type'])} className="w-full rounded-xl border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-white"><option value="dust">Dust</option><option value="snow">Snow</option><option value="rain">Rain</option></select><div className="grid gap-2 sm:grid-cols-2"><RangeField label="Amount" value={draft.particles.amount} min={0} max={120} step={1} onChange={(amount) => update({ ...draft, particles: { ...draft.particles, amount } })} /><RangeField label="Density" value={draft.particles.density} min={0} max={100} step={1} suffix="%" onChange={(density) => update({ ...draft, particles: { ...draft.particles, density } })} /><RangeField label="Opacity" value={draft.particles.opacity} min={0} max={1} step={0.05} onChange={(opacity) => update({ ...draft, particles: { ...draft.particles, opacity } })} /><RangeField label={isRain ? 'Fall speed' : 'Speed'} value={draft.particles.speed} min={0} max={3} step={0.05} onChange={(speed) => update({ ...draft, particles: { ...draft.particles, speed } })} /><RangeField label="Size" value={draft.particles.size} min={0.25} max={3} step={0.05} onChange={(size) => update({ ...draft, particles: { ...draft.particles, size } })} />{isRain ? <RangeField label="Slant" value={draft.particles.direction} min={-70} max={70} step={1} suffix="°" onChange={(direction) => update({ ...draft, particles: { ...draft.particles, direction } })} /> : <RangeField label="Direction" value={draft.particles.direction} min={-180} max={180} step={1} suffix="°" onChange={(direction) => update({ ...draft, particles: { ...draft.particles, direction } })} />}{!isRain && <RangeField label="Spread" value={draft.particles.spread} min={0} max={180} step={1} suffix="°" onChange={(spread) => update({ ...draft, particles: { ...draft.particles, spread } })} />}<RangeField label="Randomness" value={draft.particles.randomness} min={0} max={100} step={1} suffix="%" onChange={(randomness) => update({ ...draft, particles: { ...draft.particles, randomness } })} /></div><input type="color" value={draft.particles.color} onChange={(event) => update({ ...draft, particles: { ...draft.particles, color: event.target.value } })} className="h-9 w-full rounded-lg bg-transparent" aria-label="Particle color" /></section>

            <section className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4"><SectionToggle label="Atmosphere" enabled={draft.atmosphere.enabled} onChange={(enabled) => update({ ...draft, atmosphere: { ...draft.atmosphere, enabled } })} /><select value={draft.atmosphere.type} onChange={(event) => update({ ...draft, atmosphere: { ...draft.atmosphere, type: event.target.value as StoryEffectConfig['atmosphere']['type'] } })} className="w-full rounded-xl border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-white"><option value="glow">Glow</option><option value="mist">Mist</option><option value="rays">Light Rays</option></select><div className="grid gap-2 sm:grid-cols-2"><RangeField label="Opacity" value={draft.atmosphere.opacity} min={0} max={1} step={0.05} onChange={(opacity) => update({ ...draft, atmosphere: { ...draft.atmosphere, opacity } })} /><RangeField label="Speed" value={draft.atmosphere.speed} min={0} max={3} step={0.05} onChange={(speed) => update({ ...draft, atmosphere: { ...draft.atmosphere, speed } })} /><RangeField label="Scale" value={draft.atmosphere.scale} min={0.5} max={3} step={0.05} onChange={(scale) => update({ ...draft, atmosphere: { ...draft.atmosphere, scale } })} /><RangeField label="Intensity" value={draft.atmosphere.intensity} min={0} max={100} step={1} suffix="%" onChange={(intensity) => update({ ...draft, atmosphere: { ...draft.atmosphere, intensity } })} /><RangeField label="Direction" value={draft.atmosphere.direction} min={-180} max={180} step={1} suffix="°" onChange={(direction) => update({ ...draft, atmosphere: { ...draft.atmosphere, direction } })} /></div><input type="color" value={draft.atmosphere.color} onChange={(event) => update({ ...draft, atmosphere: { ...draft.atmosphere, color: event.target.value } })} className="h-9 w-full rounded-lg bg-transparent" aria-label="Atmosphere color" /></section>
          </div>
        </div>

        {(message || error) && <p className={`border-t border-white/10 px-5 py-2 text-xs ${error ? 'text-rose-300' : 'text-emerald-300'}`}>{error || message}</p>}
        <footer className="flex flex-wrap justify-end gap-2 border-t border-white/10 px-5 py-4"><button type="button" disabled={isSaving} onClick={() => void run(async () => { if (!window.confirm(`Replace effects on all ${totalBeatCount} generated beats and branches?`)) return; const count = await onApplyAll(draft); setMessage(`Applied to ${count} beats.`); })} className="rounded-full border border-white/10 px-4 py-2 text-sm text-neutral-300 hover:bg-white/5">Apply to all {totalBeatCount}</button><button type="button" disabled={isSaving} onClick={onClose} className="rounded-full px-4 py-2 text-sm text-neutral-400">Cancel</button><button type="button" disabled={isSaving} onClick={() => void run(async () => { await onSave(draft); setMessage('Effects saved to this beat.'); })} className="inline-flex items-center gap-2 rounded-full bg-emerald-400 px-5 py-2 text-sm font-semibold text-neutral-950 disabled:opacity-50">{isSaving && <Loader2 className="h-4 w-4 animate-spin" />}Save beat</button></footer>
      </section>
    </div>
  );
}

