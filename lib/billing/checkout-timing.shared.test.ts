import { describe, it, expect } from 'vitest';

import { createCheckoutTimer } from './checkout-timing.shared';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1): an injected clock makes this
 * deterministic -- no fake timers or real `performance.now()` needed.
 */

function stepClock(values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

describe('createCheckoutTimer', () => {
  it('records the elapsed time since the previous mark, not since the timer started', () => {
    const timer = createCheckoutTimer(stepClock([0, 10, 35, 40]));

    timer.mark('auth');
    timer.mark('catalogue');
    timer.mark('tax');

    expect(timer.entries()).toEqual([
      { step: 'auth', durationMs: 10 },
      { step: 'catalogue', durationMs: 25 },
      { step: 'tax', durationMs: 5 },
    ]);
  });

  it('starts with no entries', () => {
    const timer = createCheckoutTimer(stepClock([0]));
    expect(timer.entries()).toEqual([]);
  });

  it('formats toServerTiming as a comma-separated Server-Timing value', () => {
    const timer = createCheckoutTimer(stepClock([0, 12.34, 20]));
    timer.mark('auth');
    timer.mark('catalogue');

    expect(timer.toServerTiming()).toBe('auth;dur=12.3, catalogue;dur=7.7');
  });

  it('returns an empty string when nothing was marked', () => {
    const timer = createCheckoutTimer(stepClock([0]));
    expect(timer.toServerTiming()).toBe('');
  });

  it('entries() returns a snapshot -- mutating the result does not affect the timer', () => {
    const timer = createCheckoutTimer(stepClock([0, 5]));
    timer.mark('auth');
    const snapshot = timer.entries();
    snapshot.push({ step: 'tax', durationMs: 999 });
    expect(timer.entries()).toEqual([{ step: 'auth', durationMs: 5 }]);
  });
});
