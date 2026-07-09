import { describe, expect, it } from 'vitest';
import {
  beatCostToCoins,
  coinsToBeatCost,
  estimateImageProviderCostUsd,
  getImageModelMaxReferenceImages,
  imageTaskForStoryKind,
} from './image-models.shared';

describe('image model shared helpers', () => {
  it('maps story kinds to image task keys', () => {
    expect(imageTaskForStoryKind('story')).toBe('image_generation');
    expect(imageTaskForStoryKind('reel')).toBe('reel_image_generation');
  });

  it('converts between coins and beat costs without negative values', () => {
    expect(coinsToBeatCost(5)).toBe(0.5);
    expect(coinsToBeatCost(-5)).toBe(0);
    expect(beatCostToCoins(1.5)).toBe(15);
    expect(beatCostToCoins(-1)).toBe(0);
  });

  it('estimates provider image cost from output and reference images', () => {
    expect(estimateImageProviderCostUsd({
      snapshot: {
        providerCostPerOutputImageUsd: 0.05,
        providerCostPerInputImageUsd: 0.01,
      },
      outputImageCount: 1,
      inputImageCount: 3,
    })).toBe(0.08);
  });

  it('resolves reference image limits from model capabilities', () => {
    expect(getImageModelMaxReferenceImages({ supportsReferences: true, maxReferenceImages: 4 })).toBe(4);
    expect(getImageModelMaxReferenceImages({ supportsReferences: true })).toBe(3);
    expect(getImageModelMaxReferenceImages({ supportsReferences: false })).toBe(0);
  });
});
