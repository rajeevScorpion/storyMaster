# Email/Password Auth Plan

Status: Phase 1 implementation in progress
Branch: `feat/email-password-auth`

## Goal

Add minimal email/password authentication alongside the existing Google sign-in flow without breaking the current experience or changing the overall Kissago visual language.

## Non-Negotiables

- Keep Google sign-in available.
- Do not break current working story creation, save, gallery, or admin flows.
- Keep the auth UI minimal and on-theme.
- Make stage testing possible without configuring Google OAuth first.

## Proposed Scope

1. Add email/password sign-in.
2. Add email/password sign-up.
3. Add password reset request flow.
4. Add password update page for recovery links.
5. Replace the unauthenticated "Sign in" button flow with a minimal auth dialog that offers:
   - Google
   - Email/password sign-in
   - Email/password sign-up
   - Password reset request
6. Preserve the existing pending prompt/config flow so users can continue after authenticating.

## Explicitly Out Of Scope

- Username-based authentication
- Billing or pricing work
- Account settings page
- Profile editing
- Full custom email templates
- OAuth provider expansion beyond the current Google support

## Open Tradeoffs To Revisit During Implementation

- Whether stage/prod require email confirmation before first sign-in
- How much error detail to expose inline versus generic auth messaging
- Whether to later add identity linking UX for Google-first users who want a password too

## Initial Verification Targets

- Existing Google sign-in still works.
- Email/password sign-up works on stage.
- Email/password sign-in works on stage.
- Password reset email request flow works on stage.
- Password update flow works on stage.
- Starting a story while signed out still resumes correctly after auth.

## Current Implementation Notes

- Auth entry now centers on a shared lightweight dialog instead of immediate Google redirect.
- Google remains available as an option inside the dialog.
- Password recovery now has a dedicated update page at `/auth/update-password`.
- Deep links and gallery save flows should now route through the same dialog-based auth experience.
