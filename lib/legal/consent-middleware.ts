import { buildAcceptanceFingerprint, encodeConsentCookie, verifyConsentCookie } from '@/lib/legal/consent-cookie';

/**
 * proxy.ts-safe reads: raw PostgREST fetches with the service key, matching
 * the pattern already established by loadModerationForMiddleware() rather
 * than pulling supabase-js or lib/ai/model-config.ts into the middleware
 * bundle. Fails open (gate never applies) on any missing config, non-OK
 * response, or exception -- a database blip or an un-applied migration must
 * never lock a signed-in user out of the product.
 */

interface RestCredentials {
  supabaseUrl: string;
  serviceKey: string;
}

function getRestCredentials(): RestCredentials | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  return { supabaseUrl, serviceKey };
}

async function restGet<T>(path: string, query: Record<string, string>): Promise<T[] | null> {
  const credentials = getRestCredentials();
  if (!credentials) return null;

  try {
    const params = new URLSearchParams(query);
    const response = await fetch(`${credentials.supabaseUrl}/rest/v1/${path}?${params.toString()}`, {
      headers: {
        apikey: credentials.serviceKey,
        Authorization: `Bearer ${credentials.serviceKey}`,
      },
      cache: 'no-store',
    });

    if (!response.ok) return null;
    return (await response.json()) as T[];
  } catch {
    return null;
  }
}

async function isLegalConsentGateEnabled(): Promise<boolean> {
  const rows = await restGet<{ enabled?: boolean }>('feature_flags', {
    flag_key: 'eq.legal_consent_gate_enabled',
    select: 'enabled',
    limit: '1',
  });
  return Boolean(rows?.[0]?.enabled);
}

interface RequiredDocumentRow {
  page_key: string;
  doc_version: string | null;
  acceptance_kind: string | null;
}

async function fetchRequiredDocuments(): Promise<Array<{ documentKey: string; documentVersion: string }>> {
  const rows = await restGet<RequiredDocumentRow>('managed_pages', {
    requires_acceptance: 'eq.true',
    enabled: 'eq.true',
    select: 'page_key,doc_version,acceptance_kind',
  });

  return (rows ?? [])
    .filter((row): row is RequiredDocumentRow & { doc_version: string; acceptance_kind: string } =>
      Boolean(row.doc_version && row.acceptance_kind)
    )
    .map((row) => ({ documentKey: row.page_key, documentVersion: row.doc_version }));
}

async function fetchAcceptedVersions(userId: string): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const rows = await restGet<{ document_key: string; document_version: string }>('legal_acceptances', {
    user_id: `eq.${userId}`,
    select: 'document_key,document_version',
  });

  for (const row of rows ?? []) {
    const versions = map.get(row.document_key) ?? [];
    versions.push(row.document_version);
    map.set(row.document_key, versions);
  }

  return map;
}

export interface LegalConsentCheckResult {
  requiresGate: boolean;
  /** Set only when the DB confirms compliance with no valid cookie yet -- proxy.ts should (re)write it. */
  refreshedCookieValue: string | null;
}

export async function checkLegalConsentForRequest(
  userId: string,
  cookieValue: string | undefined
): Promise<LegalConsentCheckResult> {
  const inert: LegalConsentCheckResult = { requiresGate: false, refreshedCookieValue: null };

  if (!(await isLegalConsentGateEnabled())) return inert;

  const required = await fetchRequiredDocuments();
  if (required.length === 0) return inert;

  const fingerprint = buildAcceptanceFingerprint(required);

  if (verifyConsentCookie(cookieValue, userId, fingerprint)) return inert;

  const accepted = await fetchAcceptedVersions(userId);
  const isCompliant = required.every((doc) => (accepted.get(doc.documentKey) ?? []).includes(doc.documentVersion));

  if (!isCompliant) return { requiresGate: true, refreshedCookieValue: null };

  return { requiresGate: false, refreshedCookieValue: encodeConsentCookie(userId, fingerprint) };
}
