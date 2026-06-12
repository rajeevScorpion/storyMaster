import { STORYBOARD_ADVANCE_MS } from '@/lib/constants/media';
import { STORYBOARD_PANEL_COUNT } from '@/lib/storyboard/layout';

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function getEqualSplitStoryboardPanel(elapsedMs: number, totalDurationMs: number): number {
  const durationMs = positiveFinite(totalDurationMs)
    ? totalDurationMs
    : STORYBOARD_ADVANCE_MS * STORYBOARD_PANEL_COUNT;
  const panelDurationMs = durationMs / STORYBOARD_PANEL_COUNT;
  const clampedElapsedMs = Math.max(0, Math.min(elapsedMs, durationMs));

  return Math.max(
    0,
    Math.min(STORYBOARD_PANEL_COUNT - 1, Math.floor(clampedElapsedMs / panelDurationMs))
  );
}

export function getStoryboardPanelDurationsSeconds(audioDurationSeconds: number): number[] {
  const fallbackSeconds = STORYBOARD_ADVANCE_MS / 1000;
  const panelDurationSeconds = positiveFinite(audioDurationSeconds)
    ? audioDurationSeconds / STORYBOARD_PANEL_COUNT
    : fallbackSeconds;

  return Array.from({ length: STORYBOARD_PANEL_COUNT }, () => panelDurationSeconds);
}

export function getPcmWavDurationMs(bytes: ArrayBuffer): number {
  if (bytes.byteLength < 44) return 0;
  const view = new DataView(bytes);
  const readAscii = (offset: number, length: number) => Array.from(
    { length },
    (_, index) => String.fromCharCode(view.getUint8(offset + index))
  ).join('');

  if (readAscii(0, 4) !== 'RIFF' || readAscii(8, 4) !== 'WAVE') return 0;

  let byteRate = 0;
  let dataSize = 0;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;

    if (chunkId === 'fmt ' && chunkDataOffset + 12 <= view.byteLength) {
      byteRate = view.getUint32(chunkDataOffset + 8, true);
    } else if (chunkId === 'data') {
      dataSize = chunkSize;
      break;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  return byteRate > 0 && dataSize > 0
    ? Math.round((dataSize / byteRate) * 1000)
    : 0;
}
