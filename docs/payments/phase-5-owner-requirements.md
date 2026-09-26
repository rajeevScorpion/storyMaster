# Phase 5 — owner requirements from the money walk (2026-09-23)

**Binding input to the Phase 5 plan** (`prompt-packs/…/07_PHASE_5_USER_BILLING_CHECKOUT_UX.md`, user billing
& checkout UX). Raised by the owner after running step 1 of `money-walk-runbook.md` on the Preview. Not built
yet; the owner said to fold these into the ongoing implementation, not fix them immediately.

## 1. The billing-details dialog (`components/pricing/BillingDetailsDialog.tsx`)

**Today:** one legal-name field, a state dropdown, then eight fields all marked "(optional)" in a flat grid.
Reads as plain and generic.

### 1a. Look and feel
- Style it like the sign-in modal (`components/auth/AuthDialog.tsx`): same surface, glow, motion and
  hierarchy. Movement, glow and some dynamism, not a flat form. Respect `prefers-reduced-motion`.
- Group fields into sections rather than one uniform grid.

### 1b. Searchable state picker
- Typing filters the list (type "mah" → Maharashtra), with keyboard navigation and Enter to pick.
- **Build it as a `searchable` option on the shared `FilterDropdown`,** not as a new component. The
  one-dropdown rule in WORKING_AGREEMENTS still holds, and other long lists will want the same thing.

### 1c. Personal or business, like claude.ai billing
A two-way toggle at the top: **Personal** (default) or **Business**.

| Field | Personal | Business |
|---|---|---|
| Full name | required | required (the person buying) |
| Billing email | required, prefilled from the account | required, prefilled |
| Phone | required (also prefills Razorpay) | required |
| State | required, searchable | **derived from the GSTIN and locked**, not picked |
| City, PIN code | required | required |
| Address line 1 | optional | required (Rule 46: a B2B tax invoice needs the recipient's address) |
| Address line 2 | optional | optional |
| Company legal name | hidden | required |
| GSTIN | hidden | required |

**Proposed, not yet confirmed by the owner.** The owner asked for "not everything optional" and for user
details; the exact required set above is a recommendation. Confirm it when the Phase 5 plan is approved.

Schema impact: `billing_profiles` already has every column. Only an "is business" marker is missing. It can
be derived (`gstin is not null`), so a migration is needed only if a business profile without a GSTIN is
ever allowed.

### 1d. Validation: inline, on blur, not only on submit
- Email: format.
- Phone: Indian mobile, 10 digits, optional `+91` / leading `0`, normalised before saving.
- PIN code: 6 digits, first digit 1–9.
- GSTIN: the existing regex **plus the check digit** (the 15th character is a mod-36 checksum; the
  regex alone accepts typos). Its first two digits are the state code, so the state is set from it.
- State ↔ PIN: optional soft warning when the PIN's first digits do not fit the state. It is a hint,
  never a block.
- **Server-side validation must match the client exactly.** `validateBillingProfileInput` in
  `lib/billing/billing-profile.ts` is the authority; move the pure rules to a `.shared.ts` so both sides
  import one definition.

## 2. Viewing and editing billing details outside checkout

**Today:** the dialog opens at checkout, and from a small "Billing details · Edit" row on `/wallet`
(shown only while tax is armed). The owner never found that row. There is no Settings → Billing and no entry
point in the account menu.

- The **Settings → Billing** area the Phase 5 prompt already specifies, reachable from the account menu
  (`components/auth/UserMenu.tsx`) and from `/wallet`, with billing details as a first-class card: view,
  edit, switch Personal ↔ Business.
- **Changes apply to future invoices only** (claude.ai behaviour). This needs one thing Phase 5 must add:
  `billing_payments.customer_snapshot_json` is written **null** today, since the ledger supports it but no
  caller passes it. Snapshot the profile onto the payment at checkout, so a later edit can never rewrite
  who a past charge was billed to. Documents (Phase 6) then read the snapshot, not the live profile.

## 3. The Razorpay window: slow to appear, and off-theme

Raised at walk step 4 (subscribe). Razorpay's window is its own iframe. It **can** take: the brand colour
(already emerald `#10b981`), a backdrop colour (set it to the page's neutral-950 so the page doesn't
flash white-grey behind it), the Kissago logo (`image`), name and description, prefilled contact
details, and payment-method ordering. It **cannot** take fonts, dark mode or layout. "Customised to the
Kissago theme" therefore means:
- Set the backdrop, the logo and prefill everything. Prefilling phone skips a Razorpay step, so it
  depends on 1c making phone required.
- Put the Kissago experience **around** the window: the pre-payment summary the Phase 5 prompt already
  requires, then a Kissago-styled "Opening secure checkout…" state from the click until the window is
  visible, and a "Confirming your payment…" state after it closes.

**The wait:** the Razorpay script already loads with the page. The delay is the server preparing the
checkout (for a subscription: create the Razorpay subscription, and the first time per plan, the plan
as well) plus Razorpay's own iframe start. **Measure before optimising.** Time each server call in the
checkout action, and only then decide whether to pre-create anything. The Kissago-styled pending state
is worth doing either way: a blank second feels broken, and a branded one feels deliberate.

## 4. Payment history detail

Subscription payments record their method as `unknown`: the subscription charge path never passes the
payment's method to the ledger, and only top-ups do. The payment history (§2) shows a method column, so
fix it there: take the method from the webhook's payment entity, or fetch it once when the row is
first written.

## 5. Admin: finding a payment

The owner could not find the walk's payment in admin. The data was correct, but it only appeared at the
bottom of one user's record. **Being fixed now, not in Phase 5:** an admin-wide payments list with search
by Razorpay ID or email, and a jump link to Billing on the user record. See `audit-progress.md`.
