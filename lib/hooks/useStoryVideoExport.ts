'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BufferTarget, Mp4OutputFormat, Output } from 'mediabunny';

import { useVideoExport } from '@/lib/hooks/useVideoExport';
import { toMediaFetchUrl } from '@/lib/media/client';
import {
  buildStoryExportFrameSamples,
  buildStoryExportTimeline,
} from '@/lib/storyboard/export-timeline';
import {
  drawStoryExportFrame,
  loadStoryExportImageAssets,
  releaseStoryExportImageAssets,
  type StoryExportImageAssets,
} from '@/lib/storyboard/export-renderer';
import { isStoryboardBeat } from '@/lib/storyboard/beat';
import {
  cancelMediaBunnyOutput,
  createSilentAudioBuffer,
  downloadMp4,
  loadVerifiedMediaBunny,
  waitForVideoExportFonts,
} from '@/lib/video-export/mediabunny';
import {
  buildVideoExportReport,
  createStageTimer,
  logVideoExportReport,
  type VideoExportReport,
} from '@/lib/video-export/diagnostics';
import {
  DEFAULT_VIDEO_EXPORT_PRESET,
  normalizeVideoExportPreset,
  type VideoExportPreset,
} from '@/lib/types/pricing';
import type { StoryBeat } from '@/lib/types/story';
import type { StoryTransitionSettings } from '@/lib/story-transitions/settings';
import type { ExportPhase, VideoExportOptions, VideoExportState } from '@/lib/video-export/types';

const STORY_EXPORT_FPS = 24;
const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_CHANNELS = 2;

export type StoryExportEngine = 'fast' | 'compatibility';
export type StoryExportStage =
  | 'checking'
  | 'preparing'
  | 'rendering'
  | 'audio'
  | 'finalizing'
  | 'compatibility-loading'
  | 'compatibility-preparing'
  | 'compatibility-rendering'
  | 'compatibility-finalizing';

export interface StoryVideoExportOptions extends VideoExportOptions {
  cycleOverride: boolean;
  cycleMs: number;
  storyTextOverlayWordsPerLine?: number;
  storyTransition?: StoryTransitionSettings;
}

function getCanvasSize(options: StoryVideoExportOptions, preset: VideoExportPreset) {
  if (options.aspectRatio === '9:16') {
    const [width, height] = preset.verticalResolution.split('x').map((value) => Number.parseInt(value, 10));
    return { width, height };
  }
  return { width: 1280, height: 720 };
}

function idleState(error: string | null = null): VideoExportState {
  return { isExporting: false, progress: 0, phase: 'idle', error };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Fast story export could not be completed.';
}

async function decodeStoryAudio(context: AudioContext, url: string): Promise<AudioBuffer> {
  const response = await fetch(toMediaFetchUrl(url));
  if (!response.ok) throw new Error('Failed to load story narration audio.');
  return context.decodeAudioData(await response.arrayBuffer());
}

function sliceAudioBuffer(source: AudioBuffer, startMs: number, endMs: number): AudioBuffer {
  const startFrame = Math.max(0, Math.min(source.length - 1, Math.round(startMs * source.sampleRate / 1000)));
  const endFrame = Math.min(
    source.length,
    Math.max(startFrame + 1, Math.round(endMs * source.sampleRate / 1000))
  );
  const output = new AudioBuffer({
    numberOfChannels: source.numberOfChannels,
    length: Math.max(1, endFrame - startFrame),
    sampleRate: source.sampleRate,
  });
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    output.copyToChannel(source.getChannelData(channel).subarray(startFrame, endFrame), channel);
  }
  return output;
}

export function useStoryVideoExport() {
  const compatibility = useVideoExport();
  const exportCompatibility = compatibility.exportVideo;
  const cancelCompatibility = compatibility.cancel;
  const [state, setState] = useState<VideoExportState>(idleState());
  const [engine, setEngine] = useState<StoryExportEngine>('fast');
  const [stage, setStage] = useState<StoryExportStage>('checking');
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<VideoExportReport | null>(null);
  const cancelledRef = useRef(false);
  const activeOutputRef = useRef<Output<Mp4OutputFormat, BufferTarget> | null>(null);
  const activeAudioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!state.isExporting || engine !== 'fast') return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [engine, state.isExporting]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setState(idleState());
    void cancelMediaBunnyOutput(activeOutputRef.current);
    void activeAudioContextRef.current?.close().catch(() => undefined);
    cancelCompatibility();
  }, [cancelCompatibility]);

  const exportVideo = useCallback(async (
    beats: StoryBeat[],
    title: string,
    options: StoryVideoExportOptions
  ): Promise<boolean> => {
    const videoBeats = beats.filter((beat) => Boolean(beat.imageUrl));
    if (videoBeats.length === 0) {
      setState(idleState('No images found in this story.'));
      return false;
    }

    cancelledRef.current = false;
    setEngine('fast');
    setStage('checking');
    setFallbackReason(null);
    setDiagnostics(null);
    setState({ isExporting: true, progress: 0, phase: 'loading', error: null });
    const stageTimer = createStageTimer();

    const preset = normalizeVideoExportPreset(options.videoExportPreset ?? DEFAULT_VIDEO_EXPORT_PRESET);
    const canvasSize = getCanvasSize(options, preset);
    let audioContext: AudioContext | null = null;
    let output: Output<Mp4OutputFormat, BufferTarget> | null = null;
    let assets: StoryExportImageAssets | null = null;

    try {
      const exportAudioContext = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
      audioContext = exportAudioContext;
      activeAudioContextRef.current = exportAudioContext;
      const mediabunny = await loadVerifiedMediaBunny({
        ...canvasSize,
        fps: STORY_EXPORT_FPS,
        sampleRate: AUDIO_SAMPLE_RATE,
        channels: AUDIO_CHANNELS,
      });
      if (cancelledRef.current) return false;
      stageTimer.mark('check');

      setStage('preparing');
      setState({ isExporting: true, progress: 5, phase: 'preparing', error: null });
      await waitForVideoExportFonts();
      const decodedAudio = await Promise.all(videoBeats.map((beat) => (
        beat.audioUrl ? decodeStoryAudio(exportAudioContext, beat.audioUrl) : Promise.resolve(null)
      )));
      const preparedBeats = videoBeats.map((beat, index) => {
        const audio = decodedAudio[index];
        const fallbackPanelMs = options.cycleOverride ? Math.max(100, options.cycleMs) : 2500;
        const durationMs = audio
          ? audio.duration * 1000
          : isStoryboardBeat(beat)
            ? fallbackPanelMs * 4
            : fallbackPanelMs;
        return {
          beat,
          imageUrl: toMediaFetchUrl(beat.imageUrl!),
          durationMs,
          hasAudio: Boolean(audio),
        };
      });
      const timeline = buildStoryExportTimeline(
        preparedBeats,
        options.cycleOverride,
        options.cycleMs,
        options.storyTransition
      );
      assets = await loadStoryExportImageAssets(preparedBeats.map((beat) => beat.imageUrl));
      if (cancelledRef.current) return false;

      const canvas = document.createElement('canvas');
      canvas.width = canvasSize.width;
      canvas.height = canvasSize.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not create the story render surface.');

      const target = new mediabunny.BufferTarget();
      output = new mediabunny.Output({ format: new mediabunny.Mp4OutputFormat(), target });
      activeOutputRef.current = output;
      const videoSource = new mediabunny.CanvasSource(canvas, {
        codec: 'avc',
        bitrate: mediabunny.QUALITY_HIGH,
        keyFrameInterval: 2,
        latencyMode: 'quality',
      });
      const audioSource = new mediabunny.AudioBufferSource({
        codec: 'aac',
        bitrate: mediabunny.QUALITY_HIGH,
      });
      output.addVideoTrack(videoSource, { frameRate: STORY_EXPORT_FPS });
      output.addAudioTrack(audioSource);
      await output.start();
      stageTimer.mark('prepare');

      setStage('rendering');
      setState({ isExporting: true, progress: 12, phase: 'encoding', error: null });
      const samples = buildStoryExportFrameSamples(timeline, STORY_EXPORT_FPS);
      for (let index = 0; index < samples.length; index += 1) {
        if (cancelledRef.current) {
          await cancelMediaBunnyOutput(output);
          setState(idleState());
          return false;
        }
        const sample = samples[index];
        drawStoryExportFrame(context, timeline, assets, sample.timeMs, {
          watermark: options.showWatermark === true,
          watermarkPreset: preset,
          storyTextOverlayWordsPerLine: options.storyTextOverlayWordsPerLine,
        });
        await videoSource.add(
          sample.timeMs / 1000,
          sample.durationMs / 1000,
          index % (STORY_EXPORT_FPS * 2) === 0 ? { keyFrame: true } : undefined
        );
        if (index % 4 === 0 || index === samples.length - 1) {
          setState((current) => ({
            ...current,
            progress: Math.max(current.progress, 12 + Math.round(((index + 1) / samples.length) * 68)),
          }));
        }
      }

      stageTimer.mark('frames');
      setStage('audio');
      setState((current) => ({ ...current, progress: 82, phase: 'finalizing' }));
      for (let index = 0; index < timeline.scenes.length; index += 1) {
        if (cancelledRef.current) return false;
        const scene = timeline.scenes[index];
        const narrationDurationMs = scene.narrationEndMs - scene.narrationStartMs;
        const beatAudio = decodedAudio[scene.beatIndex];
        await audioSource.add(beatAudio
          ? sliceAudioBuffer(
              beatAudio,
              scene.narrationStartMs - scene.beatStartMs,
              scene.narrationEndMs - scene.beatStartMs
            )
          : createSilentAudioBuffer(narrationDurationMs, AUDIO_SAMPLE_RATE, AUDIO_CHANNELS));
        const transition = timeline.transitionTimeline.transitions.find((item) => item.fromIndex === index);
        if (transition) {
          await audioSource.add(createSilentAudioBuffer(
            transition.endMs - transition.startMs,
            AUDIO_SAMPLE_RATE,
            AUDIO_CHANNELS
          ));
        }
        setState((current) => ({
          ...current,
          progress: Math.max(current.progress, 82 + Math.round(((index + 1) / timeline.scenes.length) * 12)),
        }));
      }

      stageTimer.mark('audio');
      setStage('finalizing');
      await output.finalize();
      if (!target.buffer) throw new Error('The rendered story file is empty.');
      stageTimer.mark('finalize');
      const report = buildVideoExportReport({
        exportKind: 'story',
        engine: 'fast',
        canvasWidth: canvasSize.width,
        canvasHeight: canvasSize.height,
        fps: STORY_EXPORT_FPS,
        expectedDurationMs: timeline.totalDurationMs,
        samples,
        videoCodec: 'avc',
        audioCodec: 'aac',
        videoBitrate: 'quality-high',
        audioBitrate: 'quality-high',
        audioSampleRate: AUDIO_SAMPLE_RATE,
        audioChannels: AUDIO_CHANNELS,
        keyFrameIntervalSeconds: 2,
        fastStart: 'none',
        outputBytes: target.buffer.byteLength,
        startedAtIso: stageTimer.startedAtIso,
        ...stageTimer.finish(),
      });
      logVideoExportReport(report);
      setDiagnostics(report);
      setState((current) => ({ ...current, progress: 100, phase: 'finalizing' }));
      downloadMp4(target.buffer, title, 'story');
      setState(idleState());
      return true;
    } catch (error) {
      if (cancelledRef.current) {
        setState(idleState());
        return false;
      }
      await cancelMediaBunnyOutput(output);
      output = null;
      activeOutputRef.current = null;
      if (assets) {
        releaseStoryExportImageAssets(assets);
        assets = null;
      }
      await audioContext?.close().catch(() => undefined);
      activeAudioContextRef.current = null;
      const reason = describeError(error);
      console.warn('[useStoryVideoExport] Fast export failed; using compatibility export.', error);
      const requiresSharedRenderer = !['fast-cut', 'soft-fade', 'fade-black', 'opacity-blend'].includes(options.storyTransition?.type || 'fast-cut');
      if (requiresSharedRenderer) {
        setFallbackReason(reason);
        setState(idleState(`This transition requires the modern export engine. ${reason} Try the current Chrome, Edge, Firefox, or Safari release.`));
        return false;
      }
      setEngine('compatibility');
      setFallbackReason(reason);
      setStage('compatibility-loading');
      return exportCompatibility(beats, title, {
        ...options,
        exportKind: 'storyline',
      });
    } finally {
      await cancelMediaBunnyOutput(output);
      if (assets) releaseStoryExportImageAssets(assets);
      await audioContext?.close().catch(() => undefined);
      activeOutputRef.current = null;
      activeAudioContextRef.current = null;
    }
  }, [exportCompatibility]);

  const compatibilityStage: StoryExportStage = compatibility.phase === 'loading'
    ? 'compatibility-loading'
    : compatibility.phase === 'preparing'
      ? 'compatibility-preparing'
      : compatibility.phase === 'encoding'
        ? 'compatibility-rendering'
        : 'compatibility-finalizing';
  const activeState = engine === 'compatibility'
    ? {
        isExporting: compatibility.isExporting,
        progress: compatibility.progress,
        phase: compatibility.phase,
        error: compatibility.error,
      }
    : state;

  return {
    exportVideo,
    cancel,
    isExporting: activeState.isExporting,
    progress: activeState.progress,
    phase: activeState.phase as ExportPhase,
    error: activeState.error,
    engine,
    stage: engine === 'compatibility' ? compatibilityStage : stage,
    fallbackReason,
    diagnostics,
  };
}
