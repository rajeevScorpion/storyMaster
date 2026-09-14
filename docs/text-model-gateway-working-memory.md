# Text Model Gateway — Working Memory

Short and current. Read this first, then the plan: [text-model-gateway-plan.md](text-model-gateway-plan.md).
Branch `feature/text-model-gateway` off `dev`. Pack: `prompt-packs/kisago_text_model_gateway_prompt_pack/`.

---

## Session handoff — 2026-09-14 (plan written; P2 next)

### Where things stand

| Phase | State |
|---|---|
| P1 plan | **Done** — plan + this file |
| P2 registry (migration 119) | next |
| P3 gateway + wrappers | — |
| P4a call sites + write validation | — |
| P4b admin surfaces | — |
| P5 smoke, gate, docs | — |

Migration 119: **not written yet, not applied anywhere.**

### Owner decisions that bound the work
- Repair loop **deferred** (conflicts with D9).
- No routing change on deploy; owner switches tasks in Admin.
- Non-Gemini rows seed disabled. IDs verified online 2026-09-14 (plan 2.4).
- Smoke: tiny paid calls on all three providers once `OPENROUTER_API_KEY` is filled in.

### Things a fresh session would otherwise re-derive
- The model id a server action receives on the reader path comes from the client. Resolve every id against the
  registry; never pass a raw id to a paid provider.
- Luna rejects `temperature` (HTTP 400). Qwen 3.7 Flash has JSON mode only, no strict schema.
- `estimateCost` returns 0 for unknown model ids — non-Gemini cost must come from the row or `usage.cost`.
- `vitest.smoke.config.ts` runs every `*.smoke.ts`; gate new smoke files behind an env var.
- `app/actions/playground.ts` is dead code (no importers). Don't migrate it.
- Prod `model_config` was not queried (read denied). The owner runs the plan's pre-apply check before 119 on prod.

### Usage log
- 2026-09-14 start of implementation: 16%.
