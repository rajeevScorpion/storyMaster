# Owner decisions — current product model

These decisions are newer than conflicting older pricing documents/audit recommendations.

Do not re-open them unless current code/provider constraints make them impossible or unsafe. If that happens, explain the conflict and ask before changing product intent.

## 1. Plan architecture

Kissago has four user-facing levels:

| Plan | Story consumption | Included creation allowance | Creation relationship | Indicative India price |
|---|---|---|---|---|
| **Free** | **3 unique stories/day** by current owner decision; value must be admin-configurable | **50 trial coins once** | Trial creation while coins remain; no recurring free coin refill | ₹0 |
| **Audience** | **Unlimited story consumption** | No recurring included creation coins | Consumption-first. User may buy top-up coins for occasional creation if the existing creation entitlement architecture permits this safely | **₹199/month target** |
| **Plus** | Unlimited story consumption | Existing recurring creation allowance from published catalog | Creator subscription | Existing published/admin price |
| **Studio** | Unlimited story consumption | Existing larger recurring creation allowance from published catalog | Higher creator subscription/premium capabilities | Existing published/admin price |

### Audience annual
Audience must also support an annual India subscription.

Current product target:
- ₹199/month;
- ₹1,799/year (roughly ₹150/month equivalent).

These are launch targets, **not hardcoded constants**. Monthly price, annual price/discount and availability must be admin-configurable using the pricing/catalog architecture.

This decision overrides the old blanket statement that "annual plans are out of scope." It does **not** automatically mean Plus and Studio annual India subscriptions must be enabled now. Do not expand scope unless the existing architecture makes that necessary or the owner approves it.

## 2. Free creation trial

Free receives **50 coins once**, not every month.

Required behavior:
- one-time welcome/trial grant;
- valid for 30 days from the grant unless the owner later changes the admin-configurable setting;
- no automatic replenishment after 30 days;
- any unspent trial balance expires;
- purchased top-up coins remain governed by the existing top-up rules, not by this trial expiry.

Investigate the existing `welcome`/free grant behavior and adapt rather than duplicating another grant mechanism.

## 3. Daily consumption quota

Free currently gets **3 unique stories per day**.

The number must be editable by admin.

Owner-approved counting principle:
- count **unique stories consumed that day**, not every press of Play;
- replaying the same story during the same quota day should not consume another slot.

Do not guess the exact technical "consumed" event (page open vs playback start vs playback threshold) or quota reset timezone if the repo does not already define these. Investigate analytics/player behavior and return a recommendation before implementing if ambiguous.

Audience, Plus and Studio have unlimited normal story consumption in this version.

## 4. Coins and consumption are separate concepts

Do **not** charge story viewing out of the creation coin wallet.

Use:
- coins for creation/generative usage;
- plan entitlements + daily quota accounting for story consumption.

This keeps the user mental model clear and avoids mixing creation economics with viewing access.

## 5. Top-ups

Preserve current one-time top-up behavior unless a code-level entitlement conflict is discovered.

Product direction:
- Free can buy top-ups;
- Audience can buy top-ups for occasional creation;
- Plus/Studio can buy top-ups;
- top-ups do not replace the Audience viewing subscription.

If current tier gates prevent Audience from using purchased coins for creation, investigate the cleanest capability-based model and ask before changing product rights.

## 6. User-facing comparison

A clear plan-comparison surface is mandatory.

It must make the Free → Audience → Plus → Studio progression understandable without reading policy text.

At minimum communicate:
- daily story limit / unlimited viewing;
- one-time Free trial coins and expiry;
- recurring included creator coins for Plus/Studio from the live catalog;
- top-up availability;
- creation-oriented capabilities;
- monthly/annual price where applicable;
- annual effective monthly equivalent;
- auto-renewal and cancellation behavior;
- tax-inclusive total where applicable.

Values must come from the same authoritative pricing/entitlement source used by checkout—not duplicated literals in UI.

Exact placement/design must follow the current Kissago information architecture. The existing `/wallet` plan surface is the obvious candidate, but inspect before creating a new `/pricing` route.

## 7. Naming

Customer-facing name: **Audience** (or "Kissago Audience" where context requires).

Do not use "Audience seat" in consumer UI. "Seat" sounds like team/B2B licensing.

Internal keys may differ if required by migration/backward compatibility, but avoid leaking internal keys to user copy.
