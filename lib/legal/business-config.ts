/**
 * The single source of truth for Kissago's legal/business identity — entity
 * name, registered address, jurisdiction, contact aliases, and the Grievance
 * Officer required under India's IT Rules, 2021. Every legal document seed in
 * `lib/managed-pages/registry.ts` interpolates from here rather than hardcoding
 * these facts inline, so a change (new address, new Grievance Officer) is a
 * one-file edit instead of a four-document find-and-replace.
 *
 * These are public facts, not secrets, and are identical across dev and prod —
 * unlike SUPPORT_EMAIL (see lib/managed-pages/service.ts's getSupportEmail),
 * they are plain constants rather than environment variables.
 *
 * Values verified 2026-08-29 against Aavriti Design Studio's registration and
 * the prompt pack's supplied facts. Changing any of these is a business/legal
 * decision, not a code change — update here, then republish each affected
 * document through the admin "Publish version" workflow so the new text is
 * captured under a new doc_version.
 */

export const LEGAL_ENTITY_NAME = 'Aavriti Design Studio';
export const LEGAL_ENTITY_TYPE = 'Partnership Firm';
export const LEGAL_ENTITY_JURISDICTION = 'India';
export const LEGAL_GSTIN = '24ACLFA8196N1ZN';

export const LEGAL_ADDRESS_LINE_1 = 'B601, Kunj Heights';
export const LEGAL_ADDRESS_LINE_2 = 'Vavol';
export const LEGAL_CITY = 'Gandhinagar';
export const LEGAL_STATE = 'Gujarat';
export const LEGAL_POSTAL_CODE = '382016';
export const LEGAL_COUNTRY = 'India';
export const LEGAL_FULL_ADDRESS =
  `${LEGAL_ENTITY_NAME}, ${LEGAL_ADDRESS_LINE_1}, ${LEGAL_ADDRESS_LINE_2}, ` +
  `${LEGAL_CITY}, ${LEGAL_STATE} ${LEGAL_POSTAL_CODE}, ${LEGAL_COUNTRY}`;

export const GOVERNING_LAW = 'India';
export const JURISDICTION_CITY = 'Gandhinagar';
export const JURISDICTION_STATE = 'Gujarat';

/**
 * Public-facing contact aliases. Each may currently forward to the same
 * administrative mailbox; the split exists so a future dedicated mailbox per
 * concern needs no legal-text or code change. SUPPORT_EMAIL stays an
 * environment variable (see getSupportEmail()) — everything below is a fixed
 * kissago.cc alias, not environment-specific.
 */
export const LEGAL_EMAIL = 'legal@kissago.cc';
export const PRIVACY_EMAIL = 'privacy@kissago.cc';
export const SECURITY_EMAIL = 'security@kissago.cc';
export const GRIEVANCE_EMAIL = 'grievance@kissago.cc';
export const REPORT_EMAIL = 'report@kissago.cc';
export const COPYRIGHT_EMAIL = 'copyright@kissago.cc';

export const GRIEVANCE_OFFICER_NAME = 'Rajeev Kumar';
export const GRIEVANCE_OFFICER_TITLE = 'Partner & Grievance Officer';

/** Stamped on v1.0.0 of all four legal documents at first publish. */
export const LEGAL_INITIAL_DOC_VERSION = '1.0.0';
export const LEGAL_INITIAL_EFFECTIVE_DATE = '2026-08-29';

/** Accounts may only be independently created and controlled by adults. */
export const ACCOUNT_HOLDER_MINIMUM_AGE = 18;

export const PRIMARY_MARKET = 'India';
export const INTERNATIONAL_EXPANSION_PLANNED = true;
