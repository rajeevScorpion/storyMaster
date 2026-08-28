import type { ManagedPageAccessLevel, ManagedPageType } from './types';

export interface ManagedPageSeedDefinition {
  pageKey: string;
  title: string;
  slug: string;
  enabled: boolean;
  showInFooter: boolean;
  footerOrder: number;
  openInNewTab: boolean;
  accessLevel: ManagedPageAccessLevel;
  pageType: ManagedPageType;
  seedVersion: number;
  excerpt: string;
  content: string;
  metadata: Record<string, unknown>;
}

export const RESERVED_ROOT_SLUGS = [
  '',
  '_next',
  'account-restricted',
  'admin',
  'api',
  'auth',
  'create',
  'explore',
  'favicon.ico',
  'gallery',
  'help-legal',
  'icon',
  'learn',
  'signed-out',
  'sounds',
  'story',
  'storyline',
  'tutorial',
  'wallet',
] as const;

const SEED_VERSION = 1;

function seed(content: string): string {
  return content.trim();
}

export const MANAGED_PAGE_DEFINITIONS: ManagedPageSeedDefinition[] = [
  {
    pageKey: 'privacy_policy',
    title: 'Privacy Policy',
    slug: 'privacy',
    enabled: true,
    showInFooter: true,
    footerOrder: 10,
    openInNewTab: false,
    accessLevel: 'public',
    pageType: 'legal',
    seedVersion: SEED_VERSION,
    excerpt: 'How Kissago handles account, story, usage, media, and billing information.',
    metadata: { requiresLegalReview: true },
    content: seed(`
## Starter Draft - Review Before Rollout

Kissago helps users create and explore illustrated branching stories. To provide the service, Kissago collects limited account, story, media, usage, and billing information needed to run the product.

## Information Kissago Uses

- Account information from Supabase Auth, such as email address, profile name, avatar, and authentication identifiers.
- Story prompts, source text, story settings, generated story beats, choices, character details, story maps, and published storylines.
- Uploaded or generated media, including images, narration audio, public storyline covers, and exported videos created in the browser.
- Product activity such as saved storylines, likes, views, explored stories, wallet activity, and admin-controlled settings.
- Billing records when pricing is enabled, including plan, checkout, order, subscription, top-up, webhook, and coin ledger records.

## AI and Service Providers

Kissago uses AI-assisted systems to generate story text, visual prompts, images, narration, and related creative outputs. The current codebase uses Google Gemini APIs for these features. Kissago uses Supabase for authentication, database, and storage, and Razorpay for India checkout when billing is enabled.

## Storage and Sharing

Private story assets are stored in Supabase storage. Published storyline covers and public storyline data can be visible to other users through the gallery or shared links. Some private asset URLs are served through signed URLs that expire.

## Retention and Deletion

Users can delete or archive individual stories in current product flows. Full account deletion is not self-serve in the current product. Data deletion requests should be sent to {{SUPPORT_EMAIL}}. Some billing, security, or operational records may need to be retained where required.

## Contact

Questions about privacy or data requests can be sent to {{SUPPORT_EMAIL}}.
`),
  },
  {
    pageKey: 'content_usage_policy',
    title: 'Content Usage Policy',
    slug: 'content-usage-policy',
    enabled: true,
    showInFooter: true,
    footerOrder: 20,
    openInNewTab: false,
    accessLevel: 'public',
    pageType: 'legal',
    seedVersion: SEED_VERSION,
    excerpt: 'Rules for responsible prompts, uploads, generated stories, and shared content.',
    metadata: { requiresLegalReview: true },
    content: seed(`
## Starter Draft - Review Before Rollout

Kissago is built for creative storytelling. Users are responsible for the prompts, source text, uploads, story choices, and published storylines they create or share through the platform.

## Acceptable Use

- Create original, respectful, lawful stories.
- Use prompts, source text, and media only when you have the right to use them.
- Review AI-assisted outputs before sharing, publishing, downloading, or using them outside Kissago.
- Keep public storylines appropriate for the audience and age settings selected during creation.

## Not Allowed

- Illegal, abusive, harassing, hateful, exploitative, or intentionally harmful content.
- Content that infringes another person's copyright, trademark, privacy, publicity, or other rights.
- Attempts to misuse the service, bypass restrictions, overload generation systems, or interfere with other users.
- Use of generated or downloaded media in a way that violates law, third-party rights, or applicable provider terms.

## Moderation and Enforcement

The current codebase includes public storylines and admin tools to unpublish or delete content. It does not include a full public reporting workflow yet. Kissago may restrict, unpublish, or remove content when needed to protect users, the service, or legal rights.

## Contact

Content concerns can be sent to {{SUPPORT_EMAIL}}.
`),
  },
  {
    pageKey: 'terms',
    title: 'Terms of Service',
    slug: 'terms',
    enabled: true,
    showInFooter: true,
    footerOrder: 30,
    openInNewTab: false,
    accessLevel: 'public',
    pageType: 'legal',
    seedVersion: SEED_VERSION,
    excerpt: 'Startup-practical starter terms for using Kissago.',
    metadata: { requiresLegalReview: true },
    content: seed(`
## Starter Draft - Review Before Rollout

These starter terms describe the current Kissago product and must be reviewed before public rollout. By using Kissago, users agree to use the service responsibly and only for lawful purposes.

## Accounts

Users may sign in with supported Supabase Auth methods. Users are responsible for activity under their account and should keep access to their email and credentials secure.

## The Service

Kissago provides AI-assisted interactive storytelling, generated images, narration, story saving, public storylines, gallery discovery, and optional wallet or billing features when enabled.

Kissago may change, pause, limit, or discontinue features as the product evolves. AI generation quality, availability, latency, and outputs can vary.

## Payments

The codebase includes wallet, coin, plan, top-up, Razorpay India checkout, and subscription mirror records. Live checkout and enforcement are controlled by admin runtime flags. Subscription changes, cancellation, and full account billing management are not self-serve in the current product.

## Content and Rights

Users are responsible for prompts, source text, uploads, and story content they submit or publish. Kissago needs permission to store, process, display, generate from, and share content as needed to operate the product.

## Suspension or Removal

Kissago may restrict access, unpublish storylines, or remove content if use appears harmful, unlawful, infringing, abusive, or disruptive.

## Contact

Questions about these terms can be sent to {{SUPPORT_EMAIL}}.
`),
  },
  {
    pageKey: 'refund_policy',
    title: 'Refund / Cancellation Policy',
    slug: 'refund-policy',
    enabled: true,
    showInFooter: true,
    footerOrder: 40,
    openInNewTab: false,
    accessLevel: 'public',
    pageType: 'legal',
    seedVersion: SEED_VERSION,
    excerpt: 'Current billing limitations and support-based refund or cancellation handling.',
    metadata: { requiresLegalReview: true, policyPlaceholder: true },
    content: seed(`
## Starter Draft - Review Before Rollout

This policy must be finalized before live billing rollout. The current codebase supports Razorpay India subscription checkout, top-up checkout, wallet grants, payment verification, and webhook sync. It does not yet include self-serve cancellation, subscription switching, or refund management inside Kissago.

## Cancellations

Subscription cancellation is currently handled through support or provider-side/manual workflows. The product documentation notes that cancellation should preserve paid access until the current billing period ends, but the self-serve account-management flow is not yet implemented.

## Plan Changes

Users cannot currently self-serve a switch from one active Razorpay subscription to another. The checkout path blocks overlapping Razorpay subscriptions and asks users to wait for manual account management.

## Refunds

Refunds are not automated in the current product. Refund requests, duplicate payment concerns, or billing disputes should be sent to {{SUPPORT_EMAIL}} for manual review. Digital usage, generated content, consumed coins, or completed top-ups may not be refundable unless required by law or approved after review.

## Billing Support

Please include the account email, payment date, plan or top-up details, and any Razorpay payment information available when contacting support.
`),
  },
  {
    pageKey: 'contact_support',
    title: 'Contact / Support',
    slug: 'contact',
    enabled: true,
    showInFooter: true,
    footerOrder: 50,
    openInNewTab: false,
    accessLevel: 'public',
    pageType: 'rich_text',
    seedVersion: SEED_VERSION,
    excerpt: 'Where users can ask for account, billing, technical, or content help.',
    metadata: { requiresSupportEmail: true },
    content: seed(`
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

## Admin Review Needed

Set the SUPPORT_EMAIL environment variable before rollout so this page shows a real support channel.
`),
  },
  {
    pageKey: 'blog_news',
    title: 'Blog / News',
    slug: 'blog',
    enabled: true,
    showInFooter: true,
    footerOrder: 60,
    openInNewTab: false,
    accessLevel: 'public',
    pageType: 'blog_index',
    seedVersion: SEED_VERSION,
    excerpt: 'Product notes and rollout updates from Kissago.',
    metadata: { editableFeed: true },
    content: seed(`
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
`),
  },
  {
    pageKey: 'documentation',
    title: 'Documentation',
    slug: 'docs',
    enabled: true,
    showInFooter: true,
    footerOrder: 70,
    openInNewTab: true,
    accessLevel: 'admin',
    pageType: 'docs_index',
    seedVersion: SEED_VERSION,
    excerpt: 'Internal admin documentation index for the current Kissago product.',
    metadata: { internalOnly: true },
    content: seed(`
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

## Useful Admin Areas

- /admin/content for story and storyline moderation tools.
- /admin/settings for global runtime settings.
- /admin/pricing for pricing catalog and rollout controls.
- /admin/playground for model and prompt iteration.

## Known Limitations

- No self-serve account deletion flow yet.
- No self-serve subscription cancellation or plan-switching flow yet.
- No full docs platform, versioned docs, or markdown-backed docs tree yet.
`),
  },
  {
    pageKey: 'faq',
    title: 'FAQ',
    slug: 'faq',
    enabled: true,
    showInFooter: true,
    footerOrder: 80,
    openInNewTab: false,
    accessLevel: 'billing_enabled_only',
    pageType: 'faq',
    seedVersion: SEED_VERSION,
    excerpt: 'Frequently asked questions about plans, coins, billing, downloads, and account requests.',
    metadata: { billingGated: true },
    content: seed(`
## Frequently Asked Questions

## What are coins?

Kissago shows user-facing wallet value as coins. Internally, the code tracks story creation using beats. One beat maps to 10 coins in the current pricing model.

## When does the FAQ appear?

This FAQ is visible when live pricing information is enabled by the pricing_snapshot_enabled runtime flag.

## Can I buy a subscription today?

Checkout is controlled separately by the pricing_checkout_enabled flag. The implemented live checkout path is Razorpay for the India market. Outside-India Stripe routing exists in configuration but is not implemented as a checkout flow in this codebase.

## Can I cancel or change my subscription inside Kissago?

Not yet. Self-serve cancellation and plan switching are not implemented. Subscription changes are currently manual until account management is built.

## Can I top up?

Top-up coin packs are implemented for markets where published top-up packs and checkout are enabled. Top-up coins add creation capacity but do not unlock paid-only plan features by themselves.

## Can I download stories?

Published storylines can be exported as MP4 video in the browser when the global video download setting is enabled and the user's plan or admin bypass allows downloads.

## Can I delete my account?

Full account deletion is not self-serve yet. Send requests to {{SUPPORT_EMAIL}}.
`),
  },
  {
    pageKey: 'ai_disclosure',
    title: 'AI Content / AI Usage Disclosure',
    slug: 'ai-disclosure',
    enabled: true,
    showInFooter: true,
    footerOrder: 90,
    openInNewTab: false,
    accessLevel: 'public',
    pageType: 'legal',
    seedVersion: SEED_VERSION,
    excerpt: 'How Kissago uses AI-assisted systems for story, image, and narration features.',
    metadata: { requiresLegalReview: true },
    content: seed(`
## Starter Draft - Review Before Rollout

Kissago uses AI-assisted systems to help generate interactive story text, visual prompts, images, narration, voice choices, and related creative materials.

## What To Expect

- AI outputs can vary and may not always be accurate, complete, or appropriate for every intended use.
- Users should review stories, images, narration, and exports before publishing, sharing, or using them outside Kissago.
- Some features may depend on external AI providers. The current codebase uses Google Gemini APIs.
- Output quality, latency, cost, and availability may change as models and provider behavior change.

## User Responsibility

Users remain responsible for prompts, source text, uploads, edits, publication decisions, and any external use of generated outputs.

## Admin Controls

Kissago includes admin controls for model selection, prompt iteration, narration voices, image quality, generation timeouts, and related runtime settings.
`),
  },
  {
    pageKey: 'copyright_licensing',
    title: 'Copyright / Ownership / Licensing',
    slug: 'copyright-licensing',
    enabled: true,
    showInFooter: true,
    footerOrder: 100,
    openInNewTab: false,
    accessLevel: 'public',
    pageType: 'legal',
    seedVersion: SEED_VERSION,
    excerpt: 'Starter guidance on user content, generated outputs, publishing, and downloads.',
    metadata: { requiresLegalReview: true },
    content: seed(`
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

## Public Sharing

Published storylines can be public, shown in the gallery, saved by users, liked, viewed, and shared by link. Admins can unpublish or delete storylines when needed.
`),
  },
  {
    pageKey: 'account_deletion',
    title: 'Account Deletion / Data Retention',
    slug: 'account-deletion',
    enabled: true,
    showInFooter: true,
    footerOrder: 110,
    openInNewTab: false,
    accessLevel: 'public',
    pageType: 'legal',
    seedVersion: SEED_VERSION,
    excerpt: 'Current account deletion and retention limitations.',
    metadata: { requiresLegalReview: true, requiresSupportEmail: true },
    content: seed(`
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

## Deletion Requests

When requesting deletion, include the account email and any relevant story or billing details. Kissago support should confirm what can be deleted, what may be retained, and when the request is complete.
`),
  },
];

export function getManagedPageSeedDefinition(pageKey: string): ManagedPageSeedDefinition | null {
  return MANAGED_PAGE_DEFINITIONS.find((definition) => definition.pageKey === pageKey) ?? null;
}

export function normalizeManagedPageSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function isReservedManagedPageSlug(slug: string): boolean {
  return (RESERVED_ROOT_SLUGS as readonly string[]).includes(normalizeManagedPageSlug(slug));
}
