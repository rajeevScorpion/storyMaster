import 'server-only';

import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { cookies } from 'next/headers';

import { MANAGED_PAGES_CACHE_TAG } from '@/lib/managed-pages/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { ManagedPageAcceptanceKind } from '@/lib/managed-pages/types';
import {
  buildAcceptanceFingerprint,
  CONSENT_COOKIE_MAX_AGE_SECONDS,
  CONSENT_COOKIE_NAME,
  encodeConsentCookie,
} from '@/lib/legal/consent-cookie';

/**
 * Migrations are applied by hand per environment (see WORKING_AGREEMENTS.md),
 * so this module must run against a database that hasn't seen 099/100 yet.
 * Dedicated latch for this migration group only -- per GOTCHAS.md, reusing
 * another group's latch (e.g. the gallery's discovery/series ones) would fail
 * an unrelated surface closed for the wrong reason.
 */
let legalSchemaUnavailable = false;

function isMissingLegalSchemaError(error: { code?: string; message?: string } | null | undefined): boolean {
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

function latchLegalSchemaUnavailable(context: string): void {
  if (legalSchemaUnavailable) return;
  legalSchemaUnavailable = true;
  console.warn(
    `Legal consent schema unavailable (migrations 099/100 not applied); ${context} stays inert until they're applied.`
  );
}

export interface RequiredLegalDocument {
  pageKey: string;
  docVersion: string;
  acceptanceKind: ManagedPageAcceptanceKind;
  reacceptanceRequired: boolean;
}

async function fetchRequiredLegalDocumentsUncached(): Promise<RequiredLegalDocument[]> {
  if (legalSchemaUnavailable) return [];

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('managed_pages')
    .select('page_key, enabled, doc_version, acceptance_kind, reacceptance_required, requires_acceptance')
    .eq('requires_acceptance', true);

  if (error) {
    if (isMissingLegalSchemaError(error)) {
      latchLegalSchemaUnavailable('required-document lookup');
      return [];
    }
    throw new Error(`Failed to load required legal documents: ${error.message}`);
  }

  return (data ?? [])
    .filter(
      (row): row is typeof row & { doc_version: string; acceptance_kind: ManagedPageAcceptanceKind } =>
        Boolean(row.enabled && row.doc_version && row.acceptance_kind)
    )
    .map((row) => ({
      pageKey: row.page_key,
      docVersion: row.doc_version,
      acceptanceKind: row.acceptance_kind,
      reacceptanceRequired: Boolean(row.reacceptance_required),
    }));
}

const cachedRequiredLegalDocuments = unstable_cache(
  fetchRequiredLegalDocumentsUncached,
  ['required-legal-documents'],
  { revalidate: 300, tags: [MANAGED_PAGES_CACHE_TAG] }
);

/** Every currently-published document that gates entry. Empty (never throws) on an un-migrated database. */
export const getRequiredLegalDocuments = cache(
  async (): Promise<RequiredLegalDocument[]> => cachedRequiredLegalDocuments()
);

async function fetchUserAcceptedVersions(userId: string): Promise<Map<string, string[]>> {
  const accepted = new Map<string, string[]>();
  if (legalSchemaUnavailable) return accepted;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('legal_acceptances')
    .select('document_key, document_version')
    .eq('user_id', userId);

  if (error) {
    if (isMissingLegalSchemaError(error)) {
      latchLegalSchemaUnavailable('acceptance-state lookup');
      return accepted;
    }
    throw new Error(`Failed to load legal acceptance state: ${error.message}`);
  }

  for (const row of data ?? []) {
    const versions = accepted.get(row.document_key) ?? [];
    versions.push(row.document_version);
    accepted.set(row.document_key, versions);
  }

  return accepted;
}

export interface LegalAcceptanceState {
  hasAllRequiredAcceptances: boolean;
  /** page_key of every required document the user has not accepted at its current version. */
  missingDocumentKeys: string[];
  requiredDocuments: RequiredLegalDocument[];
}

/** Never cached: this is a per-user, must-be-live answer. */
export async function getUserAcceptanceState(userId: string): Promise<LegalAcceptanceState> {
  const [required, accepted] = await Promise.all([
    getRequiredLegalDocuments(),
    fetchUserAcceptedVersions(userId),
  ]);

  const missingDocumentKeys = required
    .filter((doc) => !(accepted.get(doc.pageKey) ?? []).includes(doc.docVersion))
    .map((doc) => doc.pageKey);

  return {
    hasAllRequiredAcceptances: missingDocumentKeys.length === 0,
    missingDocumentKeys,
    requiredDocuments: required,
  };
}

export type LegalAcceptanceSurface = 'email_signup' | 'oauth_onboarding' | 'reconsent_modal' | 'admin_backfill';

export interface RecordLegalAcceptanceInput {
  /** page_key values to accept in this call, e.g. ['terms', 'privacy_policy'] for one checkbox covering both. */
  documentKeys: string[];
  surface: LegalAcceptanceSurface;
  locale?: string;
}

/**
 * The only write path for legal_acceptances. Identity and document_version are
 * both resolved server-side -- the client only ever names *which* documents it
 * is accepting, never at what version, so a version string can't be forged.
 * Idempotent via the table's UNIQUE(user_id, document_key, document_version).
 */
export async function recordLegalAcceptance(input: RecordLegalAcceptanceInput): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error('Cannot record legal acceptance without an authenticated user.');
  }

  if (legalSchemaUnavailable) {
    latchLegalSchemaUnavailable('acceptance write');
    return;
  }

  const required = await getRequiredLegalDocuments();
  const requiredByKey = new Map(required.map((doc) => [doc.pageKey, doc]));

  const rows = input.documentKeys
    .map((key) => requiredByKey.get(key))
    .filter((doc): doc is RequiredLegalDocument => Boolean(doc))
    .map((doc) => ({
      user_id: user.id,
      document_key: doc.pageKey,
      document_version: doc.docVersion,
      acceptance_type: doc.acceptanceKind,
      surface: input.surface,
      locale: input.locale ?? null,
    }));

  if (rows.length > 0) {
    const admin = createAdminClient();
    const { error } = await admin
      .from('legal_acceptances')
      .upsert(rows, { onConflict: 'user_id,document_key,document_version', ignoreDuplicates: true });

    if (error) {
      if (isMissingLegalSchemaError(error)) {
        latchLegalSchemaUnavailable('acceptance write');
        return;
      }
      throw new Error(`Failed to record legal acceptance: ${error.message}`);
    }
  }

  await refreshConsentCookieIfCompliant(user.id);
}

/**
 * Sets kissago_legal_ok only when the user is now fully compliant with every
 * required document -- a partial acceptance (e.g. one of two required
 * documents in an unusual client bug) must not produce a cookie that reads as
 * "fully accepted". Safe to call from any Server Action; cookies() is a no-op
 * write target outside that context and callers here are always one.
 */
async function refreshConsentCookieIfCompliant(userId: string): Promise<void> {
  const state = await getUserAcceptanceState(userId);
  if (!state.hasAllRequiredAcceptances) return;

  const fingerprint = buildAcceptanceFingerprint(
    state.requiredDocuments.map((doc) => ({ documentKey: doc.pageKey, documentVersion: doc.docVersion }))
  );
  const cookieValue = encodeConsentCookie(userId, fingerprint);
  if (!cookieValue) return;

  const cookieStore = await cookies();
  cookieStore.set(CONSENT_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: CONSENT_COOKIE_MAX_AGE_SECONDS,
    path: '/',
  });
}
