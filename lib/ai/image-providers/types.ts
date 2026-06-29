import type { InlineImagePart } from '@/app/actions/gemini-proxy';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import type { ImageModelSnapshot, ImageTaskKey } from '@/lib/ai/image-models.shared';

export interface ImageProviderRequest {
  task: ImageTaskKey;
  prompt: string;
  referenceParts?: InlineImagePart[];
  aspectRatio?: string;
  imageSize?: string;
  telemetry?: CostTelemetryContext;
  modelSnapshot: ImageModelSnapshot;
}

export interface ImageProviderResult {
  dataUrl: string | null;
  fallbackText: string | null;
  metadata: Record<string, unknown>;
}

export interface ImageProviderAdapter {
  generateImage(request: ImageProviderRequest): Promise<ImageProviderResult>;
}
