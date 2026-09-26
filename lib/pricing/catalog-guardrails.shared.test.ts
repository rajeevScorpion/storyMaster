import { describe, expect, it } from 'vitest';
import {
  countLiveSubscriberRows,
  describeArchivePlanVersionConfirmation,
  describeDeactivatePlanConfirmation,
  describePublishPlanVersionConfirmation,
  type RawSubscriberStatusRow,
} from './catalog-guardrails.shared';

const NOW = new Date('2026-06-15T00:00:00.000Z');

function row(overrides: Partial<RawSubscriberStatusRow>): RawSubscriberStatusRow {
  return {
    status: 'active',
    current_period_end: null,
    grace_period_ends_at: null,
    ...overrides,
  };
}

describe('countLiveSubscriberRows', () => {
  it('counts an active row with no period end as live', () => {
    expect(countLiveSubscriberRows([row({ status: 'active', current_period_end: null })], NOW)).toBe(1);
  });

  it('counts an active row with a future period end as live', () => {
    expect(
      countLiveSubscriberRows([row({ status: 'active', current_period_end: '2026-07-01T00:00:00.000Z' })], NOW)
    ).toBe(0 + 1);
  });

  it('excludes an active row whose period already ended', () => {
    expect(
      countLiveSubscriberRows([row({ status: 'active', current_period_end: '2026-01-01T00:00:00.000Z' })], NOW)
    ).toBe(0);
  });

  it('counts trialing and authenticated the same as active', () => {
    expect(countLiveSubscriberRows([row({ status: 'trialing' }), row({ status: 'authenticated' })], NOW)).toBe(2);
  });

  it('counts a pending row inside its grace period as live', () => {
    expect(
      countLiveSubscriberRows(
        [row({ status: 'pending', grace_period_ends_at: '2026-06-20T00:00:00.000Z' })],
        NOW
      )
    ).toBe(1);
  });

  it('excludes a pending row past its grace period', () => {
    expect(
      countLiveSubscriberRows(
        [row({ status: 'pending', grace_period_ends_at: '2026-06-01T00:00:00.000Z' })],
        NOW
      )
    ).toBe(0);
  });

  it('excludes a pending row with no grace period at all', () => {
    expect(countLiveSubscriberRows([row({ status: 'pending', grace_period_ends_at: null })], NOW)).toBe(0);
  });

  it('excludes a halted row past its grace period', () => {
    expect(
      countLiveSubscriberRows(
        [row({ status: 'halted', grace_period_ends_at: '2026-01-01T00:00:00.000Z' })],
        NOW
      )
    ).toBe(0);
  });

  it('excludes cancelled, expired and other terminal statuses', () => {
    expect(
      countLiveSubscriberRows(
        [row({ status: 'cancelled' }), row({ status: 'expired' }), row({ status: 'created' })],
        NOW
      )
    ).toBe(0);
  });

  it('sums live rows across a mixed set', () => {
    expect(
      countLiveSubscriberRows(
        [
          row({ status: 'active', current_period_end: '2026-07-01T00:00:00.000Z' }),
          row({ status: 'cancelled' }),
          row({ status: 'pending', grace_period_ends_at: '2026-06-16T00:00:00.000Z' }),
          row({ status: 'halted', grace_period_ends_at: '2026-05-01T00:00:00.000Z' }),
        ],
        NOW
      )
    ).toBe(2);
  });

  it('returns 0 for an empty list', () => {
    expect(countLiveSubscriberRows([], NOW)).toBe(0);
  });
});

describe('confirmation message derivation', () => {
  it('states plainly when the count is unavailable, without claiming the action is blocked', () => {
    const message = describeArchivePlanVersionConfirmation(null);
    expect(message).toMatch(/could not determine/i);
    expect(message).not.toMatch(/prevent|protect|block/i);
  });

  it('states zero subscribers plainly rather than skipping the number', () => {
    expect(describeArchivePlanVersionConfirmation(0)).toMatch(/no live subscribers/i);
  });

  it('uses singular phrasing for exactly one subscriber', () => {
    expect(describeArchivePlanVersionConfirmation(1)).toMatch(/1 live subscriber is on it/i);
    expect(describeArchivePlanVersionConfirmation(1)).not.toMatch(/1 live subscribers/i);
  });

  it('uses plural phrasing for many subscribers', () => {
    expect(describeArchivePlanVersionConfirmation(42)).toMatch(/42 live subscribers are on it/i);
  });

  it('never claims the action prevents or protects access, for any count', () => {
    for (const count of [null, 0, 1, 5]) {
      expect(describeArchivePlanVersionConfirmation(count)).not.toMatch(/prevent|protect/i);
      expect(describeDeactivatePlanConfirmation(count)).not.toMatch(/prevent|protect/i);
      expect(describePublishPlanVersionConfirmation('IN 20000 · 200 coins/mo', count)).not.toMatch(/prevent|protect/i);
    }
  });

  it('names the version being silently archived by a publish', () => {
    const message = describePublishPlanVersionConfirmation('IN 20000 · 200 coins/mo', 3);
    expect(message).toContain('IN 20000 · 200 coins/mo');
    expect(message).toMatch(/archive/i);
    expect(message).toMatch(/3 live subscribers/i);
  });

  it('the deactivate message describes a catalogue-only change', () => {
    expect(describeDeactivatePlanConfirmation(5)).toMatch(/catalogue change only/i);
  });
});
