import type { VideoExportPreset } from '@/lib/types/pricing';
import type { StoryAspectRatio } from '@/lib/types/story';
import type { ExportPresetDefinition } from '@/lib/video-export/presets';

export type ExportPhase = 'idle' | 'loading' | 'preparing' | 'encoding' | 'finalizing';

export interface VideoExportState {
  isExporting: boolean;
  progress: number;
  phase: ExportPhase;
  error: string | null;
}

export interface VideoExportOptions {
  aspectRatio?: StoryAspectRatio;
  /** Per-plan branding preset (watermark + legacy resolution fallback). */
  videoExportPreset?: VideoExportPreset | null;
  /** Engine preset picked in the export dialog (resolution/fps/bitrates). */
  exportEnginePreset?: ExportPresetDefinition | null;
  showWatermark?: boolean;
}
