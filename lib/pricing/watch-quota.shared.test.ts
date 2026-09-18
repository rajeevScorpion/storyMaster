import { describe, it, expect } from 'vitest';
import { istLocalDay, WATCH_QUOTA_EXHAUSTED_MARKER } from './watch-quota.shared';

describe('istLocalDay', () => {
  it('is still the same IST day one second before the IST midnight boundary', () => {
    // 2026-09-18T23:59:59+05:30 == 2026-09-18T18:29:59Z
    expect(istLocalDay(new Date('2026-09-18T18:29:59.000Z'))).toBe('2026-09-18');
  });

  it('rolls over to the next IST day exactly at the boundary', () => {
    // 2026-09-19T00:00:00+05:30 == 2026-09-18T18:30:00Z
    expect(istLocalDay(new Date('2026-09-18T18:30:00.000Z'))).toBe('2026-09-19');
  });

  it('handles a mid-day UTC timestamp the same as the obvious IST date', () => {
    // 2026-09-18T12:00:00Z == 2026-09-18T17:30 IST
    expect(istLocalDay(new Date('2026-09-18T12:00:00.000Z'))).toBe('2026-09-18');
  });

  it('handles a UTC timestamp already past UTC midnight but before IST midnight', () => {
    // 2026-09-18T20:00:00Z == 2026-09-19T01:30 IST -- already the next IST day
    expect(istLocalDay(new Date('2026-09-18T20:00:00.000Z'))).toBe('2026-09-19');
  });

  it('pads single-digit months and days', () => {
    // 2026-01-05T00:00:00+05:30 == 2026-01-04T18:30:00Z
    expect(istLocalDay(new Date('2026-01-04T18:30:00.000Z'))).toBe('2026-01-05');
  });

  it('rejects an invalid date', () => {
    expect(() => istLocalDay(new Date('not-a-date'))).toThrow();
  });
});

describe('WATCH_QUOTA_EXHAUSTED_MARKER', () => {
  it('is a fixed, non-empty protocol string', () => {
    expect(WATCH_QUOTA_EXHAUSTED_MARKER).toBe('WATCH_QUOTA_EXHAUSTED');
  });
});
