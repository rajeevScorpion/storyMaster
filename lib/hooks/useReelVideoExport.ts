'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import type { BufferTarget, Mp4OutputFormat, Output } from 'mediabunny';
import {
  DEFAULT_VIDEO_EXPORT_PRESET,
  normalizeVideoExportPreset,
  type VideoExportPreset,
} from '@/lib/types/pricing';
import type { StoryBeat } from '@/lib/types/story';
import type { ReelTextOverlayStyle } from '@/lib/reel/styles';
import type { ReelTransitionSettings } from '@/lib/reel/transitions';
import { toReelFetchUrl } from '@/lib/reel/media';
import { buildReelFrameSamples, buildReelTimeline, REEL_FINAL_HOLD_MS } from '@/lib/reel/timeline';
import {
  drawReelFrame,
  loadReelImageAssets,
  releaseReelImageAssets,
  type ReelImageAssets,
} from '@/lib/reel/renderer';
import {
  type ExportPhase,
  type VideoExportOptions,
  type VideoExportState,
} from '@/lib/hooks/useVideoExport';

const REEL_FPS = 24;
const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_CHANNELS = 2;
const AUDIO_BITRATE = '96k';
const EXPORT_IMAGE_QUALITY = 0.92;

let reelFallbackFfmpegInstance: FFmpeg | null = null;
const verifiedMediabunnyConfigs = new Set<string>();

export type ReelExportEngine = 'fast' | 'compatibility';
export type ReelExportStage =
  | 'checking'
  | 'preparing'
  | 'rendering'
  | 'audio'
  | 'finalizing'
  | 'compatibility-loading'
  | 'compatibility-preparing'
  | 'compatibility-rendering'
  | 'compatibility-finalizing';

export interface ReelVideoExportOptions extends Omit<VideoExportOptions, 'exportKind'> {
  textOverlayEnabled?: boolean;
  textOverlayStyle?: ReelTextOverlayStyle;
  transitionSettings: ReelTransitionSettings;
  vignetteEnabled?: boolean;
  vignetteAmountPercent?: number;
}

function getReelCanvasSize(preset: VideoExportPreset) {
  const [width, height] = preset.verticalResolution
    .split('x')
    .map((value) => Number.parseInt(value, 10));
  return { width, height };
}

async function getReelFallbackFfmpeg(): Promise<FFmpeg> {
  if (reelFallbackFfmpegInstance) return reelFallbackFfmpegInstance;
  const assetBaseURL = new URL('/ffmpeg/', window.location.origin);
  const ffmpeg = new FFmpeg();
  await ffmpeg.load({
    classWorkerURL: new URL('ffmpeg-worker.js', assetBaseURL).href,
    coreURL: new URL('ffmpeg-core.js', assetBaseURL).href,
    wasmURL: new URL('ffmpeg-core.wasm', assetBaseURL).href,
  });
  reelFallbackFfmpegInstance = ffmpeg;
  return ffmpeg;
}

async function waitForExportFonts(): Promise<void> {
  if (!document.fonts?.ready) return;
  await document.fonts.ready.catch(() => undefined);
}

async function decodeAudioBuffer(context: AudioContext, url: string): Promise<AudioBuffer> {
  const response = await fetch(toReelFetchUrl(url));
  if (!response.ok) throw new Error('Failed to load reel narration audio.');
  return context.decodeAudioData(await response.arrayBuffer());
}

async function buildReelSoundtrack(audioBuffers: AudioBuffer[]): Promise<AudioBuffer> {
  const audioDurationSeconds = audioBuffers.reduce((sum, audioBuffer) => sum + audioBuffer.duration, 0);
  const totalDurationSeconds = audioDurationSeconds + REEL_FINAL_HOLD_MS / 1000;
  const frameCount = Math.max(1, Math.ceil(totalDurationSeconds * AUDIO_SAMPLE_RATE));
  const offlineContext = new OfflineAudioContext(AUDIO_CHANNELS, frameCount, AUDIO_SAMPLE_RATE);
  let cursorSeconds = 0;

  audioBuffers.forEach((audioBuffer) => {
    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start(cursorSeconds);
    cursorSeconds += audioBuffer.duration;
  });

  return offlineContext.startRendering();
}

function describeExportError(error: unknown): string {
  return error instanceof Error ? error.message : 'The fast video encoder could not complete this export.';
}

function logExportTiming(stage: string, startedAt: number, details: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === 'production') return;
  console.info(`[timing:reel_export.${stage}]`, {
    durationMs: Math.round(performance.now() - startedAt),
    ...details,
  });
}

async function verifyMediabunnyOutput(
  mediabunny: typeof import('mediabunny'),
  canvasSize: { width: number; height: number }
): Promise<void> {
  const configKey = `${canvasSize.width}x${canvasSize.height}:avc-aac:${AUDIO_CHANNELS}:${AUDIO_SAMPLE_RATE}`;
  if (verifiedMediabunnyConfigs.has(configKey)) return;

  const canvas = document.createElement('canvas');
  canvas.width = canvasSize.width;
  canvas.height = canvasSize.height;
  const target = new mediabunny.BufferTarget();
  const output = new mediabunny.Output({ format: new mediabunny.Mp4OutputFormat(), target });
  const videoSource = new mediabunny.CanvasSource(canvas, {
    codec: 'avc',
    bitrate: mediabunny.QUALITY_HIGH,
    latencyMode: 'quality',
  });
  const audioSource = new mediabunny.AudioBufferSource({
    codec: 'aac',
    bitrate: mediabunny.QUALITY_HIGH,
  });
  const probeAudio = new AudioBuffer({
    numberOfChannels: AUDIO_CHANNELS,
    length: Math.ceil(AUDIO_SAMPLE_RATE * 0.05),
    sampleRate: AUDIO_SAMPLE_RATE,
  });
  output.addVideoTrack(videoSource, { frameRate: REEL_FPS });
  output.addAudioTrack(audioSource);

  try {
    await output.start();
    await videoSource.add(0, 0.05, { keyFrame: true });
    await audioSource.add(probeAudio);
    await output.finalize();
    if (!target.buffer?.byteLength) throw new Error('Fast export produced an empty MP4.');
    verifiedMediabunnyConfigs.add(configKey);
  } finally {
    if (output.state !== 'finalized' && output.state !== 'canceled') {
      await output.cancel().catch(() => undefined);
    }
  }
}

function triggerVideoDownload(buffer: BlobPart, title: string) {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'video/mp4' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'reel'}.mp4`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function canvasToJpegBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('Failed to prepare a reel video frame.'));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/jpeg', EXPORT_IMAGE_QUALITY);
  });
}

function idleState(error: string | null = null): VideoExportState {
  return { isExporting: false, progress: 0, phase: 'idle', error };
}

export function useReelVideoExport() {
  const [state, setState] = useState<VideoExportState>(idleState());
  const [engine, setEngine] = useState<ReelExportEngine>('fast');
  const [stage, setStage] = useState<ReelExportStage>('checking');
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const activeOutputRef = useRef<Output<Mp4OutputFormat, BufferTarget> | null>(null);
  const activeFfmpegRef = useRef<FFmpeg | null>(null);
  const activeAudioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!state.isExporting) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [state.isExporting]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (activeFfmpegRef.current) {
      activeFfmpegRef.current.terminate();
      if (activeFfmpegRef.current === reelFallbackFfmpegInstance) {
        reelFallbackFfmpegInstance = null;
      }
      activeFfmpegRef.current = null;
    }
    void activeOutputRef.current?.cancel().catch(() => undefined);
    void activeAudioContextRef.current?.close().catch(() => undefined);
  }, []);

  const exportWithFfmpeg = useCallback(async (
    beats: StoryBeat[],
    title: string,
    options: ReelVideoExportOptions,
    videoExportPreset: VideoExportPreset
  ): Promise<boolean> => {
    if (typeof SharedArrayBuffer === 'undefined') {
      setState(idleState('Video export is not supported in this browser. Try Chrome or Edge.'));
      return false;
    }

    const audioContext = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
    const videoBeats = beats.filter((beat) => Boolean(beat.imageUrl && beat.audioUrl));
    const frameFiles: string[] = [];
    const audioFiles: string[] = [];
    let assets: ReelImageAssets | null = null;
    let ffmpeg: FFmpeg | null = null;
    let handleProgress: ((event: { progress: number }) => void) | null = null;
    const fallbackStartedAt = performance.now();

    try {
      setStage('compatibility-loading');
      setState({ isExporting: true, progress: 2, phase: 'loading', error: null });
      ffmpeg = await getReelFallbackFfmpeg();
      activeFfmpegRef.current = ffmpeg;
      activeAudioContextRef.current = audioContext;
      await waitForExportFonts();
      const audioBuffers = await Promise.all(videoBeats.map((beat) => decodeAudioBuffer(audioContext, beat.audioUrl!)));
      const preparedBeats = videoBeats.map((beat, index) => ({
        beat,
        imageUrl: toReelFetchUrl(beat.imageUrl!),
        durationMs: audioBuffers[index].duration * 1000,
      }));
      assets = await loadReelImageAssets(preparedBeats.map((beat) => beat.imageUrl));
      const timeline = buildReelTimeline(preparedBeats, options.transitionSettings, REEL_FINAL_HOLD_MS);
      const canvasSize = getReelCanvasSize(videoExportPreset);
      const canvas = document.createElement('canvas');
      canvas.width = canvasSize.width;
      canvas.height = canvasSize.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not create the reel render surface.');

      logExportTiming('compatibility.prepare', fallbackStartedAt, { beatCount: videoBeats.length });
      const renderingStartedAt = performance.now();
      setStage('compatibility-preparing');
      setState({ isExporting: true, progress: 12, phase: 'preparing', error: null });
      const frameSamples = buildReelFrameSamples(timeline, REEL_FPS);
      for (let frameIndex = 0; frameIndex < frameSamples.length; frameIndex += 1) {
        if (cancelledRef.current) {
          setState(idleState());
          return false;
        }
        const sample = frameSamples[frameIndex];
        drawReelFrame(context, timeline, assets, sample.timeMs, {
          textOverlayEnabled: options.textOverlayEnabled,
          textOverlayStyle: options.textOverlayStyle,
          vignetteEnabled: options.vignetteEnabled,
          vignetteAmountPercent: options.vignetteAmountPercent,
          watermark: options.showWatermark === true,
          watermarkPreset: videoExportPreset,
        });
        const frameFile = `reel_frame_${String(frameIndex).padStart(6, '0')}.jpg`;
        await ffmpeg.writeFile(frameFile, await canvasToJpegBytes(canvas));
        frameFiles.push(frameFile);
        if (frameIndex % 4 === 0 || frameIndex === frameSamples.length - 1) {
          setState((current) => ({
            ...current,
            progress: Math.max(current.progress, 12 + Math.round(((frameIndex + 1) / frameSamples.length) * 33)),
          }));
        }
      }
      const frameManifestFile = 'reel_frames.txt';
      const frameManifest = frameSamples.map((sample, index) => (
        `file '${frameFiles[index]}'\nduration ${(sample.durationMs / 1000).toFixed(6)}`
      )).join('\n') + `\nfile '${frameFiles[frameFiles.length - 1]}'\n`;
      await ffmpeg.writeFile(frameManifestFile, new TextEncoder().encode(frameManifest));
      logExportTiming('compatibility.frames', renderingStartedAt, { frameCount: frameSamples.length });

      for (let index = 0; index < videoBeats.length; index += 1) {
        const audioFile = `reel_audio_${index}.bin`;
        await ffmpeg.writeFile(audioFile, await fetchFile(toReelFetchUrl(videoBeats[index].audioUrl!)));
        audioFiles.push(audioFile);
      }

      const audioInputArgs = audioFiles.flatMap((audioFile) => ['-i', audioFile]);
      const audioFilters = audioFiles.map((_, index) => (
        `[${index + 1}:a]aresample=${AUDIO_SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo[a${index}]`
      ));
      const silenceIndex = audioFiles.length + 1;
      const audioLabels = audioFiles.map((_, index) => `[a${index}]`).join('');
      const filterComplex = [
        ...audioFilters,
        `${audioLabels}[${silenceIndex}:a]concat=n=${audioFiles.length + 1}:v=0:a=1[outa]`,
      ].join(';');
      const outputFile = 'reel_rendered_output.mp4';
      handleProgress = ({ progress }) => {
        setState((current) => ({
          ...current,
          phase: 'encoding',
          progress: Math.max(current.progress, 45 + Math.round(Math.max(0, Math.min(1, progress)) * 43)),
        }));
      };
      ffmpeg.on('progress', handleProgress);
      const encodingStartedAt = performance.now();
      setStage('compatibility-rendering');
      setState((current) => ({ ...current, progress: 45, phase: 'encoding' }));
      const exitCode = await ffmpeg.exec([
        '-f', 'concat',
        '-safe', '0',
        '-i', frameManifestFile,
        ...audioInputArgs,
        '-f', 'lavfi',
        '-t', String(REEL_FINAL_HOLD_MS / 1000),
        '-i', `anullsrc=r=${AUDIO_SAMPLE_RATE}:cl=stereo`,
        '-filter_complex', filterComplex,
        '-map', '0:v',
        '-map', '[outa]',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-r', String(REEL_FPS),
        '-c:a', 'aac',
        '-b:a', AUDIO_BITRATE,
        '-shortest',
        outputFile,
      ]);
      if (exitCode !== 0) throw new Error(`Fallback reel export failed (ffmpeg exit code ${exitCode}).`);

      logExportTiming('compatibility.encode', encodingStartedAt);
      setStage('compatibility-finalizing');
      setState((current) => ({ ...current, progress: 92, phase: 'finalizing' }));
      const outputData = await ffmpeg.readFile(outputFile);
      const bytes = outputData instanceof Uint8Array
        ? outputData.slice()
        : new TextEncoder().encode(outputData as string);
      triggerVideoDownload(bytes, title);
      await ffmpeg.deleteFile(outputFile).catch(() => undefined);
      logExportTiming('compatibility.total', fallbackStartedAt, { frameCount: frameSamples.length });
      setState(idleState());
      return true;
    } catch (error) {
      if (cancelledRef.current) {
        setState(idleState());
        return false;
      }
      const message = error instanceof Error ? error.message : 'Failed to export reel video.';
      setState(idleState(message));
      return false;
    } finally {
      if (ffmpeg && handleProgress) ffmpeg.off('progress', handleProgress);
      if (ffmpeg) {
        for (const file of [...frameFiles, ...audioFiles, 'reel_frames.txt', 'reel_rendered_output.mp4']) {
          await ffmpeg.deleteFile(file).catch(() => undefined);
        }
      }
      if (assets) releaseReelImageAssets(assets);
      await audioContext.close().catch(() => undefined);
      activeAudioContextRef.current = null;
      activeFfmpegRef.current = null;
    }
  }, []);

  const exportVideo = useCallback(async (
    beats: StoryBeat[],
    title: string,
    options: ReelVideoExportOptions
  ): Promise<boolean> => {
    const videoBeats = beats.filter((beat) => Boolean(beat.imageUrl && beat.audioUrl));
    if (videoBeats.length === 0) {
      setState(idleState('No completed reel beats found for export.'));
      return false;
    }

    const videoExportPreset = normalizeVideoExportPreset(
      options.videoExportPreset ?? DEFAULT_VIDEO_EXPORT_PRESET
    );
    const canvasSize = getReelCanvasSize(videoExportPreset);
    const audioContext = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
    let assets: ReelImageAssets | null = null;
    let output: Output<Mp4OutputFormat, BufferTarget> | null = null;
    const fastExportStartedAt = performance.now();

    cancelledRef.current = false;
    setEngine('fast');
    setStage('checking');
    setFallbackReason(null);
    setState({ isExporting: true, progress: 0, phase: 'loading', error: null });

    try {
      const mediabunny = await import('mediabunny');
      const {
        AudioBufferSource,
        BufferTarget: MediabunnyBufferTarget,
        CanvasSource,
        Mp4OutputFormat: MediabunnyMp4OutputFormat,
        Output: MediabunnyOutput,
        QUALITY_HIGH,
        canEncodeAudio,
        canEncodeVideo,
      } = mediabunny;
      const canEncodeAvc = await canEncodeVideo('avc', {
        width: canvasSize.width,
        height: canvasSize.height,
        bitrate: QUALITY_HIGH,
      });
      if (!canEncodeAvc) throw new Error('Native AVC video encoding is unavailable.');

      if (!(await canEncodeAudio('aac', {
        numberOfChannels: AUDIO_CHANNELS,
        sampleRate: AUDIO_SAMPLE_RATE,
        bitrate: QUALITY_HIGH,
      }))) {
        const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
        registerAacEncoder();
      }

      const preflightStartedAt = performance.now();
      await verifyMediabunnyOutput(mediabunny, canvasSize);
      logExportTiming('fast.preflight', preflightStartedAt);

      const preparationStartedAt = performance.now();
      setStage('preparing');
      setState({ isExporting: true, progress: 5, phase: 'preparing', error: null });
      activeAudioContextRef.current = audioContext;
      await waitForExportFonts();
      const audioBuffers = await Promise.all(videoBeats.map((beat) => decodeAudioBuffer(audioContext, beat.audioUrl!)));
      const soundtrack = await buildReelSoundtrack(audioBuffers);
      if (cancelledRef.current) return false;

      const preparedBeats = videoBeats.map((beat, index) => ({
        beat,
        imageUrl: toReelFetchUrl(beat.imageUrl!),
        durationMs: audioBuffers[index].duration * 1000,
      }));
      assets = await loadReelImageAssets(preparedBeats.map((beat) => beat.imageUrl));
      const timeline = buildReelTimeline(preparedBeats, options.transitionSettings, REEL_FINAL_HOLD_MS);
      logExportTiming('fast.prepare', preparationStartedAt, { beatCount: videoBeats.length });
      const canvas = document.createElement('canvas');
      canvas.width = canvasSize.width;
      canvas.height = canvasSize.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not create the reel render surface.');

      const target = new MediabunnyBufferTarget();
      output = new MediabunnyOutput({ format: new MediabunnyMp4OutputFormat(), target });
      activeOutputRef.current = output;
      const videoSource = new CanvasSource(canvas, {
        codec: 'avc',
        bitrate: QUALITY_HIGH,
        keyFrameInterval: 2,
        latencyMode: 'quality',
      });
      const audioSource = new AudioBufferSource({
        codec: 'aac',
        bitrate: QUALITY_HIGH,
      });
      output.addVideoTrack(videoSource, { frameRate: REEL_FPS });
      output.addAudioTrack(audioSource);
      await output.start();

      const renderingStartedAt = performance.now();
      setStage('rendering');
      setState({ isExporting: true, progress: 12, phase: 'encoding', error: null });
      const frameSamples = buildReelFrameSamples(timeline, REEL_FPS);
      for (let frameIndex = 0; frameIndex < frameSamples.length; frameIndex += 1) {
        if (cancelledRef.current) {
          await output.cancel();
          setState(idleState());
          return false;
        }
        const sample = frameSamples[frameIndex];
        drawReelFrame(context, timeline, assets, sample.timeMs, {
          textOverlayEnabled: options.textOverlayEnabled,
          textOverlayStyle: options.textOverlayStyle,
          vignetteEnabled: options.vignetteEnabled,
          vignetteAmountPercent: options.vignetteAmountPercent,
          watermark: options.showWatermark === true,
          watermarkPreset: videoExportPreset,
        });
        await videoSource.add(
          sample.timeMs / 1000,
          sample.durationMs / 1000,
          frameIndex % (REEL_FPS * 2) === 0 ? { keyFrame: true } : undefined
        );
        if (frameIndex % 4 === 0 || frameIndex === frameSamples.length - 1) {
          setState((current) => ({
            ...current,
            progress: Math.max(current.progress, 12 + Math.round(((frameIndex + 1) / frameSamples.length) * 74)),
          }));
        }
      }

      logExportTiming('fast.frames', renderingStartedAt, { frameCount: frameSamples.length });
      const audioStartedAt = performance.now();
      setStage('audio');
      setState((current) => ({ ...current, progress: 88, phase: 'finalizing' }));
      await audioSource.add(soundtrack);
      logExportTiming('fast.audio', audioStartedAt, {
        channels: soundtrack.numberOfChannels,
        sampleRate: soundtrack.sampleRate,
      });
      const finalizeStartedAt = performance.now();
      setStage('finalizing');
      await output.finalize();
      logExportTiming('fast.finalize', finalizeStartedAt);

      if (cancelledRef.current) {
        setState(idleState());
        return false;
      }
      if (!target.buffer) throw new Error('The rendered reel file is empty.');
      setState((current) => ({ ...current, progress: 100, phase: 'finalizing' }));
      triggerVideoDownload(target.buffer, title);
      logExportTiming('fast.total', fastExportStartedAt, { frameCount: frameSamples.length });
      setState(idleState());
      return true;
    } catch (error) {
      console.warn('[useReelVideoExport] Mediabunny export failed; falling back to ffmpeg.', error);
      if (cancelledRef.current) {
        setState(idleState());
        return false;
      }
      if (output && output.state !== 'finalized' && output.state !== 'canceled') {
        await output.cancel().catch(() => undefined);
        output = null;
        activeOutputRef.current = null;
      }
      if (assets) {
        releaseReelImageAssets(assets);
        assets = null;
      }
      await audioContext.close().catch(() => undefined);
      activeAudioContextRef.current = null;
      const reason = describeExportError(error);
      setEngine('compatibility');
      setFallbackReason(reason);
      logExportTiming('fast.fallback', fastExportStartedAt, { reason });
      return exportWithFfmpeg(beats, title, options, videoExportPreset);
    } finally {
      if (output && output.state !== 'finalized' && output.state !== 'canceled') {
        await output.cancel().catch(() => undefined);
      }
      if (assets) releaseReelImageAssets(assets);
      await audioContext.close().catch(() => undefined);
      activeAudioContextRef.current = null;
      activeOutputRef.current = null;
    }
  }, [exportWithFfmpeg]);

  return {
    exportVideo,
    cancel,
    isExporting: state.isExporting,
    progress: state.progress,
    phase: state.phase as ExportPhase,
    error: state.error,
    engine,
    stage,
    fallbackReason,
  };
}
