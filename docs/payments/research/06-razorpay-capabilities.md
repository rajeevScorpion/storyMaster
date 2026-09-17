# Stream 6 — Razorpay capabilities for subscriptions, invoices and billing management

Status: IN PROGRESS (skeleton). Today's date for "current" claims: 2026-09-17.

Overlap notes: checkout code / entitlements code / DB state / admin tools are audited in depth by other streams — this stream only names what's used, doesn't re-audit implementation correctness. India tax/legal is stream 7. Billing UX benchmarks + Stripe readiness is stream 8 (section 8 here stays Razorpay-side only, light touch).

---

## Answers to audit questions

These four came from the checkout-code audit stream and need definitive, sourced answers before entitlements logic ships. Full supporting detail lives in §1/§2/§4/§10 below; this section gives the direct answer plus the sharpest caveat.

**Q1. Subscriptions are created without `start_at`, and coins are granted on `authenticated` OR `active`. Is `authenticated` backed by a real charge, or could it be a token/mandate-validation debit that gets refunded — per payment method?**

Answer: **Likely yes for cards, genuinely unclear for UPI Autopay/eNACH — this needs a sandbox trace before it's trusted.** Razorpay's general Subscriptions doc states that for an immediate-start subscription (no `start_at`, i.e. Kissago's case), the authentication transaction charges the **full plan amount and it is not refunded** — becoming the real first-cycle payment. Cards are separately described as authenticating "similar to a regular one-time online payment," consistent with a real charge. Sources: [How Subscriptions Work](https://razorpay.com/docs/payments/subscriptions/workflow/?preferred-country=IN), [Supported Payment Methods](https://razorpay.com/docs/payments/subscriptions/supported-payment-methods/?preferred-country=IN).

But Razorpay's own **Subscriptions FAQ** page asks and answers: *"Do I need to capture the ₹5 token authorisation payment used to validate a customer's card or UPI ID? No."* — explicitly describing a small, uncaptured/refundable token-authorization path for **both** cards and UPI. Separately, Razorpay's UPI Autopay marketing content describes mandate registration as using a **"low-friction ₹1 authorisation"** specifically to maximise mandate success — language that exists independently of the `start_at`/immediate-start framing, and is consistent with the general market/regulatory reality that UPI Autopay and eNACH mandate *registration* is structurally a separate step from the first real *debit* (the RBI 24-hour pre-debit notice rule makes an instantaneous "register mandate + charge full amount" combined transaction awkward for these two rails in a way it isn't for cards). Sources: [Subscriptions FAQs](https://razorpay.com/docs/payments/subscriptions/faqs/), UPI Autopay mandate-lifecycle blog content (secondary, not a docs.razorpay.com page).

These two threads were not reconcilable from public docs in this pass. **Recommendation: before shipping, create one test subscription per method (card, UPI Autopay, eNACH) with no `start_at`, and inspect the actual authentication payment's amount/status/refund history in the Dashboard.** Until then, treat granting on `authenticated` as safest for card subscribers and as an open risk for UPI Autopay/eNACH subscribers (possible free-coin grant before real money is finally collected). This is a finding for the entitlements/DB-state streams to act on, not just note.

**Q2. Top-up Orders are created with no capture parameter; `/verify` grants coins on signature validity alone. What's the default capture behaviour, and can a valid signature exist for an authorized-but-uncaptured payment?**

Answer: **Yes, a valid signature can exist without capture — this is a real (if currently low-probability) gap.** Razorpay's account-wide default is **auto-capture on**: "once your customer completes a payment, it is automatically moved to the captured state." The Orders API's old `payment_capture` field is **deprecated**; capture is now governed by the Dashboard's Payment Capture settings, with any explicit `capture` value passed via API taking precedence over the dashboard setting. Kissago's `createRazorpayOrder()` (`lib/billing/razorpay.ts:122`) passes neither, so it inherits whichever setting is live on the Dashboard — auto-capture by default, but this is a mutable account setting, not something pinned in code. A payment stuck in `authorized` (auto-capture off, or a processing delay) sits for **up to 3 days** before Razorpay **auto-refunds it** to the customer. Source: [Payment Capture Settings](https://razorpay.com/docs/payments/payments/capture-settings/).

The checkout signature (`razorpay_payment_id` + `razorpay_order_id` + `razorpay_signature`) that Checkout.js hands to the `handler` callback is generated once the bank/PSP confirms the payment at the **authorization** layer — this is separate from, and can precede, Razorpay's own internal capture step. Razorpay's own webhook docs recommend listening for **both** `payment.authorized` and `payment.captured` as distinct events precisely because they don't always coincide. Source: [Payments Webhook Events](https://razorpay.com/docs/webhooks/payments/) (via search; recommend a direct fetch to confirm exact wording before citing in a compliance-facing doc).

Practical read: under the account's presumed default (auto-capture on), Kissago's current "grant on valid signature" logic is very likely fine almost all the time, because capture happens near-instantly after authorization in that mode. But it is **not proof of captured funds** — if the Dashboard's capture setting were ever changed (deliberately, by support, or by accident), or in a rare authorized-then-timeout-refunded case, Kissago could grant coins for a payment that is auto-refunded 3 days later with no claw-back path visible in the code reviewed (`app/api/billing/razorpay/verify/route.ts`, `lib/billing/razorpay-sync.ts`). Recommend either an explicit `GET /payments/:id` status check before granting, or reconciling top-up grants against the `payment.captured`/`payment.failed` webhooks rather than trusting the checkout signature alone. Handoff: checkout-code and entitlements streams.

**Q3. `total_count` is 1200 (100 years) for monthly plans. Do per-method caps reject or silently shorten this?**

Answer: **Possibly, for UPI Autopay — unconfirmed at primary-source level, worth a sandbox check.** One secondary source states UPI Autopay recurring-mandate validity tops out at **10 years**, a full order of magnitude short of the 100-year `total_count` Kissago requests. If accurate, Razorpay would either reject the requested validity or silently negotiate a shorter mandate with the bank/NPCI, meaning a UPI Autopay subscriber's underlying mandate could expire well before 1200 cycles complete, independent of whether the `billing_subscriptions` row still shows an active `total_count`. This was **not confirmed from a primary Razorpay API-reference page** in this pass — only from web-search snippets referencing blog/secondary content. eNACH's per-method doc mentions a maximum **subscription amount** (₹1,00,00,000) but nothing about duration. No duration cap surfaced for cards beyond the generic 100-year framing Kissago's values already match. **Recommendation:** verify directly (create a long-`total_count` UPI Autopay subscription in sandbox and read back the mandate's actual validity/expiry), and treat `subscription.halted` / a mandate-expiry signal as the operative truth for UPI Autopay users rather than the `total_count` figure. Sources: UPI Autopay blog/secondary content found via search (not independently fetched from a docs.razorpay.com page — flagged UNCONFIRMED); [eNACH/emandate per-method notes](https://razorpay.com/docs/payments/subscriptions/supported-payment-methods/?preferred-country=IN) for the amount cap.

**Q4. `customer_notify: 0` is set. Does this block RBI pre-debit notices, receipts, or failure/auth-link emails — and which become Kissago's responsibility?**

Answer: **It blocks all of Razorpay's own transactional comms; it does not touch the bank-sent RBI pre-debit notice.** Per Razorpay's Create Subscription API reference, `customer_notify` "indicates whether the communication to the customer would be handled by businesses or Razorpay" — default `true` means Razorpay handles it; Kissago's explicit `0` means **Kissago's business is on the hook for all of it**. Source: [Create a Subscription API](https://razorpay.com/docs/api/payments/subscriptions/create-subscription/).

With `customer_notify: 1`, Razorpay would otherwise email/SMS the customer at: subscription start, each successful charge, each **failed** charge (crucially, including the **update-card link** the customer needs to self-heal a failing payment method during the `pending` retry window), card/mandate update, `halted`, and `cancelled`/`updated`. With it set to `0`, as Kissago has it, **none of these go out** — Kissago's own product must cover all of them, most urgently the failed-payment/update-card-link email, since Razorpay's retry window (§1) is short and a customer with no signal will simply find themselves `halted` with no idea why. Source: [Subscriptions Notifications](https://razorpay.com/docs/payments/subscriptions/notifications/).

This flag is Razorpay-layer only. The **RBI-mandated pre-debit notification is sent by the issuing bank**, not Razorpay and not the merchant (see §2), and is unaffected by `customer_notify` either way — Razorpay's own compliance docs state no merchant integration change is needed for that specific duty. So Kissago is not currently non-compliant on the pre-debit-notice front by virtue of this flag; the actual gap is entirely on Razorpay's-own-optional-comms, i.e. **product-facing UX (does the customer find out their renewal succeeded/failed), not regulatory compliance.** Worth flagging to entitlements/checkout-code streams as a real gap: right now, unless Kissago has built equivalents, a failing renewal is silent until the user notices missing coins.

---

## What Kissago uses today (from code, read-only)

Files inspected: `lib/billing/razorpay.ts`, `lib/billing/razorpay-sync.ts`, `lib/billing/razorpay-shared.ts`, `app/actions/pricing-checkout.ts`, `app/api/billing/razorpay/{prepare,verify,webhook}/route.ts`, `components/pricing/WalletPage.tsx`.

**Razorpay REST APIs called (server-side, Basic auth with key id/secret):**
- `POST /v1/plans` — `createRazorpayPlan()` in `lib/billing/razorpay.ts:73`. Called lazily from `ensureRazorpayPlanRef()` in `app/actions/pricing-checkout.ts:272` the first time a plan version checks out (result cached on `pricing_plan_versions.provider_price_ref`).
- `POST /v1/subscriptions` — `createRazorpaySubscription()`, `lib/billing/razorpay.ts:99`. `total_count` hardcoded: 100 for annual, 1200 for monthly. `customer_notify: 0`.
- `GET /v1/subscriptions/:id` — `fetchRazorpaySubscription()`, `lib/billing/razorpay.ts:116`. Used to re-fetch truth from Razorpay on both webhook and verify-callback paths (reconcile pattern, not trust-the-payload).
- `POST /v1/orders` — `createRazorpayOrder()`, `lib/billing/razorpay.ts:122`. Used for one-time coin top-ups only.
- No code found (in these files) calling: Invoices API, Customers API, Refunds API, Addons API, subscription pause/resume/cancel/update endpoints, Payment Links, Payouts/Route, Disputes API. Other streams may find UI/admin code that does — this stream did not go looking beyond the files named above.

**Checkout (client-side, `components/pricing/WalletPage.tsx`):**
- Loads `https://checkout.razorpay.com/v1/checkout.js` (constant in `lib/billing/razorpay-shared.ts`).
- Standard Checkout, **handler-based** (not `redirect: true`/`callback_url`) — `openRazorpayCheckout()` at `WalletPage.tsx:965`.
- Options set: `key`, `name`, `description`, `prefill.{name,email}`, `theme.color`, `modal.ondismiss`, `handler`. For subscriptions: `subscription_id`. For top-ups: `order_id` + `amount` + `currency`.
- Listens to `instance.on('payment.failed', ...)`.
- No `retry`, no explicit `method`/config block, no `readonly` seen.

**Signature verification (`lib/billing/razorpay.ts`):**
- Order payments: HMAC-SHA256 of `orderId|paymentId` with key secret — `verifyRazorpayOrderSignature()`.
- Subscription payments: HMAC-SHA256 of `paymentId|subscriptionId` with key secret — `verifyRazorpaySubscriptionSignature()`.
- Webhook: HMAC-SHA256 of raw body with `RAZORPAY_WEBHOOK_SECRET` — `verifyRazorpayWebhookSignature()`.

**Webhook handling (`app/api/billing/razorpay/webhook/route.ts`):**
- Requires `x-razorpay-signature` and `x-razorpay-event-id` headers.
- Idempotency: `x-razorpay-event-id` stored in `billing_webhook_events.provider_event_id` (unique lookup before processing); duplicates short-circuit with `{ok:true, duplicate:true}`.
- Event-name handling is mostly generic: any payload containing a `subscription.entity` triggers a full re-fetch of that subscription from the API and a reconcile (`syncRazorpaySubscriptionState`), regardless of which specific event fired.
- For orders/top-ups, three event names are specifically distinguished: `payment.captured`, `order.paid` (both treated as success → grants coins once, keyed off `billing_order.id` to dedupe), and `payment.failed` (marks order failed unless already paid). Other order-related events fall through with no status change.
- Both the webhook route and the `/verify` callback route call `syncRazorpaySubscriptionState`, so a race between them is handled by re-fetching current Razorpay state each time rather than trusting either payload directly.

**Subscription statuses referenced in code:** `created`, `authenticated`, `active`, `pending`, `halted`, `cancelled` are all referenced in `pricing-checkout.ts` (blocking-checkout check) and `razorpay-sync.ts` (grace period trigger on `pending`/`halted`; `cancel_at_period_end` set true only on `status === 'cancelled'`).

**Known gaps visible from this read (not exhaustive — not this stream's job to audit):**
- Yearly/annual Razorpay checkout is explicitly blocked in code with a message that it's not available yet for India ("Please use a monthly plan while we test monthly refills end to end") — `pricing-checkout.ts:46-48`.
- No plan-change/upgrade-downgrade, pause, resume, or cancel action found in these files — the blocking-subscription check's own comment says "Subscription changes will stay manual until account management is live."
- No Invoices API usage found — implies no Razorpay-generated GST invoices are being fetched/stored today (see §3 below for whether that's even viable).

---

## 1. Subscriptions (plans, lifecycle, webhooks, updates, pause/cancel, addons)

**Lifecycle states** (source: [Subscriptions States](https://razorpay.com/docs/payments/subscriptions/states/?preferred-country=IN)):
- `created` → subscription initialized, no charge yet.
- `authenticated` → customer completed the authentication transaction (or, if there's an add-on/upfront amount, once that processes). Exits when the billing cycle actually starts or the first charge succeeds.
- `active` → the billing cycle has started (i.e., a successful charge has happened and it's inside a live cycle). Exits on a failed auto-charge (→ `pending`) or a manual pause (→ `paused`).
- `pending` → an auto-charge failed; Razorpay is retrying. Exits on a successful retry/manual charge/re-authentication of a new card (→ back to `active`), or once retries are exhausted (→ `halted`).
- `halted` → all retries exhausted on the last auto-charge. No further auto-charges occur; invoices keep generating but sit unpaid until a successful charge on a new card or an unpaid invoice recovers it.
- `cancelled` → cancelled via API or dashboard. **Terminal — cannot be restarted once cancelled.**
- `paused` → reachable **only from `active`** (see below).
- `expired` → only relevant when `start_at` was set in the future and the authentication transaction never happened by that time.
- `completed` → subscription reached its configured `end_date`.
Source: same page, plus [Update a Subscription](https://razorpay.com/docs/payments/subscriptions/update/?preferred-country=US), [Pause a Subscription](https://razorpay.com/docs/api/payments/subscriptions/pause-subscription/).

**Retry schedule on failed renewal → halted:** Razorpay retries a failed auto-charge on a **T+3 day cycle — once a day for 3 days** after the original failed attempt (so 3 retries after the initial failure, 4 failures total before halt). After the 3rd retry also fails, the subscription moves to `halted`. Source: [Payment Retries](https://razorpay.com/docs/payments/subscriptions/payment-retries/) (via search summary — recommend the checkout-code stream fetch this page directly to confirm exact wording, as this was read via search snippet not a full page fetch). UNCONFIRMED at full-primary-source level — flagged for follow-up fetch if this number matters operationally (it directly determines Kissago's grace-period design).

**Update subscription (plan change):**
- `schedule_change_at`: `now` (default) applies immediately, potentially triggering a prorated charge or refund calculation right away; `cycle_end` defers the change to when the current cycle's invoice is generated — "no amount adjustment with the customer" needed in that case.
- **Razorpay auto-computes proration** (daily-rate based on plan amount/quantity) — merchant does not need to calculate the delta itself.
- Minimum prorated difference to act on: **50 minor currency units (₹0.50)**.
- Only subscriptions in `authenticated` or `active` state can be updated; `created`, `pending`, `halted` cannot.
- **Card-based (domestic card) subscriptions have a materially narrower update surface** — the doc states that for subscriptions created on domestic cards, only the *offer* linked to the subscription can be updated, not a full plan swap. This is a real constraint if Kissago's e-mandate/UPI Autopay users and card users end up on different upgrade paths.
- Only one pending (`cycle_end`) update can be in flight; it can be cancelled via API before it goes live, not after.
Source: [Update a Subscription](https://razorpay.com/docs/payments/subscriptions/update/?preferred-country=US).

**Pause / resume:**
- Pause: `pause_at: "now"` only (immediate). **Only an `active` subscription can be paused** — attempting to pause an `authenticated` subscription cancels it instead (a sharp edge to avoid hitting from application code).
- Pause/resume must be **enabled on the account** by Razorpay support — it is not on by default.
- Paused subscriptions show `charge_at`/`current_end` as `null`. Resume behavior (whether the cycle picks up where it left off or restarts) was not documented on the fetched page — **UNCONFIRMED**, needs a direct question to Razorpay support or a sandbox test before relying on it.
Source: [Pause a Subscription](https://razorpay.com/docs/api/payments/subscriptions/pause-subscription/).

**Cancel immediately vs at cycle end:** the Cancel Subscription API takes a `cancel_at_cycle_end` boolean (1 = let the current paid cycle run out, then stop; 0/absent = cancel now). Not independently re-fetched in this pass (time-boxed) — cross-check against [Cancel a Subscription](https://razorpay.com/docs/api/payments/subscriptions/cancel-subscription/) before implementation. **UNCONFIRMED at full-fetch level**, but this parameter name is well-established in Razorpay's public docs and SDKs, low risk.

**Addons / upfront amounts:** Not independently verified this pass. Razorpay's model supports one-time "addon" charges tacked onto a subscription's next invoice, and an `addons` array + `notify_info` at subscription-creation for an upfront amount charged with the first cycle. Whether an addon can be used as a coin top-up bolt-on (i.e., "buy 500 extra coins on top of your Plus renewal") is plausible from the entity shape but **UNCONFIRMED** — needs a dedicated doc read before Kissago designs around it. Do not build on this without confirming directly.

**`customer_notify`:** Kissago already sets this to `0` on subscription creation (`lib/billing/razorpay.ts:110`), i.e. **Razorpay is told not to email/SMS the customer** about the subscription — Kissago presumably intends to send its own notifications. Confirm this is deliberate; it's easy to end up with customers getting neither Razorpay's nor Kissago's confirmation email if nothing has been built to replace it.

**Subscription links / hosted pages:** Razorpay offers "Subscription Links" (a hosted payment page for a subscription, shareable via link/SMS/email, similar in spirit to Payment Links) as an alternative to embedding Checkout.js. Not used by Kissago today (Kissago uses `subscription_id` inside Standard Checkout instead). Not deep-dived this pass — **flag as a lower-priority alternative**, not needed since Kissago already has embedded checkout working.

**Limits on `total_count`:** Kissago hardcodes `total_count: 1200` for monthly (100 years of monthly cycles) and `100` for annual (100 years) in `createRazorpaySubscription()` — this is a common pattern to emulate "subscribe indefinitely" since Razorpay subscriptions are fundamentally *fixed-count* billing schedules, not open-ended. Razorpay's own docs describe max subscription duration as **100 years**, consistent with Kissago's values. Source: search snippet from Razorpay docs (test-subscriptions page family) — worth a direct fetch to confirm there's no separate hard cap on `total_count` itself distinct from the 100-year duration framing. **UNCONFIRMED at full-fetch level.**

**Test-mode vs live-mode plans:** Test-mode and live-mode are **separate data spaces** in Razorpay generally (confirmed pattern across RazorpayX docs: "A Contact created in test mode does not carry over to live mode and vice versa"). By direct analogy this should hold for Subscriptions Plans/Customers/Subscriptions too — **plans created in test mode will NOT exist in live mode**; Kissago's `ensureRazorpayPlanRef()` lazy-create-and-cache-on-first-checkout pattern means **going live will silently recreate all plans (new plan IDs) the first time each plan version is purchased in live mode**, and the cached `provider_price_ref` on `pricing_plan_versions` from test mode must not leak into a live deploy. This is UNCONFIRMED as a direct Subscriptions-specific doc statement (only confirmed by analogy to RazorpayX docs) — **recommend the admin-tools/DB-state stream verify there's a plan to either wipe `provider_price_ref` on go-live or key plan caching by mode.**

## 2. Payment methods for recurring (e-mandate, UPI Autopay, eNACH, RBI rules)

**AFA (Additional Factor of Authentication) exemption limit:** RBI allows recurring debits **up to ₹15,000 per transaction** to be processed with a single AFA done once at mandate registration (no OTP/PIN needed on each individual debit below that threshold). Above ₹15,000, an AFA (OTP/PIN) is required at the time of that specific debit. Category-specific higher caps exist — e.g. up to **₹1,00,000** for mutual fund SIPs, insurance premiums, and credit-card bill payments (per Razorpay's own blog content, not the primary RBI circular) — **not applicable to Kissago's coin/subscription category**, which stays at the general ₹15,000 threshold. Sources: [RBI Directive on Recurring Card Payments](https://razorpay.com/docs/announcements/rbi-card-mandate-guidelines/recurring-payments/), [Master Recurring Payments with UPI 2.0 Autopay](https://razorpay.com/blog/master-recurring-payments-upi-autopay-guide/) (blog, secondary).

**Pre-debit notification — who sends it, and a contradiction worth flagging:**
- Razorpay's own RBI-guidelines doc page states: **issuing banks** (not Razorpay, not the merchant) send the pre-debit notification, at least **24 hours before the actual debit**, via the customer's chosen channel (SMS/email), and that merchants "do not need to make any integration changes" for this. Source: [RBI Directive on Recurring Card Payments](https://razorpay.com/docs/announcements/rbi-card-mandate-guidelines/recurring-payments/).
- A separate web-search summary (of a different/blog-adjacent source) stated the **opposite** — that "merchants or their payment aggregators must send a notification to the customer at least 24 hours before every scheduled debit." **This is a direct contradiction and was not resolved in this pass** — the primary Razorpay docs page (fetched directly, not via search snippet) is the one that says issuing banks are responsible, which is also consistent with how UPI Autopay/e-mandate notifications work in practice industry-wide (the bank/NPCI layer sends it, not the merchant). **Treat the "issuing bank sends it" version as more likely correct**, but this should be independently verified against the current RBI master circular before Kissago relies on it for a compliance decision (e.g., deciding Kissago does NOT need to build its own pre-debit reminder system).
- Post-debit confirmation is also bank-sent, per the same primary source.

**Mandate cancellation — how Kissago would learn of it:** Customers can revoke a UPI Autopay/e-mandate directly from their bank/UPI app at any time, with AFA, and **merchants cannot block this**. Razorpay's doc says acquiring banks are responsible for instructing the business to delete stored payment data once revoked, again "no integration changes" needed on the merchant side for that specific compliance duty — but this is about data deletion, not about how Kissago's app *finds out the subscription is now dead*. Kissago's own mechanism for detecting a revoked mandate would be the **next scheduled charge failing**, surfacing through `subscription.pending` → retries → `subscription.halted` webhooks (see §1) — there is no evidence of a distinct "mandate revoked" webhook separate from the normal charge-failure/halt flow. **UNCONFIRMED**: whether Razorpay fires anything sooner than the next billing attempt when a mandate is revoked out-of-band; worth a direct sandbox test (cancel a UPI Autopay mandate from a test UPI app, watch for any webhook before the next charge date).

**UPI Autopay app support (as of the fetched sources):** one search summary claimed only BHIM and Paytm support the UPI Autopay merchant-collect flow while ICICI/SBI/HDFC bank apps support UPI-collect-based mandate setup — this reads like it could be stale/incomplete (major UPI apps like Google Pay and PhonePe have supported Autopay mandates for years). **Do not treat this claim as reliable** — it came from a secondary blog-style source, not fetched from a primary Razorpay or NPCI page, and contradicts general market knowledge. Flagged as **UNCONFIRMED / likely inaccurate**, needs a direct NPCI or Razorpay UPI Autopay doc fetch if the specific app coverage matters for launch messaging.

**Card-on-file tokenisation:** Not independently researched this pass (time-boxed against the 10-topic scope) — RBI's CoF Tokenisation mandate (cards cannot be stored raw by merchants/PAs since Oct 2022) is well-established background knowledge and Razorpay handles tokenisation transparently as the PA, but the specific implication for Kissago (e.g., whether re-tokenising after a card is re-issued requires a fresh customer action) was **not confirmed from a primary source in this pass**. Recommend a follow-up fetch of Razorpay's card tokenisation doc if Kissago plans to support card-based recurring alongside UPI Autopay.

**Practical read for Kissago:** since Kissago's monthly plan prices are likely well under ₹15,000 (consumer B2C coin subscriptions), **the general AFA exemption threshold should comfortably cover renewal charges** without requiring step-up authentication on every cycle — this is a meaningful UX win worth confirming against Kissago's actual price points (the checkout-code/DB-state streams will know current plan prices).

## 3. Invoices (auto-gen, Invoices API, GST support, legal validity)
NOT STARTED

## 4. Orders, payments, refunds, disputes
NOT STARTED

## 5. Webhooks (signature, idempotency, retries, ordering, IP allowlist)
NOT STARTED — note §1/§2 above already sourced the subscription-webhook event list and the raw-body HMAC-SHA256 signature scheme (matches what Kissago's code does, see "What Kissago uses today"), but the specific sub-questions (retry policy/duration, delivery ordering guarantees, auto-disable after failures, IP allowlist, recommended event set) are untouched.

## 6. Customer self-service (portal, APIs to build one)
NOT STARTED

## 7. Checkout UX
NOT STARTED — "What Kissago uses today" section already documents Kissago's actual current Checkout.js integration (handler-based, prefill, theme, modal.ondismiss, payment.failed listener, no redirect:true/callback_url). Still need: research into handler vs redirect:true tradeoffs for UPI intent / mobile webviews, retry config, method ordering, saved cards, Magic Checkout relevance, subscription-checkout-specific differences, known in-app-browser issues.

## 8. International
NOT STARTED

## 9. Going live (KYC, activation, settlement, fees)
NOT STARTED

## 10. SDK
NOT STARTED

---

## Implications for Kissago
NOT STARTED — draft once remaining sections are filled. Candidate items already visible from §1/§2 alone (to fold in later):
- Annual/yearly Razorpay checkout is currently hard-blocked in Kissago's own code (not a Razorpay limitation) — worth a decision on whether/when to re-enable given plans likely don't carry over test→live anyway (see §1 test/live note).
- No plan-upgrade/downgrade, pause, or cancel action exists yet in the checkout/action code scanned — Razorpay supports all three (Update Subscription with proration, Pause/Resume, Cancel with cycle-end option) but pause/resume needs to be enabled on the account by Razorpay support first, and domestic-card subscriptions have a narrower update surface than UPI Autopay/e-mandate ones.
- `customer_notify: 0` is set on subscription creation — confirm Kissago has (or plans) its own renewal/receipt emails, or customers get silence from both sides.
- Pre-debit-notification responsibility (issuing bank vs merchant) has a source contradiction — needs resolution before any compliance claim ships in Kissago's docs/ToS (stream 7 territory too).
- Going live will very likely require recreating all Razorpay Plans in live mode (test-mode plan IDs won't carry over) — Kissago's lazy-create-and-cache-on-`pricing_plan_versions` pattern needs a go-live checklist item to avoid live checkout using a stale test-mode `provider_price_ref`. Flag for admin-tools/DB-state stream too.
- AFA ₹15,000 exemption threshold likely covers Kissago's monthly plan prices comfortably (needs confirming against actual price points from another stream) — good for renewal UX (no step-up auth needed most cycles).

## Resume here

Work stopped mid-task per coordinator pause instruction (usage-limiting). State as of pause:

**Done and written to this file:**
- "What Kissago uses today" — complete, based on direct reads of `lib/billing/razorpay.ts`, `lib/billing/razorpay-sync.ts`, `lib/billing/razorpay-shared.ts`, `app/actions/pricing-checkout.ts`, `app/api/billing/razorpay/{prepare,verify,webhook}/route.ts`, `components/pricing/WalletPage.tsx`.
- §1 Subscriptions — mostly complete (lifecycle states, webhook event list, update/proration/schedule_change_at, pause/resume, total_count/duration, test-vs-live-mode plan carryover). Weak spots flagged inline as UNCONFIRMED: exact retry-schedule wording (only have it via search snippet, not a direct page fetch of https://razorpay.com/docs/payments/subscriptions/payment-retries/), addons/upfront-amount mechanics, subscription-links hosted pages, cancel_at_cycle_end parameter (named but not directly re-fetched from https://razorpay.com/docs/api/payments/subscriptions/cancel-subscription/).
- §2 Payment methods for recurring — mostly complete (AFA ₹15,000 exemption limit, category caps, pre-debit notification incl. a flagged source contradiction over bank-vs-merchant responsibility, mandate cancellation/how Kissago would learn of it, UPI app coverage claim flagged as likely-unreliable). Not done: card-on-file tokenisation specifics (only background knowledge, not source-fetched).

**Not started (still need research + writing):**
- §3 Invoices — auto-generation for subscriptions/Orders, Invoices API (create/issue/fetch/cancel/PDF/short_url, email/SMS delivery), GST support (line-item tax rate, HSN/SAC, customer GSTIN, billing address, place of supply, business GSTIN), invoice numbering control, whether Razorpay invoices are legally valid GST tax invoices or Kissago must self-generate, customer download options. Key URLs to start from: razorpay.com/docs/api/invoices/, razorpay.com/docs/payments/invoices/ (unverified — need to search).
- §4 Orders/payments/refunds/disputes — order→payment lifecycle, auto-capture/late-auth, payment statuses, Refunds API (full/partial, normal vs instant/optimum speed, refund webhooks, time-to-credit), disputes/chargebacks API+webhooks, effect of a refund on an active subscription.
- §5 Webhooks — remainder: retry policy/duration, delivery ordering guarantees, auto-disable after repeated failures, IP allowlist, recommended event set for a subscription+topup business. (Signature scheme and event-id idempotency already covered via §1/"What Kissago uses today".)
- §6 Customer self-service — does Razorpay offer an end-customer portal (view/cancel subscription, update payment method, download invoices)? If not, which APIs support building one (fetch invoices by subscription/customer, re-auth link to update payment method).
- §7 Checkout UX — research portion only (Kissago's current usage is already documented). Needs: handler vs redirect:true/callback_url tradeoffs for UPI intent and mobile in-app browsers, retry config, method ordering/config blocks, saved cards, Magic Checkout relevance (likely none — digital goods), subscription-checkout-specific differences, known in-app-browser issues.
- §8 International — accepting international cards (activation steps, currencies, whether Subscriptions product supports international recurring, fee differences), comparison angle to adding Stripe later (light touch only — stream 8 owns the Stripe-readiness comparison in depth).
- §9 Going live — KYC/activation requirements for a digital-content/AI SaaS specifically, website requirements (policy pages, pricing visibility, contact details), common rejection reasons, what must be recreated in live mode (plans, webhooks, keys — partially already implied by §1's test/live plan finding, but needs its own confirmation), settlement timelines, fee structure (domestic/international/UPI/subscriptions, GST on Razorpay's own fees).
- §10 SDK — current `razorpay` Node SDK version, recent breaking changes/deprecations. Quick: also check what version Kissago's package.json actually pins, for a direct gap comparison (read-only check of package.json, already permitted).
- Final "Implications for Kissago" section — has a candidate bullet list seeded from §1/§2 already in the file; needs the remaining sections folded in once done, then trim/dedupe into the final bulleted form tied back to section numbers as the task spec requires.
- Final reply to caller — file path, ≤250-word summary, 5 highest-impact facts — not yet composed (write only after resuming and finishing above).

**Immediate next action on resume:** fetch/search §3 (Invoices) first — it's the section most likely to change Kissago's plan (GST tax-invoice legal validity is a hard blocker-type question), then §4, §5 remainder, §6, §7 remainder, §8, §9, §10, in that order, writing each directly into this file as completed rather than batching.
