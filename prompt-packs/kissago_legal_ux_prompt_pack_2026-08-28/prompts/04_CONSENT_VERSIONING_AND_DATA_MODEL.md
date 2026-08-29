# Prompt 04 — Legal Acceptance, Versioning and Re-consent Data Model

Implement legally useful, privacy-conscious evidence of agreement without collecting unnecessary data.

## Separate concepts
Do not collapse all of the following into one generic `consent=true` field:

1. **Contract acceptance** — Terms of Service & EULA.
2. **Privacy notice acknowledgement** — evidence that the notice was presented/acknowledged.
3. **Optional consent** — marketing, optional analytics, training use of private content, etc., only if applicable.
4. **Parental/guardian consent** — separate high-assurance flow if direct child accounts are supported.

## Recommended data model
Adapt to the existing database naming conventions. A normalized model is preferred.

Example fields for `legal_acceptances`:
- `id`
- `user_id`
- `document_key` (`terms_eula`, `privacy_notice`, etc.)
- `document_version`
- `accepted_at` (server timestamp)
- `acceptance_type` (`accepted`, `acknowledged`)
- `surface` (`email_signup`, `google_oauth_onboarding`, `reconsent_modal`, `native_app`, etc.)
- `locale`
- `app_version` or web build identifier if readily available
- `created_at`

Avoid storing raw IP addresses solely for contract evidence unless a verified legal/business need exists. If current security logs already retain IP data, document that separately rather than duplicating it into legal acceptance records.

## Server-authoritative acceptance
- Write acceptance server-side after identity is established.
- Do not rely on localStorage/cookies as the canonical record.
- Acceptance write and account activation should be transactionally or logically linked so a user cannot enter the app while required acceptance is missing.
- Repeated writes should be idempotent for the same user/document/version.

## Version manifest
For each legal document define:
- current version;
- effective date;
- whether acceptance is required;
- whether **re-acceptance** is required for existing users.

Example policy:
- typo/formatting/legal contact update: no re-acceptance;
- material change to user obligations, content licence, subscriptions, dispute terms, AI use of content, child/account model or data purpose: re-acceptance required.

## Re-consent experience
If the user is signed in and lacks acceptance for a required current Terms/EULA version:
- block entry into the app after authentication;
- show a clear `We updated our Terms` modal/screen;
- provide `Review Terms` and `Agree & continue`;
- link Privacy notice if changed;
- record acceptance of the exact version;
- do not use manipulative countdowns or dark patterns.

## Withdrawal/deletion
Where optional privacy consent exists, provide an appropriate withdrawal mechanism without affecting unrelated necessary service processing.

Account deletion must not simply delete evidence that must legitimately be retained for legal/accounting/security obligations. Determine the appropriate retention treatment with the final privacy/legal review and document it.

## Tests
Add tests for:
- email sign-up cannot complete without required Terms acceptance;
- Google sign-up cannot bypass the acceptance gate;
- existing sign-in does not require checkbox every time;
- material version change triggers re-acceptance;
- non-material version change does not trigger it;
- acceptance records use server timestamps and correct version;
- user cannot forge a version string from the client;
- legal modal can be opened without changing checkbox state unless user explicitly clicks Agree;
- privacy notice acknowledgement is not recorded as optional marketing consent.

## Deliverable
Create `/docs/legal-consent-model.md` describing schema, API flow, versioning and re-consent logic.
