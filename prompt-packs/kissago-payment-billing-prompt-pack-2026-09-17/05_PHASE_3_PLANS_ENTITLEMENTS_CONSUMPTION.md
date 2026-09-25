# Phase 3 — Free/Audience/Plus/Studio entitlements and consumption metering

This phase introduces the newly approved product model.

## Do not solve this by scattering plan-name conditionals

Audit the current `free|plus|studio` hardcoding first.

Prefer a capability/entitlement model where plans describe behavior such as:
- daily unique-story quota;
- unlimited consumption;
- welcome/trial coin grant;
- recurring included coins;
- whether creation is available with purchased top-ups;
- download/export capabilities already used by Kissago;
- existing story-length and premium feature rights.

Preserve existing tier behavior unless this phase explicitly changes it.

## Free

Current owner decision:
- 3 unique stories/day;
- daily limit admin-configurable;
- 50 coins once;
- trial coins expire after 30 days;
- no monthly renewal of those 50 coins;
- top-up purchases remain possible;
- no mixing of viewing quota with creation coins.

Investigate and reuse the existing welcome grant mechanism.

## Audience

Create the consumption-first paid plan.

Owner intent:
- unlimited story consumption;
- no recurring included creation coins;
- monthly target ₹199;
- annual target ₹1,799;
- prices/availability/discount admin-configurable;
- top-ups remain available for occasional creation if compatible with the entitlement architecture.

Do not hardcode ₹199/₹1,799 in checkout logic.

### Annual requirement
Audience annual is **in scope now** even though older documents deferred annual plans.

Investigate:
- current `pricing_plan_versions` annual support;
- the existing explicit Razorpay annual block;
- provider lifecycle/mandate implications;
- renewals;
- invoice cadence/document semantics;
- upgrade/downgrade interactions;
- test/live plan references;
- cancellation at cycle end.

Do not automatically enable annual Plus/Studio India plans unless needed or owner-approved.

## Plus / Studio

- unlimited normal story consumption;
- preserve existing creation coin/feature catalog;
- do not hardcode current price/coin numbers;
- existing admin-published catalog remains authority.

## Consumption accounting

### Owner-approved rule
The daily Free quota counts **unique story IDs**, not play clicks.

A replay of the same story on the same quota day does not consume a second slot.

### Investigate before choosing the event
If the repo has no authoritative consumption event, propose options such as:
- first successful playback start;
- minimum playback threshold;
- explicit story-open.

Recommend the least gameable option that does not punish accidental taps or load failures.

### Reset time
Do not guess whether daily reset means:
- user-local day;
- India day;
- UTC day.

Inspect existing timezone/user-preference infrastructure and ask the owner if no established convention exists.

### Server authority
Enforce quota server-side. Client display may be optimistic but cannot be the only protection.

### Concurrency
Multiple tabs/devices must not allow the Free user to exceed the daily unique quota due to race conditions.

### UX
The user must always know:
- today's allowance;
- stories used;
- remaining;
- when it resets in human terms;
- that replay of an already-counted story is allowed;
- what Audience unlocks.

When quota is exhausted, show a premium, contextual Audience upgrade path—not a generic error.

## Admin controls

At minimum:
- Free daily unique-story limit;
- Free trial coin amount;
- Free trial expiry days;
- Audience availability;
- Audience monthly price;
- Audience annual price;
- Audience annual availability/discount display;
- any required consumption feature flag/kill switch.

Reuse existing audited pricing publish/version history where practical.

## Tests

- first 3 unique stories allowed;
- 4th blocked when configured limit=3;
- replay of story 1 allowed after limit reached;
- next quota day resets correctly;
- two devices racing for final slot cannot over-consume;
- admin changing quota changes future enforcement without redeploy;
- Free 50-coin grant occurs once;
- grant expires as configured and never monthly-refills;
- Audience monthly has unlimited consumption;
- Audience annual has unlimited consumption;
- Plus/Studio unaffected;
- top-up creation behavior matches approved capability model.
