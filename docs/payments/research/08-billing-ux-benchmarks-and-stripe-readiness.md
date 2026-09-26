# Stream 8 — Billing UX benchmarks and Stripe/international readiness

Status: IN PROGRESS (skeleton — filling section by section)
Researcher: Stream 8 agent, 2026-09-17
Scope: research only, no code/repo changes. See task brief for full scope.

Overlap notes (one-liners, expand only if needed):
- Razorpay capability specifics → Stream 6 owns this; here we only reference Razorpay as a baseline row in the international comparison table.
- India tax/legal (GST, FEMA/RBI export-of-services detail, purpose codes) → Stream 7 owns this; here we note only what's needed to frame Stripe India onboarding status.

---

## Part 1 — ChatGPT and Claude billing, in detail

STATUS: partial — findings below are all from WebSearch result snippets (OpenAI help.openai.com pages return HTTP 403 to WebFetch directly, so OpenAI facts below are search-snippet-sourced, not page-fetched; Claude/Anthropic pages fetched successfully in full). Not yet confirmed by direct page read for OpenAI items — treat as good-confidence but re-verify with a fetch method that works (e.g. Google cache, or Bash curl with a browser UA) before finalizing.

### ChatGPT (OpenAI)

- **Billing settings location**: Settings > Account > Payment > "Manage" opens a customer billing portal (this is the Stripe customer portal, based on phrasing — UNCONFIRMED which processor). Invoice History appears there. Source: [Managing billing for ChatGPT and the API platform](https://help.openai.com/en/articles/9039756-managing-billing-settings-on-chatgpt-web-and-platform) (search snippet only, direct fetch blocked 403), [How can I find my past ChatGPT invoices?](https://help.openai.com/en/articles/12356340-how-can-i-find-my-past-chatgpt-invoices) (search snippet only, 403 on fetch).
- Location "may slightly vary" between Plus/Pro vs Business subscribers. For ChatGPT Business, only workspace owners can update billing info/payment methods/view invoices. Source: same article 9039756.
- Billing cycle: recurs on the calendar date of original subscription; invoice dates follow that and "cannot be modified." Source: [Invoice dates for ChatGPT and API billing](https://help.openai.com/en/articles/8156167-invoice-dates-for-chatgpt-and-api-billing) (snippet only).
- **Cancellation**: canceling stops future renewals but does NOT itself trigger a refund; user keeps access until the end of the current billing cycle. Source: [Canceling your ChatGPT subscription](https://help.openai.com/en/articles/7232927-how-do-i-cancel-my-chatgpt-plus-subscription) (snippet only).
- **Refunds**: discretionary refund possible for an unused individual subscription purchase if requested within 7 days of the charge, via the in-product Help Center chat widget while signed into the affected account. Not automatic/self-serve — goes through support chat. Source: [How do I request a refund for my ChatGPT subscription?](https://help.openai.com/en/articles/7232895-how-do-i-request-a-refund-for-my-chatgpt-subscription) (snippet only).
- **Upgrade (Plus→Pro)**: takes effect immediately, billing cycle restarts on upgrade, new limits/capabilities apply immediately. OpenAI does NOT appear to auto-refund the cash value of the unused lower-tier period — community reports (OpenAI Developer Community thread, not primary) suggest no automatic proration credit, only manual refund path for billing errors. UNCONFIRMED exact proration mechanics — the primary help-center article ([About ChatGPT Pro tiers](https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers)) was not directly fetched.
- **Failed payments**: UNCONFIRMED from primary source (help.openai.com/en/articles/7242622-why-did-my-chatgpt-plus-or-chatgpt-pro-renewal-transaction-fail exists but not fetched). Secondary sources (blogs, not authoritative) claim ~7-10 days of retries with email notifications before downgrade to Free. Treat as UNCONFIRMED pending primary-source read.
- **Usage-limit → upgrade messaging**: hitting a message-rate limit on free/Plus auto-downgrades the active model (e.g., falls back to a lighter/faster model) rather than hard-blocking, with an upgrade CTA shown; Plus removes/raises the caps considerably vs Free. UNCONFIRMED precise UI copy — only from secondary blog sources, not a help-center screenshot.
- **Mobile app-store subscriptions**: iOS/Android app subscriptions are billed and managed by Apple App Store / Google Play respectively (local currency), NOT through chatgpt.com billing — separate cancellation path, separate receipts. Risk of double-charging if a user subscribes on both web and app; OpenAI has a help article specifically warning about this. Source: [How do I avoid being charged twice if I subscribe to ChatGPT on iOS, Android, and the web?](https://help.openai.com/en/articles/20001043-how-do-i-avoid-being-charged-twice-if-i-subscribe-to-chatgpt-on-ios-android-and-the-web) (snippet only).
- **Multi-currency billing**: OpenAI has a dedicated help article — [Multi-currency billing](https://help.openai.com/en/articles/10421635-multicurrency-billing) (not fetched yet, snippet only — worth a full read later, directly relevant to Kissago's India-now/international-later roadmap).
- **India / ChatGPT Go**: launched 2025-08-19, ₹399/month, UPI payment support added (first UPI support for OpenAI), INR pricing rolled out across tiers, GPT-5 with better Indian-language support, 10x higher message limits / 10x file uploads / 2x memory vs Free. OpenAI said India was the deliberate first market before global expansion. By "early 2026" (per one secondary source, unconfirmed exact date) ChatGPT Go went global at $8/month with India INR pricing stabilized. Sources: [Business Standard](https://www.business-standard.com/technology/tech-news/openai-launches-chatgpt-go-low-cost-plan-for-india-125081900119_1.html), [TechCrunch](https://techcrunch.com/2025/08/18/openai-launches-a-sub-5-chatgpt-plan-in-india), [Gulf News](https://gulfnews.com/technology/chatgpt-go-plan-launched-in-india-for-rs399-1.500237780), [HostingSeekers](https://www.hostingseekers.com/blog/openai-launches-chatgpt-go-for-indian-users-with-upi-integration/).

### Claude (Anthropic) — fetched directly from primary sources, higher confidence

- **Billing settings location**: claude.ai → click name/initials bottom-left → Settings → Billing. Shows plan, payment method, Invoices section. Source: [Paid plan billing FAQs](https://support.claude.com/en/articles/8325618-paid-plan-billing-faqs), [Understanding your Pro or Max plan invoices](https://support.claude.com/en/articles/16607638-understanding-your-pro-or-max-plan-invoices) — both fetched in full.
- **Invoices**: auto-emailed to billing email after every charge (subject line "Your receipt from Anthropic", searchable); also viewable/downloadable at Settings > Billing > Invoices with a "View" button per invoice. Footer shows the name/address on file at time of issuance; user can set a different company name or add a tax/VAT ID during payment setup (at time of adding/updating card, not after the fact on old invoices). Once issued, invoices cannot be edited or reissued — "cannot reissue paid invoices or modify information on previous invoices" even by support.
- **Invoice types**: subscription invoices (monthly/annual per plan cycle), plan-change invoices (mid-cycle upgrade), and separate usage-credit receipts if usage-based credit feature is enabled.
- **Payment methods**: credit/debit card only for web subscriptions. iOS/Android app subscriptions are billed via Apple App Store / Google Play instead (separate from claude.ai billing, same pattern as OpenAI).
- **Updating payment method**: Settings > Billing > "Update" next to payment method; new card becomes default for all future renewals immediately.
- **Billing date**: no self-serve way to change the renewal date; only workaround is cancel then resubscribe (starts a new cycle on the new date).
- **Mid-cycle upgrade proration** (this is the clearest primary-sourced mechanic found in Part 1, worth modeling closely): charged "one full billing cycle of the new plan, less a prorated amount for value remaining in your old plan." If the new (lower) plan costs less than the remaining value of the old plan, the excess becomes an **account credit for future use** rather than a cash refund. This is a real, described proration formula — more concrete than what could be confirmed for OpenAI.
- **Currency changes**: require canceling the current plan and repurchasing after the term ends — no in-place currency switch.
- **Cancellation flow** (from secondary sources, direct primary confirmation partial): claude.ai → Settings → Billing → Cancel → optional short reason/exit survey (not confirmed to be a "retention offer" with a counter-incentive, just a survey) → confirm "Cancel plan". Access continues through the end of the current billing period. One secondary source claims a "cancel 24h before renewal or the charge still goes through" rule — UNCONFIRMED against a primary article, worth re-checking.
- **Usage limits (Pro)**: no way to purchase extra/unlimited messages on Pro — it's session-based (resets roughly every 5 hours) and scales with message/file/conversation length and model chosen; Pro gives "at least 5x" the per-session usage of Free at peak times. Source: [About Claude's Pro plan usage](https://support.anthropic.com/en/articles/8324991-about-claude-s-pro-plan-usage) type articles (snippet-level, not fully fetched — id 8324991, 8325612, 11647753 exist and should be read in full on resume).
- **Refunds**: not yet researched directly (no query run yet on Claude refund policy specifically — Part 1 gap, see Resume section).

### Not yet done in Part 1
- Direct primary-source confirmation of OpenAI cancellation/refund/failed-payment/proration articles (fetch blocked by 403; need an alternate fetch route — try `Bash curl` with a standard user-agent header, or a cache).
- Claude refund policy specifics (no query run).
- "Where plans are presented" / in-product upgrade entry points for both products (pricing page vs settings vs limit-hit modal) — only the limit-hit angle was searched; need the settings/pricing-page angle too.
- Side-by-side comparison table (Part 1 deliverable) — not yet built.
- "Minimum lovable billing area" list (Part 1 deliverable) — not yet built.
- Tax display at checkout (GST shown or not) for either product — not yet searched.
- Adding tax ID / business details for ChatGPT specifically (have it for Claude only).

## Part 2 — Credit/coin-based creative AI products (5 picks)

STATUS: NOT STARTED. No searches run yet. Plan was to cover 5 of: ElevenLabs, Midjourney, Runway, Suno, Leonardo, Kling, Higgsfield, Pika — credits per tier, reset/rollover, top-up purchase + expiry, usage ledger UI, mid-cycle upgrade/downgrade effect on credits, credits-on-cancellation, refund policy on credits.

## Part 3 — Indian subscription apps (UPI Autopay / Razorpay)

STATUS: NOT STARTED. No searches run yet. Plan: 2-3 of (audio/ed-tech/OTT — e.g. Spotify India, JioSaavn, Hotstar/JioHotstar, Byju's/similar, Kuku FM) on renewal presentation, pre-debit notice (RBI-mandated for e-mandates), cancellation, invoices.

## Part 4 — International payments readiness

### 4.1 Stripe for an India-registered business in 2026

STATUS: partial — good primary-source data, from full fetch of Stripe's own India FAQ.

- **Invite-only since May 2024**: "Stripe accounts are invite-only in India" — businesses cannot self-signup via the website; must request an invite, and Stripe is "only able to support a select number of businesses, with a focus on international expansion." This followed RBI regulatory changes. Source: [Stripe India FAQ](https://support.stripe.com/questions/india-faq?locale=en-GB) (fetched in full), [TechCrunch: Stripe curbs its India ambitions over regulatory changes](https://techcrunch.com/2024/05/31/stripe-curbs-india-ambitions-over-regulatory-changes/) (2024-05-31), [Stripe: accounts are invite-only in India](https://support.stripe.com/questions/stripe-accounts-are-invite-only-in-india).
- **How to get access now**: contact Stripe Sales directly, request an invite. No self-serve path confirmed as of research date (2026-09-17).
- **New KYC requirement effective 2026-01-01**: RBI revised Payment Aggregator guidelines to mandate liveness checks for all new users — relevant if Kissago ever gets a Stripe India invite. Source: same FAQ page; also [Video KYC for India onboarding](https://support.stripe.com/questions/video-kyc-for-india-onboarding).
- **What IS supported for India-based accounts that do get in**: domestic payments, international/cross-border transactions, recurring payments via RBI-compliant e-mandate flow, Stripe Connect marketplace functionality (with extra onboarding requirements — [Onboarding requirements for Stripe Connect in India](https://support.stripe.com/questions/onboarding-requirements-for-stripe-connect-in-india), [Stripe India support for marketplaces](https://support.stripe.com/questions/stripe-india-support-for-marketplaces)).
- **Restrictions found**: Amex has specific limitations for India accounts ([Pausing support for India-issued Amex cards](https://support.stripe.com/questions/american-express-card-support-for-india-based-businesses)); certain business categories can't accept international payments at all; negative balances need special handling; export transaction volumes have defined caps (specific numbers UNCONFIRMED, not in fetched snippet).
- **Cross-border mechanics**: payout currency has India-specific restrictions; purpose codes required on international transactions (this is the FEMA/RBI export-of-services code — overlaps with Stream 7); additional pricing applies to cross-border transactions; **FIRC (Foreign Inward Remittance Certificate) documentation is mandated for export transactions** — this is the document Indian exporters need for tax/FEMA compliance, directly relevant if Kissago bills international customers through any INR-settling rail; 3D Secure authentication required for international card payments.
- **Tax on Stripe's own India invoices**: GSTIN appears on Stripe's monthly invoices to the merchant; TDS (Tax Deducted at Source) applies; foreign tax relief eligibility is handled separately.
- **Data residency**: Stripe has done a data storage migration within India to meet local regulatory storage requirements (RBI data localization).
- **Net read for Kissago**: getting a native Stripe India merchant account is not self-serve and gated behind Stripe Sales approval as of today; even if granted, RBI KYC (liveness checks from 2026-01-01) and data-localization apply. This makes Stripe-via-India-entity a slow/uncertain path — reinforces looking at either (a) a foreign entity + Stripe, or (b) a Merchant-of-Record, for the "Stripe later, international" part of the roadmap. NOT YET CROSS-CHECKED against Stream 7's FEMA/purpose-code findings — do that when both streams are done.

### 4.2 Alternatives (MoR providers, Stripe Atlas route, Razorpay Intl baseline)

STATUS: NOT STARTED. No searches run yet. Need: Paddle, Lemon Squeezy, Polar, Dodo Payments, Creem, FastSpring — fees, India payouts, global VAT/sales-tax handling, subscription+credits support, customer portal/invoices; Stripe-via-Atlas/foreign-entity route; Razorpay International as baseline row. Comparison table deliverable not started.

### 4.3 Stripe Billing feature reference

STATUS: NOT STARTED. No searches run yet. Need: Customer Portal scope, invoice PDFs, Stripe Tax, Smart Retries/dunning, proration behaviors, Entitlements API, and especially **billing credits / credit grants and meters** (this is the piece most directly analogous to Kissago's coin system — high priority on resume).

### 4.4 Provider-agnostic billing architecture

STATUS: NOT STARTED. No searches run yet. Need: patterns for internal source-of-truth (subscription/invoice/payment/entitlement records) + provider adapters, normalized webhook events, idempotent event store, entitlements decoupled from provider. Look at Lago, Autumn, Flexprice, Kill Bill, OpenMeter, Polar + engineering write-ups.

## Implications for Kissago

STATUS: NOT STARTED — write only after Parts 1-4 are filled in, since this section should synthesize across all of them.

## Source list

All sources are cited inline above with URLs. Key ones to re-verify with a working fetch method (WebFetch got 403 on all help.openai.com URLs tried; Bash/PowerShell curl with a browser User-Agent header may work better, or try a cache/reader view):
- https://help.openai.com/en/articles/9039756-managing-billing-settings-on-chatgpt-web-and-platform
- https://help.openai.com/en/articles/12356340-how-can-i-find-my-past-chatgpt-invoices
- https://help.openai.com/en/articles/7232927-how-do-i-cancel-my-chatgpt-plus-subscription
- https://help.openai.com/en/articles/7232895-how-do-i-request-a-refund-for-my-chatgpt-subscription
- https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers
- https://help.openai.com/en/articles/7242622-why-did-my-chatgpt-plus-or-chatgpt-pro-renewal-transaction-fail
- https://help.openai.com/en/articles/10421635-multicurrency-billing
- https://help.openai.com/en/articles/20001043-how-do-i-avoid-being-charged-twice-if-i-subscribe-to-chatgpt-on-ios-android-and-the-web
- https://support.anthropic.com/en/articles/8324991-about-claude-s-pro-plan-usage (Claude usage detail, snippet only so far)

## Resume here

Everything above this line is confirmed-written progress. Nothing below has been done. On resume, work through in this order (roughly matches priority/dependency):

1. **Finish Part 1**: fix the OpenAI 403-fetch problem (try Bash curl with a UA header, or search-snippet triangulation across multiple secondary sources since primary fetch may stay blocked), get Claude refund policy, get "where plans are presented / upgrade entry points" for both, get tax-display-at-checkout for both, then build the Part 1 side-by-side comparison table and "minimum lovable billing area" list.
2. **Part 2**: pick 5 of the listed credit-based creative AI tools and research each (credits/tier, reset/rollover, top-up+expiry, usage ledger UI, upgrade/downgrade effect on credits, cancellation effect, refund policy). Build summary table + "patterns users now expect" list. Not started at all.
3. **Part 3**: 2-3 Indian subscription apps on UPI Autopay — renewal presentation, pre-debit notice, cancellation, invoices. Keep brief per instructions. Not started at all.
4. **Part 4.2**: MoR provider comparison (Paddle, Lemon Squeezy, Polar, Dodo Payments, Creem, FastSpring) + Stripe Atlas/foreign-entity route + Razorpay Intl baseline row. Not started.
5. **Part 4.3**: Stripe Billing feature reference — prioritize the credit grants/meters piece since it's most analogous to Kissago's coins. Not started.
6. **Part 4.4**: provider-agnostic billing architecture patterns (Lago, Autumn, Flexprice, Kill Bill, OpenMeter, Polar + write-ups). Not started.
7. **Implications for Kissago**: write last, bulleted, tied to Parts 1-4.
8. Final reply to the orchestrator: notes file path + ≤250 word summary + top 5 insights, per the original task instructions.

No file/git/build modifications have been made anywhere except this one notes file, consistent with the read-only research mandate.
