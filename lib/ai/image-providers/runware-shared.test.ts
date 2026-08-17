import { describe, expect, it } from 'vitest';

import { parseRunwareImageResponse, resolveRunwareDimensions } from './runware-shared';

const TASK_UUID = '39d7207a-87ef-4c93-8082-1431f9c1dc97';

describe('resolveRunwareDimensions', () => {
  const ASPECTS = ['16:9', '9:16', '1:1'] as const;
  const SIZES = [undefined, '512', '0.5K', '1K', '2K', '4K'] as const;

  it('always returns dimensions Runware accepts', () => {
    for (const aspectRatio of ASPECTS) {
      for (const imageSize of SIZES) {
        const { width, height } = resolveRunwareDimensions({
          task: 'image_generation',
          aspectRatio,
          imageSize,
        });
        expect(width % 64, `${aspectRatio}/${imageSize} width`).toBe(0);
        expect(height % 64, `${aspectRatio}/${imageSize} height`).toBe(0);
        expect(width).toBeGreaterThanOrEqual(128);
        expect(height).toBeGreaterThanOrEqual(128);
        expect(width).toBeLessThanOrEqual(2048);
        expect(height).toBeLessThanOrEqual(2048);
      }
    }
  });

  it('stays exactly on the requested aspect ratio', () => {
    const landscape = resolveRunwareDimensions({ task: 'image_generation', aspectRatio: '16:9' });
    expect(landscape.width / landscape.height).toBeCloseTo(16 / 9, 10);

    const portrait = resolveRunwareDimensions({ task: 'image_generation', aspectRatio: '9:16' });
    expect(portrait.width / portrait.height).toBeCloseTo(9 / 16, 10);

    const square = resolveRunwareDimensions({ task: 'image_generation', aspectRatio: '1:1' });
    expect(square.width).toBe(square.height);
  });

  it('gives storyboards the larger grid so each 2x2 panel keeps its resolution', () => {
    expect(resolveRunwareDimensions({ task: 'image_generation', aspectRatio: '16:9' }))
      .toEqual({ width: 2048, height: 1152 });
    expect(resolveRunwareDimensions({ task: 'image_generation', aspectRatio: '16:9', imageSize: '1K' }))
      .toEqual({ width: 1024, height: 576 });
  });

  it('defaults portraits to a compact square regardless of the requested ratio', () => {
    expect(resolveRunwareDimensions({ task: 'portrait_generation' }))
      .toEqual({ width: 1024, height: 1024 });
    expect(resolveRunwareDimensions({ task: 'portrait_generation', aspectRatio: '16:9' }))
      .toEqual({ width: 1024, height: 576 });
  });

  it('falls back to landscape when the aspect ratio is unknown', () => {
    expect(resolveRunwareDimensions({ task: 'image_generation', aspectRatio: '21:9' }))
      .toEqual({ width: 2048, height: 1152 });
  });

  it('honours a capability override and snaps it onto the 64px grid', () => {
    const dimensions = resolveRunwareDimensions({
      task: 'image_generation',
      aspectRatio: '16:9',
      capabilities: { dimensions: { '16:9': { width: 1500, height: 900 } } },
    });
    expect(dimensions.width % 64).toBe(0);
    expect(dimensions.height % 64).toBe(0);
    expect(dimensions).toEqual({ width: 1472, height: 896 });
  });

  it('clamps an out-of-range override into what Runware accepts', () => {
    expect(resolveRunwareDimensions({
      task: 'image_generation',
      aspectRatio: '1:1',
      capabilities: { dimensions: { '1:1': { width: 9000, height: 10 } } },
    })).toEqual({ width: 2048, height: 128 });
  });
});

describe('parseRunwareImageResponse', () => {
  it('reads the entry matching our taskUUID', () => {
    const result = parseRunwareImageResponse({
      data: [
        { taskUUID: 'someone-elses-task', imageDataURI: 'data:image/png;base64,NOPE' },
        {
          taskUUID: TASK_UUID,
          imageDataURI: 'data:image/png;base64,YES',
          imageUUID: 'b7db282d-2943-4f12-992f-77df3ad3ec71',
          cost: 0.0031,
          seed: 42,
          NSFWContent: false,
        },
      ],
    }, TASK_UUID);

    expect(result).toEqual({
      dataUrl: 'data:image/png;base64,YES',
      cost: 0.0031,
      seed: 42,
      imageUUID: 'b7db282d-2943-4f12-992f-77df3ad3ec71',
      nsfw: false,
    });
  });

  it('builds a data URL when only base64 comes back', () => {
    const result = parseRunwareImageResponse({
      data: [{ taskUUID: TASK_UUID, imageBase64Data: 'ABC' }],
    }, TASK_UUID);
    expect(result.dataUrl).toBe('data:image/png;base64,ABC');
    expect(result.cost).toBeNull();
  });

  it('throws when only another task came back', () => {
    expect(() => parseRunwareImageResponse({
      data: [{ taskUUID: 'other', imageDataURI: 'data:image/png;base64,X' }],
    }, TASK_UUID)).toThrow(/no result for task/i);
  });

  it('surfaces the errors array', () => {
    expect(() => parseRunwareImageResponse({
      errors: [{ taskUUID: TASK_UUID, message: 'Invalid model identifier' }],
    }, TASK_UUID)).toThrow(/Invalid model identifier/);
  });

  it('surfaces a bare error string', () => {
    expect(() => parseRunwareImageResponse({ error: 'Unauthorized' }, TASK_UUID))
      .toThrow(/Unauthorized/);
  });

  it('rejects a result with no inline image data', () => {
    expect(() => parseRunwareImageResponse({
      data: [{ taskUUID: TASK_UUID, imageURL: 'https://im.runware.ai/image/x.jpg' }],
    }, TASK_UUID)).toThrow(/without inline image data/i);
  });

  it('does not blow up on an empty envelope', () => {
    expect(() => parseRunwareImageResponse({}, TASK_UUID)).toThrow(/no result for task/i);
  });
});
