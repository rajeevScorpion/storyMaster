import { describe, expect, it } from 'vitest';

import { classifyAcceptanceState, isMissingLegalSchemaError, type RequiredLegalDocument } from './consent.shared';

function doc(pageKey: string, docVersion: string): RequiredLegalDocument {
  return { pageKey, docVersion, acceptanceKind: 'accepted', reacceptanceRequired: false };
}

describe('classifyAcceptanceState', () => {
  it('is fully compliant when there are no required documents', () => {
    const state = classifyAcceptanceState([], new Map());
    expect(state.hasAllRequiredAcceptances).toBe(true);
    expect(state.missingDocumentKeys).toEqual([]);
  });

  it('is fully compliant when every required document is accepted at its current version', () => {
    const required = [doc('terms', '1.0.0'), doc('privacy_policy', '1.0.0')];
    const accepted = new Map([
      ['terms', ['1.0.0']],
      ['privacy_policy', ['1.0.0']],
    ]);

    const state = classifyAcceptanceState(required, accepted);
    expect(state.hasAllRequiredAcceptances).toBe(true);
    expect(state.missingDocumentKeys).toEqual([]);
    expect(state.reconsentDocumentKeys).toEqual([]);
    expect(state.firstTimeDocumentKeys).toEqual([]);
  });

  it('classifies a document the user has never accepted as first-time, not reconsent', () => {
    const required = [doc('terms', '1.0.0')];
    const state = classifyAcceptanceState(required, new Map());

    expect(state.hasAllRequiredAcceptances).toBe(false);
    expect(state.missingDocumentKeys).toEqual(['terms']);
    expect(state.firstTimeDocumentKeys).toEqual(['terms']);
    expect(state.reconsentDocumentKeys).toEqual([]);
  });

  it('classifies a document accepted at an older version as reconsent, not first-time', () => {
    const required = [doc('terms', '2.0.0')];
    const accepted = new Map([['terms', ['1.0.0']]]);

    const state = classifyAcceptanceState(required, accepted);
    expect(state.hasAllRequiredAcceptances).toBe(false);
    expect(state.missingDocumentKeys).toEqual(['terms']);
    expect(state.reconsentDocumentKeys).toEqual(['terms']);
    expect(state.firstTimeDocumentKeys).toEqual([]);
  });

  it('handles a mix of satisfied, first-time and reconsent documents in one pass', () => {
    const required = [doc('terms', '2.0.0'), doc('privacy_policy', '1.0.0'), doc('ai_disclosure', '1.0.0')];
    const accepted = new Map([
      ['terms', ['1.0.0']], // reconsent
      ['privacy_policy', ['1.0.0']], // satisfied
      // ai_disclosure: never accepted -- first-time
    ]);

    const state = classifyAcceptanceState(required, accepted);
    expect(state.hasAllRequiredAcceptances).toBe(false);
    expect(state.missingDocumentKeys.sort()).toEqual(['ai_disclosure', 'terms']);
    expect(state.reconsentDocumentKeys).toEqual(['terms']);
    expect(state.firstTimeDocumentKeys).toEqual(['ai_disclosure']);
  });

  it('does not confuse acceptance of a different document under the same key namespace', () => {
    const required = [doc('terms', '1.0.0')];
    const accepted = new Map([['privacy_policy', ['1.0.0']]]);

    const state = classifyAcceptanceState(required, accepted);
    expect(state.firstTimeDocumentKeys).toEqual(['terms']);
  });
});

describe('isMissingLegalSchemaError', () => {
  it('recognizes undefined_table (42P01)', () => {
    expect(isMissingLegalSchemaError({ code: '42P01' })).toBe(true);
  });

  it('recognizes undefined_column (42703)', () => {
    expect(isMissingLegalSchemaError({ code: '42703' })).toBe(true);
  });

  it('recognizes PostgREST schema-cache misses (PGRST200, PGRST204)', () => {
    expect(isMissingLegalSchemaError({ code: 'PGRST200' })).toBe(true);
    expect(isMissingLegalSchemaError({ code: 'PGRST204' })).toBe(true);
  });

  it('does not treat an unrelated database error as a missing-schema condition', () => {
    expect(isMissingLegalSchemaError({ code: '23505', message: 'duplicate key' })).toBe(false);
  });

  it('returns false for a null or undefined error', () => {
    expect(isMissingLegalSchemaError(null)).toBe(false);
    expect(isMissingLegalSchemaError(undefined)).toBe(false);
  });
});
