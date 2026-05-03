'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { STORYBOARD_ADVANCE_MS } from '@/lib/constants/media';
import { DEFAULT_VIDEO_EXPORT_PRESET, normalizeVideoExportPreset, type VideoExportPreset } from '@/lib/types/pricing';
import type { StoryAspectRatio, StoryBeat } from '@/lib/types/story';
import { STORYBOARD_PANEL_CROP_INSET_RATIO } from '@/lib/storyboard/layout';

let ffmpegInstance: FFmpeg | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;

  const assetBaseURL = new URL('/ffmpeg/', window.location.origin);
  const classWorkerURL = new URL('ffmpeg-worker.js', assetBaseURL).href;
  const coreURL = new URL('ffmpeg-core.js', assetBaseURL).href;
  const wasmURL = new URL('ffmpeg-core.wasm', assetBaseURL).href;

  const ffmpeg = new FFmpeg();

  ffmpeg.on('log', ({ message }) => {
    console.log('[ffmpeg]', message);
  });

  await ffmpeg.load({ classWorkerURL, coreURL, wasmURL });

  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

function probeAudioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const cleanup = () => {
      audio.src = '';
    };

    audio.addEventListener('loadedmetadata', () => {
      const duration = audio.duration;
      cleanup();
      resolve(Number.isFinite(duration) && duration > 0 ? duration : 0);
    });

    audio.addEventListener('error', () => {
      cleanup();
      resolve(0);
    });

    audio.src = url;
  });
}

const FADE_DURATION = 0.6;
const LANDSCAPE_OUTPUT_WIDTH = 1280;
const LANDSCAPE_OUTPUT_HEIGHT = 720;
const FPS = 24;
const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_CHANNELS = 2;
const AUDIO_BITRATE = '96k';
const EXPORT_IMAGE_QUALITY = 0.92;

type ExportCanvasSize = {
  width: number;
  height: number;
};

type BeatSegment = {
  index: number;
  imageUrl: string;
  audioUrl: string | null;
  isStoryboard: boolean;
  panelDuration: number;
  totalDuration: number;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getExportCanvasSize(
  aspectRatio: StoryAspectRatio,
  videoExportPreset: VideoExportPreset
): ExportCanvasSize {
  if (aspectRatio === '9:16') {
    const [width, height] = videoExportPreset.verticalResolution
      .split('x')
      .map((value) => Number.parseInt(value, 10));

    return { width, height };
  }

  return {
    width: LANDSCAPE_OUTPUT_WIDTH,
    height: LANDSCAPE_OUTPUT_HEIGHT,
  };
}

function getWatermarkOffset(canvasSize: ExportCanvasSize): number {
  return Math.max(18, Math.round(Math.min(canvasSize.width, canvasSize.height) * 0.035));
}

function getWatermarkMetrics(canvasSize: ExportCanvasSize, videoExportPreset: VideoExportPreset) {
  const shortEdge = Math.min(canvasSize.width, canvasSize.height);
  const heightMultiplier = videoExportPreset.watermarkSize === 'small'
    ? 0.031
    : videoExportPreset.watermarkSize === 'large'
      ? 0.043
      : 0.037;
  const pillHeight = Math.max(18, Math.round(shortEdge * heightMultiplier));
  const fontSize = Math.max(10, Math.round(pillHeight * 0.54));
  const horizontalPadding = Math.max(8, Math.round(pillHeight * 0.58));
  const borderWidth = Math.max(1, pillHeight * 0.045);
  const offset = getWatermarkOffset(canvasSize);

  return {
    pillHeight,
    fontSize,
    horizontalPadding,
    borderWidth,
    offset,
  };
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function drawWatermark(
  context: CanvasRenderingContext2D,
  canvasSize: ExportCanvasSize,
  videoExportPreset: VideoExportPreset
) {
  const fontFamily = '"Georgia", "Times New Roman", serif';
  const text = 'kissago';
  const metrics = getWatermarkMetrics(canvasSize, videoExportPreset);

  context.save();
  context.font = `600 ${metrics.fontSize}px ${fontFamily}`;
  const textWidth = context.measureText(text).width;
  const pillWidth = Math.ceil(textWidth + metrics.horizontalPadding * 2);
  const x = videoExportPreset.watermarkPosition === 'top-right'
    ? canvasSize.width - pillWidth - metrics.offset
    : metrics.offset;
  const y = metrics.offset;

  context.fillStyle = 'rgba(255, 255, 255, 0.06)';
  context.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  context.lineWidth = metrics.borderWidth;
  drawRoundedRect(context, x, y, pillWidth, metrics.pillHeight, metrics.pillHeight / 2);
  context.fill();
  context.stroke();

  context.font = `600 ${metrics.fontSize}px ${fontFamily}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.shadowColor = 'transparent';
  context.shadowBlur = 0;
  context.fillStyle = 'rgba(255, 255, 255, 0.5)';
  context.fillText(text, x + pillWidth / 2, y + metrics.pillHeight / 2 + metrics.pillHeight * 0.03);
  context.restore();
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return fetch(url)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error('Failed to fetch story image for export.');
      }
      return response.blob();
    })
    .then((blob) => new Promise<HTMLImageElement>((resolve, reject) => {
      const objectUrl = URL.createObjectURL(blob);
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to load story image for export.'));
      };
      image.src = objectUrl;
    }));
}

function createExportCanvas(canvasSize: ExportCanvasSize): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvasSize.width;
  canvas.height = canvasSize.height;
  return canvas;
}

function drawContainedImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  canvasSize: ExportCanvasSize
) {
  context.fillStyle = '#000000';
  context.fillRect(0, 0, canvasSize.width, canvasSize.height);

  const scale = Math.min(
    canvasSize.width / image.naturalWidth,
    canvasSize.height / image.naturalHeight
  );
  const drawWidth = Math.round(image.naturalWidth * scale);
  const drawHeight = Math.round(image.naturalHeight * scale);
  const dx = Math.round((canvasSize.width - drawWidth) / 2);
  const dy = Math.round((canvasSize.height - drawHeight) / 2);

  context.drawImage(image, dx, dy, drawWidth, drawHeight);
}

function drawStoryboardPanel(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  panelIndex: number,
  canvasSize: ExportCanvasSize
) {
  const col = panelIndex % 2;
  const row = panelIndex >= 2 ? 1 : 0;
  const cropScale = 0.5 - STORYBOARD_PANEL_CROP_INSET_RATIO;
  const xFactor = col * 0.5 + STORYBOARD_PANEL_CROP_INSET_RATIO / 2;
  const yFactor = row * 0.5 + STORYBOARD_PANEL_CROP_INSET_RATIO / 2;
  const sourceWidth = image.naturalWidth * cropScale;
  const sourceHeight = image.naturalHeight * cropScale;
  const sourceX = image.naturalWidth * xFactor;
  const sourceY = image.naturalHeight * yFactor;

  context.fillStyle = '#000000';
  context.fillRect(0, 0, canvasSize.width, canvasSize.height);
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvasSize.width,
    canvasSize.height
  );
}

async function canvasToJpegBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) {
        resolve(value);
        return;
      }

      reject(new Error('Failed to encode export image.'));
    }, 'image/jpeg', EXPORT_IMAGE_QUALITY);
  });

  return new Uint8Array(await blob.arrayBuffer());
}

async function renderBeatFrameBytes(
  imageUrl: string,
  canvasSize: ExportCanvasSize,
  videoExportPreset: VideoExportPreset,
  showWatermark: boolean
): Promise<Uint8Array> {
  const image = await loadImage(imageUrl);
  const canvas = createExportCanvas(canvasSize);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to prepare export canvas.');
  }

  drawContainedImage(context, image, canvasSize);
  if (showWatermark) {
    drawWatermark(context, canvasSize, videoExportPreset);
  }

  return canvasToJpegBytes(canvas);
}

async function renderStoryboardPanelBytes(
  image: HTMLImageElement,
  panelIndex: number,
  canvasSize: ExportCanvasSize,
  videoExportPreset: VideoExportPreset,
  showWatermark: boolean
): Promise<Uint8Array> {
  const canvas = createExportCanvas(canvasSize);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to prepare storyboard export canvas.');
  }

  drawStoryboardPanel(context, image, panelIndex, canvasSize);
  if (showWatermark) {
    drawWatermark(context, canvasSize, videoExportPreset);
  }

  return canvasToJpegBytes(canvas);
}

export type ExportPhase = 'idle' | 'loading' | 'preparing' | 'encoding' | 'finalizing';

export interface VideoExportState {
  isExporting: boolean;
  progress: number;
  phase: ExportPhase;
  error: string | null;
}

export interface VideoExportOptions {
  aspectRatio?: StoryAspectRatio;
  videoExportPreset?: VideoExportPreset | null;
  showWatermark?: boolean;
}

export function useVideoExport() {
  const [state, setState] = useState<VideoExportState>({
    isExporting: false,
    progress: 0,
    phase: 'idle',
    error: null,
  });
  const cancelledRef = useRef(false);
  const activeFfmpegRef = useRef<FFmpeg | null>(null);

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
    activeFfmpegRef.current?.terminate();
    if (ffmpegInstance === activeFfmpegRef.current) {
      ffmpegInstance = null;
    }
    activeFfmpegRef.current = null;
  }, []);

  const exportVideo = useCallback(
    async (beats: StoryBeat[], storyTitle: string, options: VideoExportOptions = {}): Promise<boolean> => {
      const videoBeats = beats.filter((beat) => Boolean(beat.imageUrl));
      if (videoBeats.length === 0) {
        setState((current) => ({ ...current, error: 'No images found in this story.' }));
        return false;
      }

      const aspectRatio: StoryAspectRatio = options.aspectRatio === '9:16' ? '9:16' : '16:9';
      const videoExportPreset = normalizeVideoExportPreset(options.videoExportPreset ?? DEFAULT_VIDEO_EXPORT_PRESET);
      const canvasSize = getExportCanvasSize(aspectRatio, videoExportPreset);
      const showWatermark = options.showWatermark === true;

      cancelledRef.current = false;
      setState({ isExporting: true, progress: 0, phase: 'loading', error: null });

      if (typeof SharedArrayBuffer === 'undefined') {
        setState({
          isExporting: false,
          progress: 0,
          phase: 'idle',
          error: 'Video export is not supported in this browser. Try Chrome or Edge.',
        });
        return false;
      }

      let ffmpeg: Awaited<ReturnType<typeof getFFmpeg>>;
      try {
        ffmpeg = await getFFmpeg();
        activeFfmpegRef.current = ffmpeg;
      } catch (error) {
        ffmpegInstance = null;
        const message = error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
        console.error('[useVideoExport] FFmpeg load failed:', error);
        setState({ isExporting: false, progress: 0, phase: 'idle', error: `Failed to load video encoder: ${message}` });
        return false;
      }

      if (cancelledRef.current) {
        setState({ isExporting: false, progress: 0, phase: 'idle', error: null });
        return false;
      }

      setState((current) => ({ ...current, phase: 'preparing', progress: 5 }));

      const segments: BeatSegment[] = await Promise.all(
        videoBeats.map(async (beat, index) => {
          const audioDuration = beat.audioUrl ? await probeAudioDuration(beat.audioUrl) : 0;
          const isStoryboard = beat.isStoryboard === true;
          const fallbackSeconds = STORYBOARD_ADVANCE_MS / 1000;
          const panelDuration = audioDuration > 0
            ? (isStoryboard ? audioDuration / 4 : audioDuration)
            : fallbackSeconds;

          return {
            index,
            imageUrl: beat.imageUrl!,
            audioUrl: beat.audioUrl ?? null,
            isStoryboard,
            panelDuration,
            totalDuration: isStoryboard ? panelDuration * 4 : panelDuration,
          };
        })
      );

      setState((current) => ({ ...current, phase: 'encoding', progress: 10 }));

      const segmentFiles: string[] = [];
      const transientFilePatterns = [/^seg_\d+\.mp4$/, /^img_\d+(_\d+)?\.jpg$/, /^aud_\d+\.wav$/];
      let currentSegmentIndex = 0;

      const handleEncodingProgress = ({ progress }: { progress: number }) => {
        const normalizedProgress = clamp01(progress);
        const completedFraction = (currentSegmentIndex + normalizedProgress) / Math.max(segments.length, 1);
        setState((current) => ({
          ...current,
          progress: 10 + Math.round(completedFraction * 75),
        }));
      };

      ffmpeg.on('progress', handleEncodingProgress);

      try {
        for (let index = 0; index < segments.length; index += 1) {
          const segment = segments[index];
          currentSegmentIndex = index;
          const audioFile = segment.audioUrl ? `aud_${index}.wav` : null;
          const outputFile = `seg_${index}.mp4`;

          if (cancelledRef.current) {
            for (const file of segmentFiles) {
              try {
                await ffmpeg.deleteFile(file);
              } catch {
                // ignore
              }
            }
            setState({ isExporting: false, progress: 0, phase: 'idle', error: null });
            return false;
          }

          if (segment.audioUrl && audioFile) {
            await ffmpeg.writeFile(audioFile, await fetchFile(segment.audioUrl));
          }

          const fade = Math.max(0, Math.min(FADE_DURATION, segment.panelDuration / 2 - 0.01));
          const withFade = (inputLabel: string, outputLabel: string, duration: number) => {
            const fadeFilter = fade > 0
              ? `,fade=t=in:d=${fade.toFixed(3)},fade=t=out:st=${(duration - fade).toFixed(3)}:d=${fade.toFixed(3)}`
              : '';
            return `[${inputLabel}]format=yuv420p,setsar=1${fadeFilter}[${outputLabel}]`;
          };

          const args: string[] = [];
          const durationSeconds = segment.isStoryboard ? segment.totalDuration : segment.panelDuration;

          if (segment.isStoryboard) {
            const storyboardImage = await loadImage(segment.imageUrl);
            const panelFiles: string[] = [];

            for (let panelIndex = 0; panelIndex < 4; panelIndex += 1) {
              const panelFile = `img_${index}_${panelIndex}.jpg`;
              panelFiles.push(panelFile);
              const panelBytes = await renderStoryboardPanelBytes(
                storyboardImage,
                panelIndex,
                canvasSize,
                videoExportPreset,
                showWatermark
              );
              await ffmpeg.writeFile(panelFile, panelBytes);

              args.push(
                '-framerate', String(FPS),
                '-loop', '1',
                '-t', segment.panelDuration.toFixed(3),
                '-i', panelFile
              );
            }

            if (audioFile) {
              args.push('-i', audioFile);
            } else {
              args.push(
                '-f', 'lavfi',
                '-t', durationSeconds.toFixed(3),
                '-i', `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_SAMPLE_RATE}`
              );
            }

            const audioInputIndex = panelFiles.length;
            const filterComplex = [
              withFade('0:v', 'v0', segment.panelDuration),
              withFade('1:v', 'v1', segment.panelDuration),
              withFade('2:v', 'v2', segment.panelDuration),
              withFade('3:v', 'v3', segment.panelDuration),
              '[v0][v1][v2][v3]concat=n=4:v=1:a=0[vout]',
              `[${audioInputIndex}:a]aresample=${AUDIO_SAMPLE_RATE},aformat=sample_fmts=fltp:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo,apad=whole_dur=${durationSeconds.toFixed(3)},atrim=duration=${durationSeconds.toFixed(3)},asetpts=PTS-STARTPTS[aout]`,
            ].join(';');

            args.push(
              '-filter_complex', filterComplex,
              '-map', '[vout]',
              '-map', '[aout]',
              '-c:v', 'libx264',
              '-preset', 'ultrafast',
              '-crf', '23',
              '-pix_fmt', 'yuv420p',
              '-c:a', 'aac',
              '-b:a', AUDIO_BITRATE,
              '-ar', String(AUDIO_SAMPLE_RATE),
              '-ac', String(AUDIO_CHANNELS),
              '-shortest',
              outputFile
            );

            const exitCode = await ffmpeg.exec(args);
            if (exitCode !== 0) {
              throw new Error(`Segment ${segment.index + 1} encoding failed (ffmpeg exit code ${exitCode}).`);
            }

            for (const panelFile of panelFiles) {
              await ffmpeg.deleteFile(panelFile);
            }
          } else {
            const imageFile = `img_${index}.jpg`;
            const imageBytes = await renderBeatFrameBytes(
              segment.imageUrl,
              canvasSize,
              videoExportPreset,
              showWatermark
            );
            await ffmpeg.writeFile(imageFile, imageBytes);

            args.push(
              '-framerate', String(FPS),
              '-loop', '1',
              '-t', durationSeconds.toFixed(3),
              '-i', imageFile
            );

            if (audioFile) {
              args.push('-i', audioFile);
            } else {
              args.push(
                '-f', 'lavfi',
                '-t', durationSeconds.toFixed(3),
                '-i', `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_SAMPLE_RATE}`
              );
            }

            const filterComplex = [
              withFade('0:v', 'vout', durationSeconds),
              `[1:a]aresample=${AUDIO_SAMPLE_RATE},aformat=sample_fmts=fltp:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo,apad=whole_dur=${durationSeconds.toFixed(3)},atrim=duration=${durationSeconds.toFixed(3)},asetpts=PTS-STARTPTS[aout]`,
            ].join(';');

            args.push(
              '-filter_complex', filterComplex,
              '-map', '[vout]',
              '-map', '[aout]',
              '-c:v', 'libx264',
              '-preset', 'ultrafast',
              '-crf', '23',
              '-pix_fmt', 'yuv420p',
              '-c:a', 'aac',
              '-b:a', AUDIO_BITRATE,
              '-ar', String(AUDIO_SAMPLE_RATE),
              '-ac', String(AUDIO_CHANNELS),
              '-shortest',
              outputFile
            );

            const exitCode = await ffmpeg.exec(args);
            if (exitCode !== 0) {
              throw new Error(`Segment ${segment.index + 1} encoding failed (ffmpeg exit code ${exitCode}).`);
            }

            await ffmpeg.deleteFile(imageFile);
          }

          segmentFiles.push(outputFile);

          if (audioFile) {
            await ffmpeg.deleteFile(audioFile);
          }

          setState((current) => ({
            ...current,
            progress: 10 + Math.round(((index + 1) / segments.length) * 75),
          }));
        }

        if (cancelledRef.current) {
          for (const file of segmentFiles) {
            try {
              await ffmpeg.deleteFile(file);
            } catch {
              // ignore
            }
          }
          setState({ isExporting: false, progress: 0, phase: 'idle', error: null });
          return false;
        }

        ffmpeg.off('progress', handleEncodingProgress);
        setState((current) => ({ ...current, phase: 'finalizing', progress: 90 }));

        const concatList = segmentFiles.map((file) => `file '${file}'`).join('\n');
        await ffmpeg.writeFile('concat.txt', new TextEncoder().encode(concatList));

        const concatExitCode = await ffmpeg.exec([
          '-f', 'concat',
          '-safe', '0',
          '-i', 'concat.txt',
          '-c', 'copy',
          'output.mp4',
        ]);

        if (concatExitCode !== 0) {
          throw new Error(`Final video assembly failed (ffmpeg exit code ${concatExitCode}).`);
        }

        const outputData = await ffmpeg.readFile('output.mp4');
        const outputBytes = outputData instanceof Uint8Array
          ? outputData.slice()
          : new TextEncoder().encode(outputData as string);
        const outputBlob = new Blob([outputBytes], { type: 'video/mp4' });

        for (const file of [...segmentFiles, 'concat.txt', 'output.mp4']) {
          try {
            await ffmpeg.deleteFile(file);
          } catch {
            // ignore
          }
        }

        if (cancelledRef.current) {
          setState({ isExporting: false, progress: 0, phase: 'idle', error: null });
          return false;
        }

        const url = URL.createObjectURL(outputBlob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${storyTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'story'}.mp4`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        setState({ isExporting: false, progress: 100, phase: 'idle', error: null });
        setTimeout(() => {
          setState((current) => (current.progress === 100 ? { ...current, progress: 0 } : current));
        }, 1500);
        return true;
      } catch (error) {
        for (const file of ['concat.txt', 'output.mp4']) {
          try {
            await ffmpeg.deleteFile(file);
          } catch {
            // ignore
          }
        }

        const dirEntries = await ffmpeg.listDir('.').catch(() => []);
        for (const entry of dirEntries) {
          if (!entry.isDir && transientFilePatterns.some((pattern) => pattern.test(entry.name))) {
            try {
              await ffmpeg.deleteFile(entry.name);
            } catch {
              // ignore
            }
          }
        }

        setState({
          isExporting: false,
          progress: 0,
          phase: 'idle',
          error: cancelledRef.current ? null : (error instanceof Error ? error.message : 'Export failed.'),
        });
        return false;
      } finally {
        ffmpeg.off('progress', handleEncodingProgress);
        if (activeFfmpegRef.current === ffmpeg) {
          activeFfmpegRef.current = null;
        }
      }
    },
    []
  );

  return { exportVideo, cancel, ...state };
}
