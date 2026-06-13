import type { VideoExportPreset } from '@/lib/types/pricing';
import type { StoryAspectRatio } from '@/lib/types/story';

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
