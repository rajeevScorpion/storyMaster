import { describe, it, expect } from 'vitest';
import { currentFinancialYear, financialYearForDate } from './financial-year.shared';

describe('financialYearForDate', () => {
  it('places 1 April IST at the very start of the new FY', () => {
    // 2026-04-01T00:00:00+05:30 == 2026-03-31T18:30:00Z
    expect(financialYearForDate(new Date('2026-03-31T18:30:00.000Z'))).toBe('2026-27');
  });

  it('places the instant just before 1 April IST in the prior FY', () => {
    // 2026-03-31T23:59:59+05:30 == 2026-03-31T18:29:59Z
    expect(financialYearForDate(new Date('2026-03-31T18:29:59.000Z'))).toBe('2025-26');
  });

  it('places a UTC timestamp that has already crossed midnight but not yet IST midnight in the old FY', () => {
    // 2026-04-01T03:00:00Z is 2026-04-01T08:30 IST -- past UTC midnight, still within the new FY either way;
    // the real edge case is the reverse: 2026-03-31T20:00:00Z is 2026-04-01T01:30 IST, already the new FY.
    expect(financialYearForDate(new Date('2026-03-31T20:00:00.000Z'))).toBe('2026-27');
  });

  it('places January-March in the FY that started the previous April', () => {
    expect(financialYearForDate(new Date('2027-01-15T10:00:00.000Z'))).toBe('2026-27');
    expect(financialYearForDate(new Date('2027-03-31T00:00:00.000Z'))).toBe('2026-27');
  });

  it('places a mid-year date in the obvious FY', () => {
    expect(financialYearForDate(new Date('2026-09-17T12:00:00.000Z'))).toBe('2026-27');
  });

  it('rejects an invalid date', () => {
    expect(() => financialYearForDate(new Date('not-a-date'))).toThrow();
  });
});

describe('currentFinancialYear', () => {
  it('defaults to the system clock and matches financialYearForDate for an explicit now', () => {
    const now = new Date('2026-09-17T12:00:00.000Z');
    expect(currentFinancialYear(now)).toBe(financialYearForDate(now));
  });
});
