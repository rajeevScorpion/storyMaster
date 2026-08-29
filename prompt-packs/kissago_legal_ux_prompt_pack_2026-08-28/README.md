# Kissago Auth UX + Legal & Safety Prompt Pack

Prepared: 28 August 2026
Status: **Seed implementation and legal drafting pack — requires codebase audit and final legal review before production publication.**

## Purpose
This pack instructs an AI coding agent to:

1. Audit Kissago's current authentication, account creation, legal-content, footer, profile-menu, subscription, AI-content and child/family flows.
2. Improve the sign-in/sign-up UI so it feels visually consistent with Kissago's magical storytelling identity.
3. Replace the current heavy footer legal navigation with a cleaner **Help & Legal** destination while preserving public access to Terms and Privacy before authentication.
4. Introduce robust, versioned acceptance of the **Terms of Service & End User Licence Agreement (EULA)** during account creation.
5. Move legal content away from slow runtime CMS/admin loading into a fast, versioned, reliable source-of-truth with offline/fallback rendering.
6. Seed comprehensive legal-policy content tailored to an AI storytelling platform serving families, educators, creators and children under adult supervision.
7. Add consent/version auditability, re-consent logic, accessibility and QA.

## Critical product/legal recommendation
Do **not** pre-tick the required sign-up acceptance checkbox. The legal document modal does **not** need to be opened before sign-up, but the user should take an affirmative action by checking the box. For existing users, a compact “By continuing…” notice is sufficient unless a material policy update requires re-acceptance.

Because Kissago is intended for families and children, the safest default architecture is:
- the **account holder is an adult (18+)**;
- a child uses Kissago under a parent/guardian or authorised educator account/profile;
- if the current code permits a minor to independently create an account, the coding agent must flag that as a legal/product blocker and document the current flow before changing it.

## Recommended information architecture
### Auth / public surfaces
Keep only contextual links where legally needed:
- Terms & EULA
- Privacy & Data Notice
- Help / Support

Do not restore the current multi-item footer on authentication screens.

### Signed-in profile menu
Create one primary entry:
**Help & Legal**

Inside it:
1. Help & Support
2. Terms of Service & EULA
3. Privacy & Data Notice
4. AI, Content & Rights Policy
5. Safety, Community & Grievance Policy
6. Policy version / “Last updated” information

“News” should not live in the legal/footer area. If the product still needs news/updates, place it under About, Updates, or a separate marketing-site route.

## Suggested execution order
Run the prompts in `/prompts` in this order:

1. `01_CODEBASE_AUDIT.md`
2. `02_AUTH_UI_AND_CONSENT_IMPLEMENTATION.md`
3. `03_LEGAL_CENTER_AND_CONTENT_ARCHITECTURE.md`
4. `04_CONSENT_VERSIONING_AND_DATA_MODEL.md`
5. `05_QA_SECURITY_ACCESSIBILITY.md`

Then reconcile the seed documents in `/seed_content` against actual code, vendors, payment providers, databases, storage, analytics, AI providers, public-sharing features and age/account flows.

## Seed legal documents
- `seed_content/TERMS_EULA_SEED.md`
- `seed_content/PRIVACY_DATA_NOTICE_SEED.md`
- `seed_content/AI_CONTENT_RIGHTS_SEED.md`
- `seed_content/SAFETY_SUPPORT_GRIEVANCE_SEED.md`

## UX copy
- `microcopy/AUTH_AND_LEGAL_MICROCOPY.md`

## Legal implementation notes
- `legal_notes/INDIA_AND_CHILD_PRIVACY_IMPLEMENTATION_NOTES.md`

## Non-negotiable instruction to the coding agent
Do not publish placeholders. Any bracketed item such as `[LEGAL ENTITY]`, `[SUPPORT EMAIL]`, `[REGISTERED ADDRESS]`, `[PAYMENT PROCESSOR]`, `[AI PROVIDER]`, `[JURISDICTION]`, or `[EFFECTIVE DATE]` must be either:
1. replaced from verified code/config/company information; or
2. raised as an explicit unresolved item in the implementation report.

Do not invent company identity, addresses, vendor names, retention periods, refund commitments, grievance contacts or security claims.
