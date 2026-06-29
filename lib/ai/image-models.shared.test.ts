import { describe, expect, it } from 'vitest';
import { beatCostToCoins, coinsToBeatCost, imageTaskForStoryKind } from './image-models.shared';

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
});
