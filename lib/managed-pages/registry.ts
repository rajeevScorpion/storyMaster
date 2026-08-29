import {
  ACCOUNT_HOLDER_MINIMUM_AGE,
  COPYRIGHT_EMAIL,
  GRIEVANCE_EMAIL,
  GRIEVANCE_OFFICER_NAME,
  GRIEVANCE_OFFICER_TITLE,
  GOVERNING_LAW,
  JURISDICTION_CITY,
  JURISDICTION_STATE,
  LEGAL_EMAIL,
  LEGAL_ENTITY_NAME,
  LEGAL_ENTITY_TYPE,
  LEGAL_FULL_ADDRESS,
  LEGAL_GSTIN,
  PRIVACY_EMAIL,
  REPORT_EMAIL,
  SECURITY_EMAIL,
} from '@/lib/legal/business-config';

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
    excerpt: 'How Kissago handles account, story, AI, media, and billing information.',
    metadata: { requiresLegalReview: false },
    content: seed(`
Kissago is operated by ${LEGAL_ENTITY_NAME}, a ${LEGAL_ENTITY_TYPE.toLowerCase()} registered in ${JURISDICTION_STATE}, India. This notice explains what Kissago collects, why, which providers process it on Kissago's behalf, and what choices you have.

Kissago is initially rolling out in India and is built with the intent to expand to other countries over time. This notice reflects Indian legal and regulatory requirements and applies generally-sound privacy principles. It does not claim specific compliance with GDPR, UK GDPR, COPPA, CCPA/CPRA, or any other jurisdiction-specific framework unless a future version of this notice says so explicitly.

## Information Kissago Collects

- **Account and authentication data** — from Supabase Auth: email address, profile display name, avatar, and authentication identifiers. Signing in with Google shares the profile fields Google provides at consent time.
- **Story and creative content** — prompts, source text, story settings, generated story beats, choices, character and story-bible details, story maps, and published storylines.
- **AI prompts and generated outputs** — the text prompts you or Kissago construct, and the images, narration audio, and story text those prompts produce.
- **Uploaded and generated media** — reference images you upload, generated illustrations, narration audio, storyline cover art, and browser-exported videos.
- **Device and technical information** — the technical data a web request ordinarily carries (browser, device type, request metadata) as needed to operate and secure the Service. Kissago does not currently run a dedicated analytics or error-monitoring vendor; operational logs live in the hosting and database platforms themselves.
- **Cookies and session data** — authentication session cookies (Supabase) and a small consent-status cookie used to avoid repeatedly re-checking agreement to these documents.
- **Payment-related data** — when billing is enabled, plan, checkout, order, subscription, top-up, webhook, and coin-ledger records, including payment references from Razorpay. Kissago does not store your card or bank details; Razorpay processes and holds payment instrument data directly.

## AI Providers and How They Process Your Data

Kissago uses AI-assisted systems to generate story text, images, narration, and related creative outputs. Prompts and, where applicable, the resulting outputs are sent to the following providers to produce your story:

- **Google (Gemini APIs)** — story text, image generation, and narration fallback, and Google Sign-In for authentication.
- **OpenAI** — image generation.
- **xAI** — image generation.
- **Runware** — image generation.
- **ElevenLabs** — narration voice synthesis and forced alignment.

**Some image-generation calls to OpenAI and Google are made with server-side retention enabled at the provider** (OpenAI's Responses API and Google's Gemini image-editing calls, each with their retention setting turned on), specifically so a later beat in the same story can reference an earlier image for visual continuity. This means those providers may retain the request and the generated image on their servers for a period governed by their own retention policies, in addition to Kissago's own storage of the same image. **Kissago itself does not train or fine-tune any model on your prompts, stories, or generated content**, and has not configured any provider to use your data for their own model training; if a provider's default terms permit training-data use of API traffic and you want to confirm the current setting for a specific provider, contact {{SUPPORT_EMAIL}}.

## Infrastructure Providers

- **Supabase** — authentication, database, and object storage.
- **Cloudflare R2** — primary media storage, with Supabase Storage as a fallback.
- **Vercel** — application hosting and scheduled background jobs.
- **Razorpay** — payment processing for India checkout, when billing is enabled.

## Storage and Sharing

Private story assets are stored in Cloudflare R2 or Supabase Storage. Published storyline covers and public storyline data are visible to other users through the gallery or shared links. Private asset URLs are served through signed links that expire.

## Retention

- **High-resolution originals of generated media** are retained on a plan-based schedule: 24 hours on the Free plan, 10 days on Plus, and 30 days on Studio, after which the original is removed while display, thumbnail, and share-ready copies are kept.
- **Display, thumbnail, and share-ready media**, story data, and account data are otherwise kept for as long as your account or the associated content exists, or as needed for the purposes described in this notice.
- **Billing, security, and operational records** (including cost, billing-webhook, and narration-generation logs) currently have no fixed deletion schedule and may be retained for accounting, fraud-prevention, dispute-resolution, or legal-compliance purposes.
- Kissago is reviewing shorter fixed retention periods for records that do not need indefinite retention; this notice will be updated when that review concludes.

## Your Choices and Rights

You can delete or archive individual stories, and unsave or unpublish storylines you control, directly in the product. **A self-serve full account-deletion flow does not exist yet.** To request deletion of your account and associated data, correction of inaccurate data, or a copy of the data Kissago holds about you, contact {{SUPPORT_EMAIL}} or ${PRIVACY_EMAIL}. Kissago will confirm what can be deleted, what must be retained (for example, billing records required by law), and when the request is complete. Deleting a story removes it from the product; copies of its media may take longer to clear from storage and any provider-side retention described above.

## International Processing

Because Kissago's AI, cloud, and payment providers operate global infrastructure, your data may be processed on servers outside India, including in jurisdictions with different data-protection laws than India's. Kissago selects providers it believes handle data responsibly, but does not currently make jurisdiction-specific compliance claims (for example, EU adequacy or Standard Contractual Clauses) beyond what is stated in this notice.

## Children and Minors

Kissago accounts may only be independently created and controlled by persons who are at least ${ACCOUNT_HOLDER_MINIMUM_AGE} years old. Kissago's "kids" browsing mode is a content-catalogue filter and does not include parental account controls, a parental dashboard, or age verification. Children should access Kissago only through a parent, legal guardian, teacher, or other authorised adult's account, and Kissago does not knowingly collect account data directly from an independently-registered child.

## Security

Kissago relies on its infrastructure providers' security controls (Supabase, Cloudflare, Vercel) and standard authentication practices. No independent security certification or audit claim is made in this notice.

## Changes to This Notice

Kissago may update this notice as the product, providers, or applicable law change. Material changes will be flagged for renewed acknowledgement where required; non-material changes (contact details, clarifications) take effect on posting.

## Contact

- General privacy questions or data requests: {{SUPPORT_EMAIL}} or ${PRIVACY_EMAIL}
- Security concerns or suspected account compromise: ${SECURITY_EMAIL}

${LEGAL_ENTITY_NAME}
${LEGAL_FULL_ADDRESS}
`),
  },
  {
    pageKey: 'content_usage_policy',
    title: 'Safety, Community & Grievance Policy',
    slug: 'content-usage-policy',
    enabled: true,
    showInFooter: true,
    footerOrder: 20,
    openInNewTab: false,
    accessLevel: 'public',
    pageType: 'legal',
    seedVersion: SEED_VERSION,
    excerpt: 'Community rules, reporting, moderation, and how to reach the Grievance Officer.',
    metadata: { requiresLegalReview: false },
    content: seed(`
Kissago is built for creative storytelling. You are responsible for the prompts, source text, uploads, story choices, and published storylines you create or share through the platform. This policy sets the community rules, explains how reports and appeals work today, and names the Grievance Officer for Indian regulatory purposes.

## Acceptable Use

- Create original, respectful, lawful stories.
- Use prompts, source text, and media only when you have the right to use them.
- Review AI-assisted outputs before sharing, publishing, downloading, or using them outside Kissago.
- Keep public storylines appropriate for the audience and age setting selected during creation.

## Prohibited Content and Conduct

- Illegal content, or content that facilitates illegal activity.
- Abuse, harassment, hateful conduct, or exploitation directed at any person or group.
- Child sexual abuse material or any content that sexualizes minors, in any form — this is never permitted, generated or otherwise, and will result in immediate account action and, where required, a report to the relevant authorities.
- Impersonation of another person or organisation without disclosure.
- Dangerous, malicious, or fraudulent misuse of the Service, including attempts to bypass restrictions, overload generation systems, or interfere with other users' access.
- Content that infringes another person's copyright, trademark, privacy, publicity, or other rights.
- Use of generated or downloaded media in a way that violates law, third-party rights, or an applicable AI provider's own usage terms.

## Reporting a Problem

Kissago does not yet have an in-app report button or a moderation queue. To report content, abuse, or a safety concern today, email ${REPORT_EMAIL}. Include a link to the story or storyline, a description of the issue, and any relevant screenshots. When an in-product reporting flow is built, these email channels will remain available as a fallback and escalation route.

## Moderation, Today

Kissago's current moderation capability is admin-operated: an administrator can unpublish or delete a storyline, or suspend an account, in response to a report or an internal review. There is no automated content-safety filter and no public moderation queue in the product today. Kissago may restrict, unpublish, or remove content, or suspend or terminate an account, whenever necessary to protect users, the Service, or legal rights — including before completing an investigation, if the risk warrants it.

## Appeals

If your account or content was restricted and you believe it was a mistake, email ${GRIEVANCE_EMAIL} with your account email and the action you are appealing. Appeals are currently reviewed manually; there is no automated or guaranteed timeline yet, but every appeal received at this address is read by the Grievance Officer.

## Grievance Officer

In accordance with Rule 3(2) of the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021, the Grievance Officer for Kissago is:

**${GRIEVANCE_OFFICER_NAME}**
${GRIEVANCE_OFFICER_TITLE}, ${LEGAL_ENTITY_NAME}
Email: ${GRIEVANCE_EMAIL}
Address: ${LEGAL_FULL_ADDRESS}

## Rights-Holder and Copyright Complaints

If you believe your copyright, trademark, or other intellectual-property right has been infringed by content on Kissago, email ${COPYRIGHT_EMAIL}. Include the material you believe infringes, the right you hold, and how to contact you. Rights-holder complaints may also be escalated to ${LEGAL_EMAIL}.

## Support Escalation

General product and account support is handled at {{SUPPORT_EMAIL}}. Safety, grievance, and rights-holder concerns should go to the dedicated addresses above so they reach the right reviewer directly.
`),
  },
  {
    pageKey: 'terms',
    title: 'Terms of Service & End User Licence Agreement',
    slug: 'terms',
    enabled: true,
    showInFooter: true,
    footerOrder: 30,
    openInNewTab: false,
    accessLevel: 'public',
    pageType: 'legal',
    seedVersion: SEED_VERSION,
    excerpt: 'The agreement governing your use of Kissago, including AI content, payments, and account terms.',
    metadata: { requiresLegalReview: false },
    content: seed(`
Kissago (kissago.cc) is operated by ${LEGAL_ENTITY_NAME}, a ${LEGAL_ENTITY_TYPE.toLowerCase()} registered in ${JURISDICTION_STATE}, India (GSTIN ${LEGAL_GSTIN}). By creating an account or using Kissago, you agree to these Terms of Service and End User Licence Agreement ("Terms"). If you do not agree, do not use Kissago.

## 1. Eligibility

Kissago accounts may only be independently created and controlled by persons who are at least ${ACCOUNT_HOLDER_MINIMUM_AGE} years old. Children may experience Kissago content through an appropriately supervised experience managed by a parent, legal guardian, teacher, or other authorised adult, where the Service supports that. A minor does not independently enter into these Terms; the adult who controls the account does.

## 2. Accounts and Security

You may sign in with a supported method (currently email/password or Google). You are responsible for all activity under your account and for keeping your credentials secure. Tell Kissago promptly at ${LEGAL_EMAIL} if you suspect unauthorised access.

## 3. The Service

Kissago provides AI-assisted interactive storytelling: generated story text, illustrations, narration, story saving, public storylines, and gallery discovery, together with optional wallet, coin, and subscription features where enabled. Kissago may change, pause, limit, or discontinue features as the product evolves, and AI generation quality, availability, and latency can vary and are not guaranteed.

## 4. Licence to Use Kissago

Subject to these Terms, Kissago grants you a limited, non-exclusive, non-transferable, revocable licence to access and use Kissago for personal, non-commercial creative use unless a specific plan or written agreement says otherwise. You may not copy, resell, sublicense, reverse-engineer, or build a competing service from Kissago's software, prompts, or underlying systems.

## 5. Your Content and AI-Generated Output

You are responsible for the prompts, source text, uploads, and story choices you submit. As between you and Kissago, you retain your rights in original material you contribute. To operate the Service, you grant Kissago the rights it needs to store, process, generate from, display, and — where you choose to publish — share your content and the outputs generated from it. AI-generated text, images, and narration carry their own ownership and copyright uncertainties, described fully in the **AI, Content & Rights Policy**; that policy is part of these Terms by reference.

## 6. Prohibited Conduct

You must not use Kissago to create or distribute illegal, abusive, harassing, hateful, or exploitative content (including any content sexualising a minor, which is never permitted); infringe another person's rights; impersonate someone without disclosure; or attempt to bypass restrictions, overload generation systems, or interfere with other users. Full rules are in the **Safety, Community & Grievance Policy**.

## 7. Subscriptions, Payments, and Usage Limits

Kissago offers free and paid creator plans, coin-based usage, and — where the Service is being used to read or watch rather than create — may offer viewer plans with usage limits communicated within the Service (for example, a daily limit on free story viewing). Kissago does not fix these limits in these Terms because they may change as the product evolves; the limits, features, and pricing applicable to a plan will be shown to you at the time of subscription or use. Payments for India checkout are processed through Razorpay. ${LEGAL_ENTITY_NAME} is GST-registered (GSTIN ${LEGAL_GSTIN}); applicable taxes are shown at checkout where required.

## 8. Cancellation and Refunds

Kissago does not currently offer self-serve subscription cancellation or automated refunds. To cancel a subscription or raise a billing dispute, contact {{SUPPORT_EMAIL}}; cancellation requests are handled manually, and access is not automatically extended or reduced outside your current billing period unless Kissago agrees otherwise. Consumed coins, generated content, and completed top-ups are not refundable except where required by law or approved on manual review.

## 9. Third-Party Services

Kissago's features depend on third-party AI, cloud, and payment providers (see the **Privacy & Data Notice** for the current list). Your use of outputs from those providers may also be subject to that provider's own terms.

## 10. Suspension and Termination

Kissago may restrict access, unpublish storylines, remove content, or suspend or terminate an account if use appears harmful, unlawful, infringing, abusive, or disruptive, or to comply with law. You may stop using Kissago at any time; see the **Safety, Community & Grievance Policy** for how account-deletion requests are currently handled, since self-serve deletion is not yet available.

## 11. Disclaimers

Kissago is provided "as is." AI-generated content can be inaccurate, unpredictable, or unsuitable for a given purpose, and Kissago does not warrant that outputs will be error-free, uninterrupted, or fit for any particular use. Review generated content before relying on it or sharing it further.

## 12. Limitation of Liability

To the maximum extent permitted by applicable law, ${LEGAL_ENTITY_NAME} is not liable for indirect, incidental, special, or consequential damages arising from your use of Kissago, and Kissago's total liability for any claim relating to the Service is limited to the amount you paid Kissago in the 12 months before the claim arose, or ₹1,000, whichever is greater. Nothing in these Terms limits liability that cannot be limited under applicable law.

## 13. Indemnity

You agree to indemnify ${LEGAL_ENTITY_NAME} against claims, losses, and expenses arising from your content, your breach of these Terms, or your violation of another person's rights or applicable law.

## 14. Governing Law and Jurisdiction

These Terms are governed by the laws of ${GOVERNING_LAW}. Subject to any non-waivable rights available to consumers under applicable law, the courts of competent jurisdiction at ${JURISDICTION_CITY}, ${JURISDICTION_STATE}, India have exclusive jurisdiction over disputes arising out of or relating to Kissago, these Terms, or the Service.

## 15. Changes to These Terms

Kissago may update these Terms as the product or applicable law changes. Each version is dated and numbered; a material change requires renewed acceptance before you can continue using the Service, and a minor change (for example, a contact-detail correction) takes effect on posting.

## 16. Contact

Questions about these Terms: {{SUPPORT_EMAIL}} or ${LEGAL_EMAIL}.

${LEGAL_ENTITY_NAME}
${LEGAL_FULL_ADDRESS}
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
    title: 'AI, Content & Rights Policy',
    slug: 'ai-disclosure',
    enabled: true,
    showInFooter: true,
    footerOrder: 90,
    openInNewTab: false,
    accessLevel: 'public',
    pageType: 'legal',
    seedVersion: SEED_VERSION,
    excerpt: 'How AI generates your story, who processes your prompts, and where rights and limits sit.',
    metadata: { requiresLegalReview: false },
    content: seed(`
Kissago uses AI-assisted systems to generate interactive story text, illustrations, narration, and related creative materials from your prompts and choices. This policy explains what that means for ownership, rights, and the limits of AI output, and works together with the **Terms of Service & EULA** and the **Privacy & Data Notice**.

## Your Prompts and Inputs

Your original prompts, source text, character concepts, and any reference images you upload remain yours as between you and Kissago. You grant Kissago the rights described in the Terms to process that input in order to generate story text, images, and narration from it.

## AI Providers Used

- **Google (Gemini APIs)** — story text generation, image generation, and narration fallback.
- **OpenAI** — image generation.
- **xAI** — image generation.
- **Runware** — image generation.
- **ElevenLabs** — narration voice synthesis and forced alignment.

Some image-generation requests to OpenAI and Google are made with the provider's own server-side retention enabled, so a later story beat can reference an earlier generated image for visual continuity across the story. See the **Privacy & Data Notice** for the full disclosure of what this means. Kissago does not train or fine-tune any model on your content.

## Ownership and Copyright Uncertainty

Copyright law's treatment of purely AI-generated output is unsettled in most jurisdictions, including India. Kissago does not represent that AI-generated text, images, or narration are protectable by copyright, or that you hold exclusive rights in output that had no meaningful human authorship beyond the prompt. Where your own original creative choices (story structure, edited text, curated selections) are combined with AI output, your rights in your own contribution are unaffected.

## Similarity and Coincidental Generation

Generative AI models can occasionally produce output that resembles existing characters, artwork, or other copyrighted or trademarked material, without Kissago or the provider intending it. If you believe generated content on Kissago infringes your rights, use the rights-holder process below.

## Publishing and Sharing

If you publish a storyline, its text, images, and narration become visible to other users through the gallery or a shared link, subject to the access level you choose. Review AI-generated content before publishing or exporting it — Kissago does not pre-screen output for accuracy, appropriateness, or third-party rights before it reaches you.

## Likeness, Identity, and Voice

Do not use Kissago to generate content that depicts a real, identifiable person — including their likeness or voice — without that person's consent, or in a way that is defamatory, harassing, or misleading. Narration voices offered in Kissago are licensed synthetic voices from ElevenLabs, not recreations of any specific real person's voice, unless a feature is explicitly introduced and disclosed as such.

## Third-Party Intellectual Property

You must not submit prompts, source text, or uploads that infringe someone else's copyright, trademark, or other rights, or use generated output in a way that does so. Providers' own usage terms may also restrict certain commercial uses of their generated output; you are responsible for checking those where relevant to your use.

## Rights-Holder Complaints

To report suspected infringement involving Kissago-hosted content — including AI-generated material — email ${COPYRIGHT_EMAIL} with the material in question, the right you hold, and how to contact you. Complaints may also be escalated to ${LEGAL_EMAIL}. See the **Safety, Community & Grievance Policy** for how content reports and moderation work.

## Synthetic-Content Labelling

Kissago does not currently apply automated watermarking or machine-readable provenance labels to generated images, audio, or video. Treat any Kissago story, image, or narration as AI-generated by default.

## Your Responsibility

You remain responsible for the prompts you submit, the edits and publication decisions you make, and any use of generated output outside Kissago.
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
