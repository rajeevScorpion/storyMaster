import { describe, expect, it } from 'vitest';
import { paginateAdminTableRows } from './table-pagination.shared';

describe('paginateAdminTableRows', () => {
  const rows = Array.from({ length: 23 }, (_, index) => index + 1);

  it('returns the first page and its display range by default', () => {
    const result = paginateAdminTableRows(rows, 1, 10);
    expect(result).toEqual({
      page: 1,
      pageCount: 3,
      rows: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      totalCount: 23,
      rangeStart: 1,
      rangeEnd: 10,
    });
  });

  it('slices a middle page', () => {
    const result = paginateAdminTableRows(rows, 2, 10);
    expect(result.rows).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(result.rangeStart).toBe(11);
    expect(result.rangeEnd).toBe(20);
  });

  it('returns a short final page', () => {
    const result = paginateAdminTableRows(rows, 3, 10);
    expect(result.rows).toEqual([21, 22, 23]);
    expect(result.rangeStart).toBe(21);
    expect(result.rangeEnd).toBe(23);
  });

  it('clamps a page number past the end to the last real page', () => {
    const result = paginateAdminTableRows(rows, 99, 10);
    expect(result.page).toBe(3);
    expect(result.rows).toEqual([21, 22, 23]);
  });

  it('clamps a page number below 1 up to 1', () => {
    const result = paginateAdminTableRows(rows, 0, 10);
    expect(result.page).toBe(1);
    expect(result.rows).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('clamps a non-finite page to 1', () => {
    const result = paginateAdminTableRows(rows, Number.NaN, 10);
    expect(result.page).toBe(1);
  });

  it('reports one page and a full-range display when everything fits on one page', () => {
    const short = rows.slice(0, 7);
    const result = paginateAdminTableRows(short, 1, 10);
    expect(result).toEqual({
      page: 1,
      pageCount: 1,
      rows: short,
      totalCount: 7,
      rangeStart: 1,
      rangeEnd: 7,
    });
  });

  it('handles an empty row set without dividing by zero or going negative', () => {
    const result = paginateAdminTableRows([], 1, 10);
    expect(result).toEqual({
      page: 1,
      pageCount: 1,
      rows: [],
      totalCount: 0,
      rangeStart: 0,
      rangeEnd: 0,
    });
  });

  it('defaults to the standard page size of 10 when none is passed', () => {
    const result = paginateAdminTableRows(rows, 1);
    expect(result.rows).toHaveLength(10);
    expect(result.pageCount).toBe(3);
  });
});
