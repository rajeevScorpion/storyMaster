'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { STORYBOARD_ADVANCE_MS } from '@/lib/constants/media';
import type { StoryBeat } from '@/lib/types/story';

// ---------------------------------------------------------------------------
// FFmpeg singleton — loaded once per page lifetime.
//
// The @ffmpeg/ffmpeg package resolves its class worker relative to the
// package's own import.meta.url. In dev that can land on a CDN/optimized
// module URL instead of our app origin, which makes Worker construction fail.
// We avoid that by pointing every FFmpeg asset at same-origin files in
// public/ffmpeg/.
// ---------------------------------------------------------------------------
let ffmpegInstance: FFmpeg | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;

  const assetBaseURL = new URL('/ffmpeg/', window.location.origin);
  const classWorkerURL = new URL('ffmpeg-worker.js', assetBaseURL).href;
  const coreURL = new URL('ffmpeg-core.js', assetBaseURL).href;
  const wasmURL = new URL('ffmpeg-core.wasm', assetBaseURL).href;

  const ff = new FFmpeg();

  ff.on('log', ({ message }) => {
    console.log('[ffmpeg]', message);
  });

  // Keep the whole FFmpeg boot path same-origin so the package never tries
  // to spawn its default CDN-resolved worker.
  // Requires COOP + COEP headers for SharedArrayBuffer — set in next.config.ts.
  await ff.load({ classWorkerURL, coreURL, wasmURL });

  ffmpegInstance = ff;
  return ff;
}

// ---------------------------------------------------------------------------
// Audio duration helper — probes duration without full decode
// ---------------------------------------------------------------------------
function probeAudioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const cleanup = () => { audio.src = ''; };
    audio.addEventListener('loadedmetadata', () => {
      const d = audio.duration;
      cleanup();
      resolve(isFinite(d) && d > 0 ? d : 0);
    });
    audio.addEventListener('error', () => { cleanup(); resolve(0); });
    audio.src = url;
  });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const FADE_DURATION = 0.6; // seconds — matches StorylinePlayer Framer Motion transition
const OUTPUT_WIDTH = 1280;
const OUTPUT_HEIGHT = 720;
const FPS = 24;
const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_CHANNELS = 2;
const AUDIO_BITRATE = '96k';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type ExportPhase = 'idle' | 'loading' | 'preparing' | 'encoding' | 'finalizing';

export interface VideoExportState {
  isExporting: boolean;
  progress: number; // 0–100
  phase: ExportPhase;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
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
      // Browsers ignore custom text here, but setting returnValue is still
      // required to trigger the built-in confirmation dialog.
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
    async (beats: StoryBeat[], storyTitle: string): Promise<boolean> => {
      const videoBeats = beats.filter((b) => !!b.imageUrl);
      if (videoBeats.length === 0) {
        setState((s) => ({ ...s, error: 'No images found in this story.' }));
        return false;
      }

      cancelledRef.current = false;
      setState({ isExporting: true, progress: 0, phase: 'loading', error: null });

      // SharedArrayBuffer is required for ffmpeg.wasm — enabled via COOP/COEP headers in next.config.ts
      if (typeof SharedArrayBuffer === 'undefined') {
        setState({ isExporting: false, progress: 0, phase: 'idle', error: 'Video export is not supported in this browser. Try Chrome or Edge.' });
        return false;
      }

      let ffmpeg: Awaited<ReturnType<typeof getFFmpeg>>;
      try {
        ffmpeg = await getFFmpeg();
        activeFfmpegRef.current = ffmpeg;
      } catch (e) {
        // Reset singleton so next attempt retries the load
        ffmpegInstance = null;
        const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e);
        console.error('[useVideoExport] FFmpeg load failed:', e);
        setState({ isExporting: false, progress: 0, phase: 'idle', error: `Failed to load video encoder: ${msg}` });
        return false;
      }

      if (cancelledRef.current) {
        setState({ isExporting: false, progress: 0, phase: 'idle', error: null });
        return false;
      }

      setState((s) => ({ ...s, phase: 'preparing', progress: 5 }));

      // ------------------------------------------------------------------
      // Phase 1 — Fetch assets & compute timing
      // ------------------------------------------------------------------
      interface BeatSegment {
        index: number;
        imageUrl: string;
        audioUrl: string | null;
        isStoryboard: boolean;
        audioDuration: number; // seconds, 0 if no audio
        panelDuration: number; // seconds per panel (or total for regular)
        totalDuration: number; // seconds for the entire beat
      }

      const segments: BeatSegment[] = await Promise.all(
        videoBeats.map(async (beat, i) => {
          const audioDur = beat.audioUrl ? await probeAudioDuration(beat.audioUrl) : 0;
          const isSb = !!beat.isStoryboard;
          const fallbackSec = STORYBOARD_ADVANCE_MS / 1000;

          const panelDuration = audioDur > 0
            ? (isSb ? audioDur / 4 : audioDur)
            : fallbackSec;

          const totalDuration = isSb ? panelDuration * 4 : panelDuration;

          return {
            index: i,
            imageUrl: beat.imageUrl!,
            audioUrl: beat.audioUrl ?? null,
            isStoryboard: isSb,
            audioDuration: audioDur,
            panelDuration,
            totalDuration,
          };
        })
      );

      // ------------------------------------------------------------------
      // Phase 2 — Write assets to virtual FS & encode per-beat segments
      // ------------------------------------------------------------------
      setState((s) => ({ ...s, phase: 'encoding', progress: 10 }));

      const segmentFiles: string[] = [];
      let currentSegmentIndex = 0;

      const handleEncodingProgress = ({ progress }: { progress: number }) => {
        const normalizedProgress = clamp01(progress);
        const completedFraction = (currentSegmentIndex + normalizedProgress) / Math.max(segments.length, 1);
        setState((s) => ({
          ...s,
          progress: 10 + Math.round(completedFraction * 75),
        }));
      };

      ffmpeg.on('progress', handleEncodingProgress);

      try {
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          currentSegmentIndex = i;
          const imgFile = `img_${i}.jpg`;
          const audioFile = seg.audioUrl ? `aud_${i}.wav` : null;
          const outFile = `seg_${i}.mp4`;

          if (cancelledRef.current) {
            setState({ isExporting: false, progress: 0, phase: 'idle', error: null });
            return false;
          }

          await ffmpeg.writeFile(imgFile, await fetchFile(seg.imageUrl));

          if (seg.audioUrl && audioFile) {
            await ffmpeg.writeFile(audioFile, await fetchFile(seg.audioUrl));
          }

          const fade = Math.max(0, Math.min(FADE_DURATION, seg.panelDuration / 2 - 0.01));
          const withFade = (filter: string, duration: number) => {
            if (fade <= 0) return filter;
            return `${filter},fade=t=in:d=${fade.toFixed(3)},fade=t=out:st=${(duration - fade).toFixed(3)}:d=${fade.toFixed(3)}`;
          };

          const args: string[] = [];

          if (seg.isStoryboard) {
            args.push(
              '-framerate', String(FPS),
              '-loop', '1',
              '-t', seg.panelDuration.toFixed(3),
              '-i', imgFile,
            );

            if (audioFile) {
              args.push('-i', audioFile);
            } else {
              args.push(
                '-f', 'lavfi',
                '-t', seg.totalDuration.toFixed(3),
                '-i', `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_SAMPLE_RATE}`,
              );
            }

            const pd = seg.panelDuration;
            const filterComplex = [
              `[0:v]split=4[s0][s1][s2][s3]`,
              `${withFade(`[s0]crop=iw/2:ih/2:0:0,scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},setsar=1`, pd)}[v0]`,
              `${withFade(`[s1]crop=iw/2:ih/2:iw/2:0,scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},setsar=1`, pd)}[v1]`,
              `${withFade(`[s2]crop=iw/2:ih/2:0:ih/2,scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},setsar=1`, pd)}[v2]`,
              `${withFade(`[s3]crop=iw/2:ih/2:iw/2:ih/2,scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},setsar=1`, pd)}[v3]`,
              `[v0][v1][v2][v3]concat=n=4:v=1:a=0[vout]`,
              `[1:a]aresample=${AUDIO_SAMPLE_RATE},aformat=sample_fmts=fltp:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo,apad=whole_dur=${seg.totalDuration.toFixed(3)},atrim=duration=${seg.totalDuration.toFixed(3)},asetpts=PTS-STARTPTS[aout]`,
            ].join(';');

            args.push(
              '-filter_complex', filterComplex,
              '-map', '[vout]', '-map', '[aout]',
              '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
              '-c:a', 'aac', '-b:a', AUDIO_BITRATE,
              '-ar', String(AUDIO_SAMPLE_RATE),
              '-ac', String(AUDIO_CHANNELS),
              '-shortest',
              outFile,
            );
          } else {
            args.push(
              '-framerate', String(FPS),
              '-loop', '1',
              '-t', seg.panelDuration.toFixed(3),
              '-i', imgFile,
            );

            if (audioFile) {
              args.push('-i', audioFile);
            } else {
              args.push(
                '-f', 'lavfi',
                '-t', seg.panelDuration.toFixed(3),
                '-i', `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_SAMPLE_RATE}`,
              );
            }

            const filterComplex = [
              `${withFade(
                `[0:v]scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,` +
                `pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,` +
                `setsar=1`,
                seg.panelDuration
              )}[vout]`,
              `[1:a]aresample=${AUDIO_SAMPLE_RATE},aformat=sample_fmts=fltp:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo,apad=whole_dur=${seg.panelDuration.toFixed(3)},atrim=duration=${seg.panelDuration.toFixed(3)},asetpts=PTS-STARTPTS[aout]`,
            ].join(';');

            args.push(
              '-filter_complex', filterComplex,
              '-map', '[vout]', '-map', '[aout]',
              '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
              '-c:a', 'aac', '-b:a', AUDIO_BITRATE,
              '-ar', String(AUDIO_SAMPLE_RATE),
              '-ac', String(AUDIO_CHANNELS),
              '-shortest',
              outFile,
            );
          }

          const segmentExitCode = await ffmpeg.exec(args);
          if (segmentExitCode !== 0) {
            throw new Error(`Segment ${i + 1} encoding failed (ffmpeg exit code ${segmentExitCode}).`);
          }

          segmentFiles.push(outFile);

          await ffmpeg.deleteFile(imgFile);
          if (audioFile) await ffmpeg.deleteFile(audioFile);

          setState((s) => ({
            ...s,
            progress: 10 + Math.round(((i + 1) / segments.length) * 75),
          }));
        }

        if (cancelledRef.current) {
          for (const f of segmentFiles) {
            try { await ffmpeg.deleteFile(f); } catch { /* ignore */ }
          }
          setState({ isExporting: false, progress: 0, phase: 'idle', error: null });
          return false;
        }

        ffmpeg.off('progress', handleEncodingProgress);
        setState((s) => ({ ...s, phase: 'finalizing', progress: 90 }));

        const concatList = segmentFiles.map((f) => `file '${f}'`).join('\n');
        await ffmpeg.writeFile('concat.txt', new TextEncoder().encode(concatList));

        const concatExitCode = await ffmpeg.exec([
          '-f', 'concat', '-safe', '0',
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

        for (const f of segmentFiles) {
          try { await ffmpeg.deleteFile(f); } catch { /* ignore */ }
        }
        try { await ffmpeg.deleteFile('concat.txt'); } catch { /* ignore */ }
        try { await ffmpeg.deleteFile('output.mp4'); } catch { /* ignore */ }

        if (cancelledRef.current) {
          setState({ isExporting: false, progress: 0, phase: 'idle', error: null });
          return false;
        }

        const url = URL.createObjectURL(outputBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${storyTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'story'}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        setState({ isExporting: false, progress: 100, phase: 'idle', error: null });
        setTimeout(() => setState((s) => (s.progress === 100 ? { ...s, progress: 0 } : s)), 1500);
        return true;
      } catch (err) {
        if (cancelledRef.current) {
          for (const file of ['concat.txt', 'output.mp4']) {
            try { await ffmpeg.deleteFile(file); } catch { /* ignore */ }
          }
          const segmentPattern = /^seg_\d+\.mp4$/;
          for (const f of await ffmpeg.listDir('.').catch(() => [])) {
            if (!f.isDir && segmentPattern.test(f.name)) {
              try { await ffmpeg.deleteFile(f.name); } catch { /* ignore */ }
            }
          }
          setState({ isExporting: false, progress: 0, phase: 'idle', error: null });
          return false;
        }

        for (const file of ['concat.txt', 'output.mp4']) {
          try { await ffmpeg.deleteFile(file); } catch { /* ignore */ }
        }
        const segmentPattern = /^seg_\d+\.mp4$/;
        for (const f of await ffmpeg.listDir('.').catch(() => [])) {
          if (!f.isDir && segmentPattern.test(f.name)) {
            try { await ffmpeg.deleteFile(f.name); } catch { /* ignore */ }
          }
        }
        setState({
          isExporting: false,
          progress: 0,
          phase: 'idle',
          error: err instanceof Error ? err.message : 'Export failed.',
        });
        return false;
      } finally {
        ffmpeg.off('progress', handleEncodingProgress);
        if (activeFfmpegRef.current === ffmpeg) {
          activeFfmpegRef.current = null;
        }
      }
    },
    [],
  );

  return { exportVideo, cancel, ...state };
}
