import type { ManagedPageAcceptanceKind } from '@/lib/managed-pages/types';

/**
 * Pure logic extracted from consent.ts (which starts with `import 'server-only'`
 * and therefore can't be imported into a test) so the acceptance-state decision
 * and the missing-schema error classifier are unit-testable, per this repo's
 * `*.shared.ts` convention.
 */

export interface RequiredLegalDocument {
  pageKey: string;
  docVersion: string;
  acceptanceKind: ManagedPageAcceptanceKind;
  reacceptanceRequired: boolean;
}

export interface LegalAcceptanceState {
  hasAllRequiredAcceptances: boolean;
  /** page_key of every required document the user has not accepted at its current version. */
  missingDocumentKeys: string[];
  /** Subset of missingDocumentKeys where the user previously accepted an older version -- this is a re-consent, not a first-time gate. */
  reconsentDocumentKeys: string[];
  /** Subset of missingDocumentKeys the user has never accepted at any version -- a genuine first-time gate (e.g. fresh OAuth signup). */
  firstTimeDocumentKeys: string[];
  requiredDocuments: RequiredLegalDocument[];
}

/**
 * Classifies each required document as satisfied, needing first-time
 * acceptance, or needing re-consent, given the user's previously accepted
 * versions per document key.
 */
export function classifyAcceptanceState(
  required: RequiredLegalDocument[],
  acceptedVersionsByKey: Map<string, string[]>
): LegalAcceptanceState {
  const missingDocumentKeys: string[] = [];
  const reconsentDocumentKeys: string[] = [];
  const firstTimeDocumentKeys: string[] = [];

  for (const doc of required) {
    const acceptedVersions = acceptedVersionsByKey.get(doc.pageKey) ?? [];
    if (acceptedVersions.includes(doc.docVersion)) continue;

    missingDocumentKeys.push(doc.pageKey);
    if (acceptedVersions.length > 0) {
      reconsentDocumentKeys.push(doc.pageKey);
    } else {
      firstTimeDocumentKeys.push(doc.pageKey);
    }
  }

  return {
    hasAllRequiredAcceptances: missingDocumentKeys.length === 0,
    missingDocumentKeys,
    reconsentDocumentKeys,
    firstTimeDocumentKeys,
    requiredDocuments: required,
  };
}

/**
 * True when a Postgres/PostgREST error means "migrations 099/100 haven't run
 * on this database yet" (undefined table or undefined column), as opposed to
 * any other failure that should still surface as a real error.
 */
export function isMissingLegalSchemaError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  // 42P01 = undefined_table (legal_acceptances / managed_page_versions absent).
  // 42703/PGRST200/PGRST204 = undefined column (099's managed_pages columns absent).
  return (
    error.code === '42P01' ||
    error.code === '42703' ||
    error.code === 'PGRST200' ||
    error.code === 'PGRST204'
  );
}
