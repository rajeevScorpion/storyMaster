import type { BufferTarget, Mp4OutputFormat, Output } from 'mediabunny';

const verifiedConfigurations = new Set<string>();

export interface MediaBunnyConfig {
  width: number;
  height: number;
  fps: number;
  sampleRate: number;
  channels: number;
}

export async function loadVerifiedMediaBunny(config: MediaBunnyConfig) {
  const mediabunny = await import('mediabunny');
  const canEncodeAvc = await mediabunny.canEncodeVideo('avc', {
    width: config.width,
    height: config.height,
    bitrate: mediabunny.QUALITY_HIGH,
  });
  if (!canEncodeAvc) throw new Error('Native AVC video encoding is unavailable.');

  if (!(await mediabunny.canEncodeAudio('aac', {
    numberOfChannels: config.channels,
    sampleRate: config.sampleRate,
    bitrate: mediabunny.QUALITY_HIGH,
  }))) {
    const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
    registerAacEncoder();
  }

  const key = `${config.width}x${config.height}:${config.fps}:${config.channels}:${config.sampleRate}`;
  if (!verifiedConfigurations.has(key)) {
    const canvas = document.createElement('canvas');
    canvas.width = config.width;
    canvas.height = config.height;
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
    output.addVideoTrack(videoSource, { frameRate: config.fps });
    output.addAudioTrack(audioSource);

    try {
      await output.start();
      await videoSource.add(0, 0.05, { keyFrame: true });
      await audioSource.add(new AudioBuffer({
        numberOfChannels: config.channels,
        length: Math.max(1, Math.ceil(config.sampleRate * 0.05)),
        sampleRate: config.sampleRate,
      }));
      await output.finalize();
      if (!target.buffer?.byteLength) throw new Error('Fast export produced an empty MP4.');
      verifiedConfigurations.add(key);
    } finally {
      if (output.state !== 'finalized' && output.state !== 'canceled') {
        await output.cancel().catch(() => undefined);
      }
    }
  }

  return mediabunny;
}

export async function cancelMediaBunnyOutput(
  output: Output<Mp4OutputFormat, BufferTarget> | null
): Promise<void> {
  if (output && output.state !== 'finalized' && output.state !== 'canceled') {
    await output.cancel().catch(() => undefined);
  }
}

export async function waitForVideoExportFonts(): Promise<void> {
  if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined);
}

export function downloadMp4(buffer: BlobPart, title: string, fallbackName: string): void {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'video/mp4' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || fallbackName}.mp4`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function createSilentAudioBuffer(durationMs: number, sampleRate: number, channels: number): AudioBuffer {
  return new AudioBuffer({
    numberOfChannels: channels,
    length: Math.max(1, Math.ceil((Math.max(1, durationMs) / 1000) * sampleRate)),
    sampleRate,
  });
}
