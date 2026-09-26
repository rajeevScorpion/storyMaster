# System acceptance criteria

The implementation is not complete until these are true or explicitly marked deferred with owner approval.

## Checkout and money
- [ ] New checkout can be disabled server-side.
- [ ] No client-controlled ID can reassign provider objects or benefits.
- [ ] Capture/first-charge semantics are provider-authoritative.
- [ ] Concurrent callback/webhook/reconcile cannot duplicate grants.
- [ ] Missed/failed webhooks recover.
- [ ] Test/live provider references are isolated.
- [ ] Overlapping subscription attempts are prevented.
- [ ] Monthly and Audience annual flows are verified in sandbox.

## Plan model
- [ ] Free: 3 unique stories/day from admin-configured value.
- [ ] Free: 50 trial coins once; configurable amount/expiry; no monthly refill.
- [ ] Audience monthly is configurable and works.
- [ ] Audience annual is configurable and works.
- [ ] Audience has unlimited story consumption.
- [ ] Plus/Studio have unlimited story consumption.
- [ ] Consumption does not spend coins.
- [ ] Replays of same story/day do not consume another Free slot.
- [ ] Audience/Free top-up creation behavior matches approved capability model.
- [ ] No widespread brittle plan-name conditionals were added.

## User UX
- [ ] Clear Free/Audience/Plus/Studio comparison.
- [ ] UI values come from authoritative catalog/entitlements.
- [ ] Annual price is not presented misleadingly as monthly billing.
- [ ] Auto-renewal/tax/cancellation disclosures are visible at purchase.
- [ ] Pending/async payment states are handled.
- [ ] Billing settings show current plan/status.
- [ ] Payment history is in real currency.
- [ ] Invoice/receipt download works.
- [ ] Cancel/resume/recovery works under supported states.
- [ ] Mobile/accessibility pass.

## Admin/support
- [ ] User billing state visible without SQL.
- [ ] Refund/cancel/re-sync/reprocess actions are safe and audited.
- [ ] Negative coin adjustment/clawback exists under approved rules.
- [ ] Failed webhook/reconcile mismatches are visible.
- [ ] Consumption quota/config visible and editable.
- [ ] Active-subscriber safety around catalog changes.

## Records/documents
- [ ] Every charge has a durable payment record.
- [ ] Refunds have durable records.
- [ ] Historical financial records survive user deletion per approved retention.
- [ ] Billing profile changes affect future documents only.
- [ ] Tax/document logic has owner/CA confirmation where required.
- [ ] Generated PDF is access-controlled.
- [ ] Email notifications work or approved fallback is active.

## Operations
- [ ] Test + live webhook setup documented.
- [ ] Capture configuration documented.
- [ ] Reconcile scheduled and observable.
- [ ] Incident kill switches documented.
- [ ] Controlled live smoke test completed.
- [ ] Final handoff/runbook current.
