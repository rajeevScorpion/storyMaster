# Legal Implementation Notes — India-first, Child/Family and AI

Prepared: 28 August 2026

> These notes guide engineering and product decisions. They are not a substitute for final advice from an Indian advocate/privacy professional who has reviewed Kissago’s exact entity, data flows, vendors and markets.

## 1. Digital Personal Data Protection Act, 2023 and Rules, 2025
India’s Digital Personal Data Protection Act, 2023 (DPDP Act) defines a child as an individual under 18. The final Digital Personal Data Protection Rules, 2025 were notified in November 2025 with phased commencement.

As of 28 August 2026, many substantive processing obligations in sections 3–17 of the Act and Rules 3 and 5–16 are scheduled to come into force 18 months after 13 November 2025 (i.e. 13 May 2027). Certain provisions have already commenced, and additional provisions commence on the one-year timeline in November 2026.

Engineering recommendation: build the new account, notice and child-data architecture now rather than waiting for final commencement.

### Consent and notice design implication
The forthcoming framework emphasizes clear/plain notice and specific/informed consent where consent is relied upon. Do not use a pre-checked box for a required acceptance event.

Terms/EULA acceptance is a contract action. A Privacy Notice is primarily a notice/acknowledgement layer. Optional processing choices (for example marketing or voluntary use of private content for generalized AI training) should not be silently bundled into Terms acceptance.

## 2. Child data / parental verification
The DPDP Rules, 2025 set out a verifiable-parent-consent framework for processing personal data of a child, including due diligence to confirm that the person identifying as parent is an identifiable adult. This makes direct child accounts materially more complex than ordinary adult accounts.

Recommended product architecture for Kissago unless business requirements demand otherwise:
- adult account holder (18+);
- optional child profiles under the adult account;
- parent/guardian/authorised educator supervises child use;
- no independent child sign-up until age assurance and verifiable-parent consent are intentionally designed;
- child profiles should default to private/restricted sharing;
- do not use targeted advertising based on child behaviour;
- minimize tracking/profiling of children.

If schools use Kissago, do not assume an “educational institution” exception automatically applies to Kissago as a separate commercial service provider. Obtain legal review for the exact institutional arrangement.

## 3. Electronic contract acceptance
Section 10A of India’s Information Technology Act, 2000 recognizes validity of contracts formed through electronic means. For practical evidence, Kissago should retain the accepted document version and server timestamp associated with the authenticated user.

Do not depend only on an on-screen sentence or localStorage flag for first-time Terms acceptance.

## 4. Consumer/subscription transparency
For paid plans, show the actual price, billing period, taxes where applicable, renewal behaviour, usage limits, cancellation route and refund rules at or before purchase. Any legal text must match actual web/app-store/payment-provider behaviour.

Do not hardcode old prices into Terms. Price pages and checkout should be the commercial source-of-truth, with Terms referring to the price shown at purchase.

## 5. IT Rules and public/user-generated content
If Kissago hosts or publishes user content, public galleries, shared content or community features, assess whether and to what extent Kissago acts as an intermediary under the Information Technology Act/IT Rules. Grievance, takedown and due-diligence obligations depend on the exact role and service.

The IT Rules were updated in February 2026 in relation to synthetically generated information (SGI). Because Kissago can create AI-generated text, images, narration and potentially video, counsel/engineering should specifically assess:
- whether Kissago falls within the relevant intermediary category for a given feature;
- whether generated information requires visible labelling;
- whether permanent metadata/identifiers must be embedded/preserved;
- whether public-upload features require user declarations or verification;
- whether export/share flows preserve required provenance.

Do not remove provenance metadata from generated assets during optimization/export without checking this requirement.

## 6. United States child privacy
If Kissago is directed to children under 13 in the United States, or has actual knowledge that it collects personal information online from a child under 13, COPPA can apply. A simple statement in Terms is not a substitute for the required parental notice/consent and data-practice controls.

If U.S. child-directed distribution is planned, obtain a dedicated COPPA review before enabling direct child accounts or collecting child personal information.

## 7. International expansion
If Kissago deliberately offers the service to people in the EU/EEA, UK or other jurisdictions with child/privacy rules, add jurisdiction-specific review before claiming global compliance. Do not copy GDPR language into the India notice unless the actual product and legal basis support it.

## 8. Legal content availability
Terms, Privacy and necessary contact information should remain accessible without authentication. Moving them behind a Profile menu alone is not recommended.

Best UX compromise:
- no large multi-link auth footer;
- inline Terms/Privacy links at the point of sign-up/sign-in;
- minimal logged-out legal/help route;
- full **Help & Legal** center after login.

## 9. Content source-of-truth
Core legal text should not depend on a slow admin CMS request at runtime. Use versioned static content with an audited publishing workflow and server-side acceptance records tied to document version.

## 10. Facts counsel must confirm before publication
- Exact legal entity operating Kissago.
- Registered/business address.
- Governing jurisdiction and court/dispute strategy.
- Support, legal, privacy and grievance contacts.
- Direct minor accounts vs adult-managed child profiles.
- Production database/auth/storage providers and regions.
- All AI providers and their retention/training settings.
- Whether private content is used for model training or fine-tuning.
- Analytics/cookies/advertising SDKs.
- Public gallery/community/sharing implementation.
- Subscription provider(s), renewal and refund behaviour.
- Retention/deletion schedule.
- Whether SGI labelling/metadata rules apply to specific Kissago generation/export features.
- International markets actively targeted.

## Official materials used for this seed analysis
- Digital Personal Data Protection Act, 2023 — India Code / Government of India.
- Digital Personal Data Protection Rules, 2025 and commencement notifications — Ministry of Electronics and Information Technology, Government of India.
- Information Technology Act, 2000, including section 10A — India Code.
- Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021, as updated/amended through 2026 — MeitY.
- Consumer Protection (E-Commerce) Rules, 2020 and amendments — Department of Consumer Affairs.
- Children’s Online Privacy Protection Rule (COPPA) — U.S. Federal Trade Commission, relevant only if U.S. child-directed/known-child collection applies.
