import { describe, it, expect } from 'vitest';
import { isLastWatchSlot, watchSlotsRemaining, type WatchQuotaView } from './watch-quota.shared';

function view(overrides: Partial<WatchQuotaView> = {}): WatchQuotaView {
  return { unlimited: false, used: 0, limit: 3, isReplay: false, upsell: null, ...overrides };
}

describe('watchSlotsRemaining', () => {
  it('counts down from the limit', () => {
    expect(watchSlotsRemaining(view({ used: 0 }))).toBe(3);
    expect(watchSlotsRemaining(view({ used: 2 }))).toBe(1);
    expect(watchSlotsRemaining(view({ used: 3 }))).toBe(0);
  });

  it('never goes negative when an admin lowers the limit below what was already spent', () => {
    // Someone watched 5 yesterday's-limit stories, then the setting dropped to 3. "-2 left" is
    // not a thing a reader should ever be shown.
    expect(watchSlotsRemaining(view({ used: 5, limit: 3 }))).toBe(0);
  });

  it('is infinite for an exempt reader', () => {
    expect(watchSlotsRemaining(view({ unlimited: true, used: 0, limit: 0 }))).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('isLastWatchSlot', () => {
  it('is true only when exactly one slot is left', () => {
    expect(isLastWatchSlot(view({ used: 1 }))).toBe(false);
    expect(isLastWatchSlot(view({ used: 2 }))).toBe(true);
    expect(isLastWatchSlot(view({ used: 3 }))).toBe(false);
  });

  it('never warns on a replay, however few slots are left (owner decision 3)', () => {
    // A replay spends nothing, so there is nothing to confirm -- warning here would train readers
    // to dismiss the one prompt that matters.
    expect(isLastWatchSlot(view({ used: 2, isReplay: true }))).toBe(false);
  });

  it('never warns an exempt reader', () => {
    expect(isLastWatchSlot(view({ unlimited: true, used: 0, limit: 0 }))).toBe(false);
  });

  it('does not warn once the day is already spent -- that is a refusal, not a confirmation', () => {
    expect(isLastWatchSlot(view({ used: 4, limit: 3 }))).toBe(false);
  });
});
