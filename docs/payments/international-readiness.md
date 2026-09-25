# International readiness — the US on Razorpay International

Written 2026-09-25 (Payments Phase 8, unit F). Plan: `phase-8-plan.md`. History: `audit-progress.md`.
For the owner and for whoever adds the next country or provider.

## 1. The decision

Kissago sells to the US through **its existing Razorpay account**, with Razorpay International turned
on. There is no second provider. The owner decided this on 2026-09-25 (plan §1, I1-I3), after the
research below showed Razorpay covers what the US launch needs.

The code is built behind two switches, and the US opens only when the owner turns both:
- `pricing_india_only_beta_enabled` (on today) refuses every non-India item;
- `billing_international_countries` (off today, value `US`) must list the customer's billing country.

## 2. What Razorpay International gives us

Read from Razorpay's official docs and pricing on 2026-09-25. **Re-check before relying on any of it
later.**

| Topic | What it says |
|---|---|
| Cards | Visa, Mastercard and Amex. Diners and Discover on request. PayPal is optional. |
| Currencies | 100+, including USD. Amounts in cents. |
| Subscriptions | Can be priced in USD, cards only. "The RBI guidelines apply only to domestic cards and not international cards": no mandate or pre-debit notice for US cards. |
| Fees | Up to 3% platform fee on international cards, plus 18% GST on the fee. Subscriptions on cards add 0.9%. |
| Settlement | In INR, at the rate when the payment was created. The default is T+7 working days. Can instead settle USD into an EEFC account, where refunds and chargebacks also stay in USD. |
| Export proof | An e-FIRA is generated automatically for every international payment. |
| Activation | Dashboard → Account & Settings → International payments → International Cards. Razorpay reviews the request. |
| A trap | "Your international payment will fail if you send us a dummy email id and phone number." The billing profile collects real ones (unit B). |

**Sources:**
- [International payments docs](https://razorpay.com/docs/payments/payments/international-payments/)
- [International payments FAQs](https://razorpay.com/docs/payments/international-payments/faqs/)
- [Subscriptions FAQs](https://razorpay.com/docs/payments/subscriptions/faqs/)
- [Pricing](https://razorpay.com/pricing/)
- [e-FIRA](https://razorpay.com/blog/e-fira/)
- [EEFC settlement](https://razorpay.com/blog/razorpay-eefc-for-international-card-payments/)

## 3. How a US sale works in the code

- **Billing details** (unit B):
  - the country is `US`, with a US state in `billing_profiles.region`;
  - `state_code` is `96` (GST's "Other Countries");
  - the phone is stored as `+1…`.
  - The country picker appears only while `billing_international_countries` lists a country.
- **Checkout** (unit AC):
  - The tax rule is chosen by the **billing country**, never by the market the visitor picked. A US
    profile gets the `ROW` rule, with regime `in_export_lut`: 0%, supply type `export`.
  - An India profile can't buy a ROW price. A US profile can't buy an India price.
  - A country not in the flag is refused.
  - The ROW rule ships as a **draft**, so ROW checkout refuses until it is published.
- **Evidence** (unit AC):
  - Razorpay's `international` and `card.country` are stored on the payment's purchase snapshot.
  - `/admin/pricing/billing-incidents` lists export sales paid with a domestic card: a possible India
    resident using a US address.
- **Documents** (unit D):
  - the same `KG/` series;
  - place of supply "Other Countries (96)";
  - the endorsement "Supply meant for export under LUT without payment of IGST", plus the LUT ARN
    once set;
  - IGST @ 0%;
  - amounts and words in USD.
- **Annual plans:** refused for every Razorpay item, India included. The US launches on monthly plans
  and top-ups.

## 4. Adding another country

Each step is needed; skip none.

1. **Tax position first.** Ask the CA. For the EU and the UK, a non-resident selling digital services
   to consumers owes VAT from the first sale, so Kissago would need a VAT registration (EU non-Union OSS,
   UK VAT) before selling there. That's why the launch is US-only.
2. **Code:**
   - add the country to `SUPPORTED_BILLING_COUNTRIES` (`lib/billing/international.shared.ts`);
   - add its validation branch (region list, postal code, phone) in `lib/billing/billing-profile.shared.ts`;
   - add its phone case in `normalizeBillingPhone`.
3. **Tax rule:** the ROW export rule covers any country the CA agrees is a zero-rated export. A country
   that needs VAT collected needs its own regime and rule. That is a design change, not a value change.
4. **Open it:** add the code to `billing_international_countries`'s value.
5. **Policy text:** check that the Refund Policy's "customers outside India" section still holds.

## 5. If a second provider is ever needed

The owner dropped the runtime adapter on 2026-09-25 (I1), because Razorpay covers the US. This is the
contract to extract **when a second provider is actually chosen**. Its shape depends on which kind
(§5.2).

### 5.1 The contract

```ts
interface BillingProvider {
  readonly id: 'razorpay' | 'stripe' | string;
  mode(): 'test' | 'live';

  createCheckout(input: {
    kind: 'topup' | 'subscription';
    amountMinor: number;
    currencyCode: string;
    providerPriceRef?: string | null; // a subscription plan, created lazily as today
    customer: { email: string; phone: string | null; name: string | null };
    notes: Record<string, string>;
  }): Promise<{ providerOrderId?: string; providerSubscriptionId?: string; clientPayload: unknown }>;

  confirmPayment(input: { clientResult: unknown }): Promise<{ ok: boolean; providerPaymentId: string | null }>;

  parseWebhook(rawBody: string, headers: Headers): Promise<NormalizedBillingEvent | null>;

  fetchPayment(providerPaymentId: string): Promise<NormalizedPayment>;
  fetchSubscription(providerSubscriptionId: string): Promise<NormalizedSubscription>;
  cancelSubscription(providerSubscriptionId: string, opts: { atCycleEnd: boolean }): Promise<NormalizedSubscription>;
  refund(providerPaymentId: string, amountMinor: number): Promise<NormalizedRefund>;
  fetchRefund(providerPaymentId: string, providerRefundId: string): Promise<NormalizedRefund>;
}
```

- The `Normalized*` shapes are what `lib/billing/razorpay-sync.ts` already maps Razorpay entities onto
  before calling `lib/billing/ledger.ts`. Extracting them means moving that mapping behind the
  interface, not inventing new records.
- The ledger, entitlements, documents, notifications and health cards are already provider-neutral.
  They take `provider` and `providerMode` as inputs.
- **Where Razorpay is called directly today** (plan §2, the call-site table):
  - checkout create;
  - the verify route;
  - the webhook route and processor;
  - the sync mappers;
  - the customer cancel (`billing-account.ts`);
  - the admin refund and cancel (`admin-billing-actions.ts`);
  - the reconcile;
  - the client checkout window.
  - Each becomes a call through the interface.
- **Schema:** the provider CHECKs allow `stripe` and `razorpay` only. Any other provider needs a
  one-line migration per table.

### 5.2 Stripe vs a merchant of record

| | Stripe (via a foreign entity) | A merchant of record (Paddle, Lemon Squeezy, …) |
|---|---|---|
| Who sells | Kissago (or its foreign entity) | The MoR resells to the customer |
| Invoices | Ours, as today | **Theirs.** Our documents stop for their sales. |
| VAT / sales tax | Ours to register and collect | Theirs |
| Refunds and disputes | Ours, through the API | Partly theirs; our admin refund may become a request |
| What the contract loses | Nothing | `refund` may become async or unavailable; documents and tax move out of our code for that provider |

Stripe India has been invite-only since May 2024 (research on 2026-09-17). Check the current status
before choosing.

## 6. Questions for the CA (the US switch-on gate)

These are the same questions as plan §6, kept here so the doc stands alone:
1. Is Kissago's online, automated ("OIDAR") service an **export of services** to a US consumer, with a
   US billing address and a foreign card? Is that enough place-of-supply evidence?
2. Do we file an **LUT** and supply without IGST, or pay IGST and claim a refund?
3. May export invoices share the `KG/` series? What must they say?
4. Must an export invoice also show an **INR value**? At what rate?
5. **US sales tax:** when do state economic-nexus thresholds bite for a foreign digital seller? Does any
   state reach it from the first sale?
6. Confirm the EU/UK position (§4, step 1) that justifies the US only.

The steps to switch the US on are in `go-live-runbook.md` §12.
