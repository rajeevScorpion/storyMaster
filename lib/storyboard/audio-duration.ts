import { toMediaFetchUrl } from '@/lib/media/client';
import { getPcmWavDurationMs } from '@/lib/storyboard/timing';

const STORY_AUDIO_HEADER_RANGE = 'bytes=0-65535';

export async function probeStoryAudioDurationMs(
  audioUrl: string,
  signal?: AbortSignal
): Promise<number> {
  try {
    const response = await fetch(toMediaFetchUrl(audioUrl), {
      headers: { Range: STORY_AUDIO_HEADER_RANGE },
      signal,
    });
    if (!response.ok) return 0;
    return getPcmWavDurationMs(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 0;
    return 0;
  }
}
