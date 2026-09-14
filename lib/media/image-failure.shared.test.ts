import { describe, it, expect } from 'vitest';
import { IMAGE_FAILURE_MESSAGE, readerSafeImageError } from './image-failure.shared';

describe('readerSafeImageError', () => {
  it('returns undefined for null and undefined', () => {
    expect(readerSafeImageError(null)).toBeUndefined();
    expect(readerSafeImageError(undefined)).toBeUndefined();
  });

  it('collapses any present raw error text to the generic constant', () => {
    expect(readerSafeImageError('Runware provider gpt-image-1-mini: 500 Internal Server Error')).toBe(IMAGE_FAILURE_MESSAGE);
    expect(readerSafeImageError('OpenAI image model failed')).toBe(IMAGE_FAILURE_MESSAGE);
    expect(readerSafeImageError(IMAGE_FAILURE_MESSAGE)).toBe(IMAGE_FAILURE_MESSAGE);
  });
});
