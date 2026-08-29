# Auth & Legal UX — Release Checklist

Date: 2026-08-29
Scope: Prompt 05 of `prompt-packs/kissago_legal_ux_prompt_pack_2026-08-28/` (Phase 8, the final gate
before promoting `dev` → `main`)

This is the closing checklist for the legal/auth UX pack (Phases 0–7, merged into `dev` as commit `b2092ea`,
plus the follow-on work in this doc). It records what's verified, what's deliberately out of scope by the
owner's explicit call, and what still requires the owner to run it by hand.

---

## Scope decision: accessibility

**The owner reviewed the interface directly and made the call to skip a formal WCAG 2.2 AA audit.** Full
WCAG conformance testing is stricter than this product needs right now, and the owner's own visual review
found the interface acceptable. Accordingly:

- No dedicated a11y audit pass, no automated axe-core scan, no 200%-zoom reflow check, and no screen-reader
  pass were performed for this release.
- What *is* already in place, because it was built into the components rather than bolted on: `role="dialog"
  aria-modal`, a real focus trap and Escape handling on the auth dialog (`e2e/auth-dialog.spec.ts` verifies
  the trap and focus-restore mechanically), `role="tablist"/"tab"` with `aria-selected` on the sign-in/create
  toggle, and a real `<input type="checkbox">` (not a styled div) for the agreement gate.
- Any accessibility issue that is **critical and non-visual** (e.g. something that would make a core flow
  unusable via keyboard or screen reader, not a contrast or spacing nitpick) should still be raised if found
  later — the scope decision here is about deferring a *strict, exhaustive* audit, not about ignoring a
  broken flow.

## Automated verification — run 2026-08-29

```
npx tsc --noEmit      -> clean
npm run lint          -> clean
npm test              -> 86 files, 594 tests passed
npm run build:verify  -> succeeded (.next-verify)
npm run test:e2e      -> 14 passed
```

New tests added in this pass, closing gaps against the pack's own Prompt 05 test list:

| Test | File | Covers |
|---|---|---|
| Unit | `lib/legal/consent.shared.test.ts` | Acceptance-state classification (satisfied / first-time / reconsent) and the missing-migration error classifier (`42P01`/`42703`/`PGRST200`/`PGRST204`) |
| Unit | `lib/legal/consent-cookie.test.ts` *(pre-existing)* | Consent-cookie HMAC round-trip, forged/tampered/wrong-user/wrong-secret rejection |
| Unit | `lib/auth/safe-redirect.shared.test.ts` *(pre-existing)* | OAuth callback `next` allow-list — rejects `//evil.com`, absolute URLs, non-http(s) schemes, backslash tricks |
| Unit | `lib/managed-pages/registry.legal-content.test.ts` *(pre-existing)* | No leftover `[BRACKET]` placeholders in any of the four legal documents; each renders without throwing |
| Unit | `lib/managed-pages/render.shared.test.tsx` *(pre-existing)* | Block/inline parser — headings, lists, tables, inline bold/code/links |
| E2E | `e2e/auth-dialog.spec.ts` *(pre-existing)* | Focus trap + Escape + focus-restore; checkbox blocks sign-up until checked; opening Terms doesn't tick the box, Agree does |
| E2E | `e2e/legal-pages.spec.ts` *(new)* | `/terms` and `/privacy` actually render headings/bold for a signed-out visitor; footer links resolve correctly; Help & Legal lists both documents |
| E2E | `e2e/navigation-progress.spec.ts` *(new)* | Progress bar fires on a real footer-link navigation and clears after; does not fire for a same-page link |

**Not unit-tested, deliberately:** the `changeType === 'material'` decision in
`lib/managed-pages/versioning.ts` is a one-line ternary with no branching logic worth isolating — reviewed by
reading, not by a dedicated test.

## Security review

- **Renderer emits React elements/text nodes only** (`lib/managed-pages/render.shared.tsx`) — no
  `dangerouslySetInnerHTML`, no markdown dependency, no sanitizer needed. Confirmed by reading the file: every
  branch returns JSX or a plain string push, never an HTML string.
- **Document version cannot be client-forged.** `recordLegalAcceptance()` (`lib/legal/consent.ts`) resolves
  `document_version` from `managed_pages` server-side; the client only ever names *which* document keys it is
  accepting. Covered indirectly by `consent.shared.test.ts`'s classification tests and directly by the design
  itself (there is no code path that accepts a version string as input).
- **The OAuth callback cannot skip the gate.** `sanitizeInternalRedirectPath()` closes the open-redirect in
  `app/auth/callback/route.ts`, and `proxy.ts`'s `checkLegalConsentForRequest` is a second, independent
  backstop — a user who reaches any page other than `/auth/*`/`/help-legal`/the legal slugs without full
  acceptance is redirected regardless of how they got there.
- **No IP address or user-agent collection was added.** `legal_acceptances` (migration 100) has no
  `ip_address` or `user_agent` column, by design — verified by reading the migration file, not assumed.
- **No secrets in legal pages or the client bundle.** The four documents' content is business-config
  constants (`lib/legal/business-config.ts`) and static text — nothing environment- or credential-shaped.
- **Consent cookie (`kissago_legal_ok`) is HttpOnly, Secure, SameSite=Lax**, and is a cache over the DB
  record, never the record itself — `consent-cookie.test.ts` proves a forged or stale-fingerprint cookie is
  rejected and falls through to a live DB check.

## Manual QA — owner-run (not automatable from here)

These need a real browser session with real credentials (Google OAuth) and are explicitly **not** attempted
by this checklist:

- [ ] Email sign-up end-to-end: checkbox gate, acceptance recorded, cookie set.
- [ ] Google OAuth first-time sign-in: lands on `/auth/accept-terms`, agreeing redirects to the original
      destination.
- [ ] Google OAuth returning user (already accepted): no gate shown.
- [ ] Password reset flow still works unaffected by the redesigned `AuthDialog`.
- [ ] Re-consent: publish a `material` version of one document from `/admin/settings/pages`, confirm a
      previously-accepted user is redirected to re-accept and a `minor` publish does *not* trigger this.
- [ ] A suspended/moderated account can still reach `/help-legal` and the legal slugs (`proxy.ts`'s
      `allowedWhileRestricted` list).

## Migration and environment status

- Migrations 099, 100, 101 are applied on **both** dev and production (verified directly against each
  database's `public.schema_migration_ledger`, not inferred).
- The four legal documents are published at `doc_version 1.0.0` and `legal_consent_gate_enabled` is **on**
  on dev; on production the migrations are applied but the documents are not yet published and the gate is
  **off** — see `docs/agent-context/PROJECT_STATE.md` for the exact steps to mirror dev's publish state to
  prod before enabling the gate there.

## Explicitly deferred (not part of this release)

- **Age assurance / verifiable parental consent.** This pack implements an adults-hold-the-account policy
  (self-declared 18+ via the sign-up checkbox) — real age verification is a separate, larger product decision
  and was never in scope here.
- **A full WCAG 2.2 AA audit** — owner's explicit call, recorded above.
- **A native "optional consent" flow** (marketing, analytics) — `legal_acceptances` deliberately only covers
  contract acceptance and notice acknowledgement; an optional-consent flow would need its own table if built.

## Promotion readiness

With the items above, the pack is ready to promote `dev` → `main` per WORKING_AGREEMENTS (`--no-ff`), on the
understanding that the manual QA checklist above still needs an owner pass at a time of their choosing —
promotion to `main` puts the code in front of the deploy pipeline, not in front of real production traffic
with the gate on (the gate stays off on production until the owner explicitly publishes the documents there
and flips it, exactly as on dev).
