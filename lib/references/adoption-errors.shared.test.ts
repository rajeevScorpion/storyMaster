import { describe, it, expect } from 'vitest';
import { REFERENCE_ADOPTION_FAILURE_MESSAGE, readerSafeAdoptionError } from './adoption-errors.shared';

describe('readerSafeAdoptionError', () => {
  it('passes null through unchanged', () => {
    expect(readerSafeAdoptionError(null)).toBeNull();
  });

  it('keeps the deliberate reader-safe messages verbatim', () => {
    expect(readerSafeAdoptionError('This upload is no longer available.')).toBe('This upload is no longer available.');
    expect(readerSafeAdoptionError('Could not read the uploaded image.')).toBe('Could not read the uploaded image.');
    expect(readerSafeAdoptionError(REFERENCE_ADOPTION_FAILURE_MESSAGE)).toBe(REFERENCE_ADOPTION_FAILURE_MESSAGE);
  });

  it('collapses raw provider or storage error text to the generic constant', () => {
    expect(readerSafeAdoptionError('R2 bucket kissago-refs: 403 Forbidden')).toBe(REFERENCE_ADOPTION_FAILURE_MESSAGE);
    expect(readerSafeAdoptionError('OpenRouter model "openrouter:qwen/qwen3.7-flash" request failed')).toBe(REFERENCE_ADOPTION_FAILURE_MESSAGE);
  });

  it('collapses historical raw rows that happen to resemble but not exactly match a safe message', () => {
    expect(readerSafeAdoptionError('This upload is no longer available. Please upload it again.')).toBe(REFERENCE_ADOPTION_FAILURE_MESSAGE);
  });
});
