-- 032_managed_pages.sql
-- Managed system pages for rollout legal/support/blog/docs/footer links.

CREATE TABLE IF NOT EXISTS public.managed_pages (
  page_key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  show_in_footer BOOLEAN NOT NULL DEFAULT true,
  footer_order INTEGER NOT NULL DEFAULT 100,
  open_in_new_tab BOOLEAN NOT NULL DEFAULT false,
  access_level TEXT NOT NULL DEFAULT 'public'
    CHECK (access_level IN ('public', 'authenticated', 'admin', 'billing_enabled_only')),
  page_type TEXT NOT NULL DEFAULT 'rich_text'
    CHECK (page_type IN ('rich_text', 'blog_index', 'docs_index', 'faq', 'legal')),
  seed_version INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL DEFAULT '',
  excerpt TEXT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_system_page BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_managed_pages_footer
  ON public.managed_pages (show_in_footer, enabled, footer_order);

CREATE INDEX IF NOT EXISTS idx_managed_pages_access
  ON public.managed_pages (access_level, enabled);

ALTER TABLE public.managed_pages ENABLE ROW LEVEL SECURITY;

INSERT INTO public.managed_pages (
  page_key,
  title,
  slug,
  enabled,
  show_in_footer,
  footer_order,
  open_in_new_tab,
  access_level,
  page_type,
  seed_version,
  content,
  excerpt,
  metadata_json,
  is_system_page
) VALUES
(
  'privacy_policy',
  'Privacy Policy',
  'privacy',
  true,
  true,
  10,
  false,
  'public',
  'legal',
  1,
  $managed_page$
## Starter Draft - Review Before Rollout

Kissago helps users create and explore illustrated branching stories. To provide the service, Kissago collects limited account, story, media, usage, and billing information needed to run the product.

## Information Kissago Uses

- Account information from Supabase Auth, such as email address, profile name, avatar, and authentication identifiers.
- Story prompts, source text, story settings, generated story beats, choices, character details, story maps, and published storylines.
- Uploaded or generated media, including images, narration audio, public storyline covers, and exported videos created in the browser.
- Product activity such as saved storylines, likes, views, explored stories, wallet activity, and admin-controlled settings.
- Billing records when pricing is enabled, including plan, checkout, order, subscription, top-up, webhook, and coin ledger records.

## AI and Service Providers

Kissago uses AI-assisted systems for story, image, narration, and related creative features. The current codebase uses Google Gemini APIs, Supabase for authentication, database, and storage, and Razorpay for India checkout when billing is enabled.

## Retention and Deletion

Users can delete or archive individual stories in current product flows. Full account deletion is not self-serve in the current product. Data deletion requests should be sent to {{SUPPORT_EMAIL}}.
$managed_page$,
  'How Kissago handles account, story, usage, media, and billing information.',
  '{"requiresLegalReview": true}'::jsonb,
  true
),
(
  'content_usage_policy',
  'Content Usage Policy',
  'content-usage-policy',
  true,
  true,
  20,
  false,
  'public',
  'legal',
  1,
  $managed_page$
## Starter Draft - Review Before Rollout

Kissago is built for creative storytelling. Users are responsible for the prompts, source text, uploads, story choices, and published storylines they create or share through the platform.

## Acceptable Use

- Create original, respectful, lawful stories.
- Use prompts, source text, and media only when you have the right to use them.
- Review AI-assisted outputs before publishing, sharing, downloading, or using them outside Kissago.
- Keep public storylines appropriate for the audience and age settings selected during creation.

## Not Allowed

- Illegal, abusive, harassing, hateful, exploitative, or intentionally harmful content.
- Content that infringes another person's copyright, trademark, privacy, publicity, or other rights.
- Attempts to misuse the service, bypass restrictions, overload generation systems, or interfere with other users.

## Moderation and Enforcement

The current codebase includes public storylines and admin tools to unpublish or delete content. It does not include a full public reporting workflow yet. Content concerns can be sent to {{SUPPORT_EMAIL}}.
$managed_page$,
  'Rules for responsible prompts, uploads, generated stories, and shared content.',
  '{"requiresLegalReview": true}'::jsonb,
  true
),
(
  'terms',
  'Terms of Service',
  'terms',
  true,
  true,
  30,
  false,
  'public',
  'legal',
  1,
  $managed_page$
## Starter Draft - Review Before Rollout

These starter terms describe the current Kissago product and must be reviewed before public rollout. By using Kissago, users agree to use the service responsibly and only for lawful purposes.

## Accounts

Users may sign in with supported Supabase Auth methods. Users are responsible for activity under their account and should keep access to their email and credentials secure.

## The Service

Kissago provides AI-assisted interactive storytelling, generated images, narration, story saving, public storylines, gallery discovery, and optional wallet or billing features when enabled.

AI generation quality, availability, latency, and outputs can vary.

## Payments

The codebase includes wallet, coin, plan, top-up, Razorpay India checkout, and subscription mirror records. Live checkout and enforcement are controlled by admin runtime flags. Subscription changes, cancellation, and full account billing management are not self-serve in the current product.

## Content and Rights

Users are responsible for prompts, source text, uploads, and story content they submit or publish. Kissago needs permission to store, process, display, generate from, and share content as needed to operate the product.
$managed_page$,
  'Startup-practical starter terms for using Kissago.',
  '{"requiresLegalReview": true}'::jsonb,
  true
),
(
  'refund_policy',
  'Refund / Cancellation Policy',
  'refund-policy',
  true,
  true,
  40,
  false,
  'public',
  'legal',
  1,
  $managed_page$
## Starter Draft - Review Before Rollout

This policy must be finalized before live billing rollout. The current codebase supports Razorpay India subscription checkout, top-up checkout, wallet grants, payment verification, and webhook sync. It does not yet include self-serve cancellation, subscription switching, or refund management inside Kissago.

## Cancellations

Subscription cancellation is currently handled through support or provider-side/manual workflows. The self-serve account-management flow is not yet implemented.

## Plan Changes

Users cannot currently self-serve a switch from one active Razorpay subscription to another. The checkout path blocks overlapping Razorpay subscriptions and asks users to wait for manual account management.

## Refunds

Refunds are not automated in the current product. Refund requests, duplicate payment concerns, or billing disputes should be sent to {{SUPPORT_EMAIL}} for manual review. Digital usage, generated content, consumed coins, or completed top-ups may not be refundable unless required by law or approved after review.
$managed_page$,
  'Current billing limitations and support-based refund or cancellation handling.',
  '{"requiresLegalReview": true, "policyPlaceholder": true}'::jsonb,
  true
),
(
  'contact_support',
  'Contact / Support',
  'contact',
  true,
  true,
  50,
  false,
  'public',
  'rich_text',
  1,
  $managed_page$
## Contact Kissago Support

For help with Kissago, contact {{SUPPORT_EMAIL}}.

## Good Things To Include

- The email address on your Kissago account.
- The story, storyline, or page where you saw the issue.
- Screenshots or copied error text if available.
- For billing questions, include the plan, top-up, payment date, and Razorpay payment details if you have them.

## Support Topics

- Account access and sign-in help.
- Story creation, saving, gallery, sharing, narration, or video export issues.
- Billing, wallet, coins, subscriptions, top-ups, and checkout questions.
- Content concerns or requests to unpublish content.
- Privacy, deletion, and data requests.
$managed_page$,
  'Where users can ask for account, billing, technical, or content help.',
  '{"requiresSupportEmail": true}'::jsonb,
  true
),
(
  'blog_news',
  'Blog / News',
  'blog',
  true,
  true,
  60,
  false,
  'public',
  'blog_index',
  1,
  $managed_page$
## News and Product Updates

News and product updates from Kissago. This space is used to share feature releases, workflow improvements, product notes, and rollout updates.

## Rollout Pages and Footer Controls

Kissago now has a managed page system for public policies, support pages, docs, FAQ, and footer visibility. Admins can edit system pages from Global Settings.

## Story Creation Workflow

Kissago supports prompt-based story creation and seeded source-story authoring, with branching choices and saved story trees.

## Narration and Video Export

The product includes narration generation, user-led voice settings, and browser-based storyline video export when the relevant admin and plan controls allow it.

## Wallet and Pricing Foundation

Kissago includes wallet, coin, plan, top-up, and Razorpay checkout foundations. Runtime flags control when live pricing, checkout, and enforcement become visible.
$managed_page$,
  'Product notes and rollout updates from Kissago.',
  '{"editableFeed": true}'::jsonb,
  true
),
(
  'documentation',
  'Documentation',
  'docs',
  true,
  true,
  70,
  true,
  'admin',
  'docs_index',
  1,
  $managed_page$
## Internal Documentation Index

This admin-only page is a starter index for Kissago operations and rollout notes.

## Product Areas

- Story generation and branching story trees.
- Seeded source-story authoring.
- Gallery, public storylines, likes, views, and saved storylines.
- Narration voices and voice sample management.
- Storyboard image quality, reader, loader, authoring, and video export settings.
- Wallet, pricing plans, top-ups, runtime flags, Razorpay checkout, and recovery tools.
- Managed rollout pages, legal drafts, FAQ, and footer visibility.

## Known Limitations

- No self-serve account deletion flow yet.
- No self-serve subscription cancellation or plan-switching flow yet.
- No full docs platform, versioned docs, or markdown-backed docs tree yet.
$managed_page$,
  'Internal admin documentation index for the current Kissago product.',
  '{"internalOnly": true}'::jsonb,
  true
),
(
  'faq',
  'FAQ',
  'faq',
  true,
  true,
  80,
  false,
  'billing_enabled_only',
  'faq',
  1,
  $managed_page$
## Frequently Asked Questions

## What are coins?

Kissago shows user-facing wallet value as coins. Internally, the code tracks story creation using beats. One beat maps to 10 coins in the current pricing model.

## When does the FAQ appear?

This FAQ is visible when live pricing information is enabled by the `pricing_snapshot_enabled` runtime flag.

## Can I buy a subscription today?

Checkout is controlled separately by the `pricing_checkout_enabled` flag. The implemented live checkout path is Razorpay for the India market. Outside-India Stripe routing exists in configuration but is not implemented as a checkout flow in this codebase.

## Can I cancel or change my subscription inside Kissago?

Not yet. Self-serve cancellation and plan switching are not implemented. Subscription changes are currently manual until account management is built.

## Can I download stories?

Published storylines can be exported as MP4 video in the browser when the global video download setting is enabled and the user's plan or admin bypass allows downloads.
$managed_page$,
  'Frequently asked questions about plans, coins, billing, downloads, and account requests.',
  '{"billingGated": true}'::jsonb,
  true
),
(
  'ai_disclosure',
  'AI Content / AI Usage Disclosure',
  'ai-disclosure',
  true,
  true,
  90,
  false,
  'public',
  'legal',
  1,
  $managed_page$
## Starter Draft - Review Before Rollout

Kissago uses AI-assisted systems to help generate interactive story text, visual prompts, images, narration, voice choices, and related creative materials.

## What To Expect

- AI outputs can vary and may not always be accurate, complete, or appropriate for every intended use.
- Users should review stories, images, narration, and exports before publishing, sharing, or using them outside Kissago.
- Some features may depend on external AI providers. The current codebase uses Google Gemini APIs.
- Output quality, latency, cost, and availability may change as models and provider behavior change.

## User Responsibility

Users remain responsible for prompts, source text, uploads, edits, publication decisions, and any external use of generated outputs.
$managed_page$,
  'How Kissago uses AI-assisted systems for story, image, and narration features.',
  '{"requiresLegalReview": true}'::jsonb,
  true
),
(
  'copyright_licensing',
  'Copyright / Ownership / Licensing',
  'copyright-licensing',
  true,
  true,
  100,
  false,
  'public',
  'legal',
  1,
  $managed_page$
## Starter Draft - Review Before Rollout

This page needs founder and legal review before rollout. It describes intended product behavior, not final legal advice.

## User Content

Users are responsible for prompts, source text, uploads, and story choices they submit. Users should only provide content they have the right to use.

## Kissago Service Rights

Kissago needs permission to store, process, generate from, display, publish, and transmit user content and generated outputs as needed to provide the product. This includes showing public storylines in shared links and gallery experiences when users publish them.

## Generated Outputs

Kissago creates AI-assisted story text, images, narration, and video exports. Users should review outputs before using or sharing them. Some external use may be affected by laws, third-party rights, AI provider terms, or plan-specific product limits.

## Downloads and Exports

Video export exists in the product and is gated by the global video download setting plus plan or admin-bypass access. Paid plan feature flags include download and unbranded export concepts, but exact commercial-use rights should be finalized before public launch.
$managed_page$,
  'Starter guidance on user content, generated outputs, publishing, and downloads.',
  '{"requiresLegalReview": true}'::jsonb,
  true
),
(
  'account_deletion',
  'Account Deletion / Data Retention',
  'account-deletion',
  true,
  true,
  110,
  false,
  'public',
  'legal',
  1,
  $managed_page$
## Starter Draft - Review Before Rollout

Kissago does not currently include a self-serve full account deletion flow. Account deletion and data requests should be sent to {{SUPPORT_EMAIL}}.

## What Users Can Currently Manage

- Users can delete their own stories in current app flows.
- Users can archive and unarchive stories.
- Users can save or unsave public storylines.
- Admins can unpublish or delete storylines from admin content tools.

## Data That May Exist

Kissago may store account profile data, stories, beats, generated images, narration audio, story maps, public storylines, saved storylines, likes, views, wallet records, billing records, webhook events, and admin/configuration records.

## Retention

Specific retention windows are not fully defined in the current product. Some records may be retained for security, legal, billing, payment reconciliation, abuse prevention, or operational reasons.
$managed_page$,
  'Current account deletion and retention limitations.',
  '{"requiresLegalReview": true, "requiresSupportEmail": true}'::jsonb,
  true
)
ON CONFLICT (page_key) DO NOTHING;
