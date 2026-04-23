# Rollout Pages Implementation Log

Date: 2026-04-23
Branch: `rollout-pages`

## Architecture Findings

- Routing uses the Next App Router under `app/`.
- Admin routes are guarded by `app/admin/layout.tsx`, which calls `verifyAdmin()`.
- Admin identity is a single configured `ADMIN_USER_ID` in `lib/supabase/admin.ts`.
- Global settings are mostly stored in Supabase `feature_flags` and read/written through server actions.
- Pricing runtime state uses `pricing_snapshot_enabled` to decide whether live plan/wallet state is visible.
- The app has no existing CMS, legal-page system, blog/news page system, docs page system, or reusable public footer.
- Existing public routes include `/`, `/gallery`, `/wallet`, `/signed-out`, `/story/[id]`, `/storyline/[id]`, `/explore/[id]`, `/auth/*`, `/api/*`, and `/admin/*`.
- Existing content editing patterns are textarea-based admin screens with immediate server-action saves.
- Story and media persistence uses Supabase tables plus `story-assets` and `public-storylines` storage buckets.
- Public storylines, saved storylines, likes, views, wallet coins, and video export are implemented.
- Self-serve account deletion is not implemented.
- Self-serve subscription cancellation or plan switching is not implemented; Razorpay subscription changes are explicitly deferred.

## Decisions

- Managed rollout pages will use root slugs such as `/privacy`, `/terms`, `/faq`, and `/docs`.
- Root slugs will be validated against reserved app route segments to avoid route collisions.
- FAQ default visibility will use `billing_enabled_only`, resolved from `pricing_snapshot_enabled`.
- Docs will be admin-only, hidden from non-admin users, and opened in a new tab from the footer.
- Page content will be stored as markdown-like plain text and rendered as React text nodes, not raw HTML.
- Seed content will stay cautious where product behavior is incomplete or legally sensitive.
- Page edits will save immediately; `enabled` and `showInFooter` are the rollout controls for v1.
- Pricing audit tables remain pricing-only. Managed pages use `updated_at` and `updated_by` for v1 audit fields.

## Page Registry Design

- `managed_pages` stores the 11 system pages keyed by stable `page_key`.
- Stored fields cover title, slug, enabled state, footer visibility/order, new-tab behavior, access level, page type, seed version, content, excerpt, metadata, system-page marker, and update audit fields.
- Access levels are `public`, `authenticated`, `admin`, and `billing_enabled_only`.
- Page types are `rich_text`, `blog_index`, `docs_index`, `faq`, and `legal`.
- Seed definitions live in `lib/managed-pages/registry.ts`; reset-to-seed uses the registry rather than hardcoded UI text.
- Content is markdown-like plain text. Runtime rendering converts headings, paragraphs, and bullet lists to React nodes and replaces `{{SUPPORT_EMAIL}}` from `SUPPORT_EMAIL`.

## Permission Model Used

- Admin editing is protected by existing `verifyAdmin()` and the admin layout guard.
- Public route access is resolved server-side through `getAllowedManagedPageBySlug()`.
- Disallowed, disabled, reserved, or missing managed pages return `notFound()`.
- Footer links are loaded through a server action and filtered with the same access helper used by route guards.
- Footer presentation uses compact, product-facing labels, centered inline alignment, no footer brand mark, and wrapping behavior for mobile.
- Footer loading now uses a short server cache plus sessionStorage client cache to avoid repeated managed-page reads and reduce refresh-time footer delay.
- FAQ visibility is tied to `pricing_snapshot_enabled`.
- Docs use `accessLevel = admin`, stay hidden for non-admin footer viewers, and open in a new tab for admins.

## Seeded Content Grounding Notes

- Privacy and legal seeds mention Supabase Auth/database/storage, Google Gemini AI usage, Razorpay billing when enabled, public storylines/gallery, likes/views, wallet/coins, signed/private assets, and generated media.
- Refund/cancellation and FAQ seeds explicitly avoid claiming self-serve cancellation, subscription switching, refunds, or full account billing management.
- Account deletion seed states that full account deletion is not self-serve yet and routes users to support.
- Content policy seed only claims existing admin unpublish/delete capabilities and does not promise a public reporting/moderation workflow.
- Blog/news seed is modest and limited to implemented product areas: story creation, gallery, wallet/pricing foundation, narration voices, video export, and admin settings.
- All policy/legal copy is starter draft content and still requires founder/legal review.

## Files Touched

- `supabase/migrations/032_managed_pages.sql`
- `supabase/migrations/032_managed_pages_rollback.sql`
- `lib/types/database.ts`
- `lib/managed-pages/types.ts`
- `lib/managed-pages/registry.ts`
- `lib/managed-pages/access.ts`
- `lib/managed-pages/service.ts`
- `lib/managed-pages/render.tsx`
- `app/[slug]/page.tsx`
- `app/actions/managed-pages.ts`
- `components/admin/ManagedPagesSettings.tsx`
- `components/layout/ManagedFooter.tsx`
- `app/admin/settings/pages/page.tsx`
- `components/admin/AdminSidebar.tsx`
- `components/admin/GlobalSettings.tsx`
- `.env.example`

## Verification

- `npm run lint` passes with two pre-existing `KissagoLogo` anchor warnings.
- `npm run build` passes.

## Open Questions

- Founder/legal review is still required before public rollout.
- A real support email must be configured in `SUPPORT_EMAIL` before contact and deletion pages are considered rollout-ready.

## Follow-Up Recommendations

- Add full managed-page history/audit if non-admin page editors are introduced later.
- Add a richer docs/blog content model only after rollout pages stabilize.
- Add self-serve account deletion and subscription management before tightening legal wording around those workflows.
