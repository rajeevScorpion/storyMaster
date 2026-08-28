# Prompt 02 — Authentication UI, Magical Visual Treatment and Agreement Flow

Use the completed `/docs/legal-auth-audit.md` as the factual source. Preserve existing functional auth behaviour unless a change is explicitly required below.

## Product goal
Improve the Kissago sign-in/sign-up experience so it feels premium, calm and magical rather than generic, while retaining clarity, accessibility and fast performance.

## Visual direction
The current auth card is structurally good but the large white CTA buttons and white selected segmented-control states feel visually disconnected from the Kissago brand.

Implement the following using **existing Kissago design tokens/components whenever possible**:

### Card / modal
- Preserve the dark, elegant card and rounded geometry.
- Add a subtle brand-colour aura around the card using layered radial glow / box-shadow / pseudo-element, not a harsh neon outline.
- Reuse the exact primary brand colour already used by Kissago’s main “Create” CTA. Do not invent a new green if a design token exists.
- Add a very faint internal highlight or gradient so the card feels dimensional and story-like.
- Keep body background subdued so the form remains readable.
- If adding animation, use an extremely slow ambient movement only. Respect `prefers-reduced-motion` and disable decorative motion for users requesting reduced motion.

### Primary CTA
- Replace the large white `Sign in` and `Create account` buttons with the existing Kissago primary CTA treatment.
- Hover/focus/pressed/loading/disabled states must be clear.
- Keep sufficient contrast and do not rely on glow alone to indicate state.

### Sign-in/Create-account segmented switch
- Remove the bright white filled selected tab if it conflicts with the rest of the product.
- Use a dark/tinted selected surface with brand border/highlight/glow, or reuse an existing Kissago segmented-control component.
- Keyboard navigation and visible focus states are mandatory.

### Fields
- Retain low-contrast dark inputs but strengthen focus state with the brand accent.
- Improve placeholder/label contrast where needed.
- Keep icons subtle.
- Preserve password-manager/autofill compatibility.

### Google auth
- Keep Google as a visually secondary/neutral action.
- Use the correct Google identity icon/branding if already available.
- Do not make the Google action compete visually with the primary Kissago CTA.

## Sign-up agreement UX

### Required checkbox
Add a required, **unchecked by default** checkbox immediately above the primary `Create account` CTA:

> I agree to the **Terms & End User Licence Agreement** and acknowledge the **Privacy & Data Notice**.

Both document names are interactive links.

Rules:
- The checkbox itself is the affirmative act. It must not be pre-checked.
- Opening either document is optional; do not force the user to open or scroll through the legal document before they can check the box.
- `Create account` remains disabled until the checkbox is checked and all existing form validation passes.
- Display a compact validation message if submission is attempted without acceptance.
- Acceptance of Terms/EULA and acknowledgement of Privacy must not be used as a substitute for any separate consent required for optional marketing, optional analytics or optional AI-training uses.

### Legal document modal
When the Terms/EULA or Privacy link is clicked:
- open a large responsive modal/sheet, not a new blocking page;
- render local/versioned legal content immediately;
- include title, version and effective date;
- use a comfortable reading width, headings, bullets and anchor navigation where appropriate;
- mobile: use a full-height sheet with sticky header and close button;
- desktop: use a large centered modal with max-height and internal scrolling;
- optionally show an `Agree` action in the Terms modal which checks the sign-up box and closes the modal;
- do not require scroll-to-end as a fake proof of reading;
- preserve keyboard focus, trap focus correctly and return focus to the originating link on close.

### Google/OAuth sign-up
The legal gate must apply equally to OAuth-created accounts.

Audit the existing auth behaviour and implement one of these correctly:
1. acceptance before initiating OAuth **plus** server-side verification that the acceptance version is recorded after OAuth returns; or
2. if the auth provider creates the user before return, route first-time users into a mandatory post-OAuth onboarding gate and prevent access to the product until acceptance is persisted.

Do not rely solely on a localStorage/session flag as the legal record.

## Sign-in legal notice
For existing accounts, do not add a mandatory checkbox on every login. Add small copy below the CTA or form:

> By continuing, you agree to the current **Terms & EULA** and acknowledge the **Privacy Notice**.

If a material legal version has changed and re-acceptance is required, interrupt access with a dedicated update modal after authentication but before the user reaches the app.

## Child/family note
If the audit confirms adult-managed accounts, add discreet sign-up copy:

> Accounts are for adults. Children can use Kissago under a parent, guardian or authorised educator.

If direct child accounts exist, do not insert misleading copy; escalate to the child-account implementation plan instead.

## Public access
Even after footer simplification, Terms and Privacy must remain accessible to logged-out users through the auth copy and a minimal public legal route.

## Deliverables
- implemented auth redesign;
- screenshots at common desktop and mobile breakpoints;
- documented components/tokens changed;
- no regression to password reset, email verification, OAuth, deep links or native-web handoff;
- update `/docs/legal-auth-audit.md` with final behaviour.
