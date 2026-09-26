import { describe, it, expect } from 'vitest';
import { istDayWindow, istLocalDay } from './watch-quota.shared';

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

describe('istDayWindow', () => {
  it('reports the same local day istLocalDay would, plus the UTC instants bounding it', () => {
    // 2026-09-18T23:59:59+05:30 == 2026-09-18T18:29:59Z -- still the 18th, which started at
    // 2026-09-17T18:30Z and rolls over one second later.
    const window = istDayWindow(new Date('2026-09-18T18:29:59.000Z'));
    expect(window.localDay).toBe('2026-09-18');
    expect(window.startsAtUtc).toBe('2026-09-17T18:30:00.000Z');
    expect(window.rollsOverAtUtc).toBe('2026-09-18T18:30:00.000Z');
  });

  it('rolls the window over exactly at the IST midnight boundary', () => {
    // 2026-09-19T00:00:00+05:30 == 2026-09-18T18:30:00Z -- the instant the 19th begins.
    const window = istDayWindow(new Date('2026-09-18T18:30:00.000Z'));
    expect(window.localDay).toBe('2026-09-19');
    expect(window.startsAtUtc).toBe('2026-09-18T18:30:00.000Z');
    expect(window.rollsOverAtUtc).toBe('2026-09-19T18:30:00.000Z');
  });

  it('spans exactly 24 hours regardless of which day it is', () => {
    const window = istDayWindow(new Date('2026-01-04T18:30:00.000Z'));
    const spanMs = new Date(window.rollsOverAtUtc).getTime() - new Date(window.startsAtUtc).getTime();
    expect(spanMs).toBe(24 * 60 * 60 * 1000);
  });
});
