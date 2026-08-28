# Prompt 05 — QA, Security, Accessibility and Release Gate

Perform a final production-readiness review of the redesigned authentication and legal system.

## Functional QA
Test:
- email/password sign-up;
- email/password sign-in;
- email verification;
- forgot/reset password;
- Google OAuth existing user;
- Google OAuth first-time user;
- expired OAuth/session states;
- account already exists / duplicate email;
- sign-out;
- account deletion route;
- subscription users;
- mobile and desktop;
- native webview/deep-link behaviour if applicable.

## Agreement QA
Verify:
- checkbox is unchecked by default;
- Terms and Privacy links open the correct version;
- legal content is available while logged out;
- legal content renders without admin-backend dependency;
- required acceptance is persisted server-side;
- Terms modal `Agree` behaviour is explicit and not accidental;
- re-consent gate works for material updates;
- privacy and marketing consent are not improperly bundled;
- all bracketed placeholders are eliminated from production documents.

## Accessibility
Target WCAG 2.2 AA principles:
- full keyboard operation;
- focus visible;
- focus trap and return for modal;
- semantic labels for checkbox/fields;
- screen-reader friendly legal links;
- sufficient text/input/button contrast;
- touch targets suitable for mobile;
- no information conveyed only by glow/colour;
- `prefers-reduced-motion` support;
- zoom/reflow works for legal documents.

## Security/privacy
Verify:
- no secret config is exposed in legal pages or frontend bundles;
- legal markdown/HTML is sanitized if remote content can enter renderer;
- acceptance version cannot be client-forged;
- CSRF/session protection follows existing framework conventions;
- OAuth callback cannot skip onboarding guards;
- no unnecessary IP/fingerprint collection was added;
- analytics do not capture passwords, full story content, private prompts or sensitive form values;
- error monitoring redacts credentials/tokens;
- vendor list in Privacy matches real production use.

## Child/family gate
Before release, explicitly answer in the release report:
- Can a person under 18 independently create an account?
- If yes, what verified parent/guardian flow exists?
- Are public sharing/community features available to child profiles?
- Are targeted/personalized ads used with child data?
- Is behavioural tracking of children used?
- What content moderation/safety controls exist?

If these answers conflict with published policies, release is blocked until corrected.

## AI/SGI compliance audit
Because Kissago creates synthetic text/images/audio/video, assess with counsel whether the current Indian IT Rules on synthetically generated information apply to Kissago's exact role and features. Verify whether generated assets need visible labels, embedded metadata/identifiers, user declarations, or preservation of such metadata. Do not remove existing provenance metadata.

## Release artifacts
Create:
- `/docs/auth-legal-release-checklist.md`
- automated test summary;
- unresolved legal/business facts list;
- final screenshots;
- rollback notes;
- migration notes for legacy CMS/footer routes.
