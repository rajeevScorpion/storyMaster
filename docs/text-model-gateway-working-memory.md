# Text Model Gateway — Working Memory

Short and current. Read this first, then the plan: [text-model-gateway-plan.md](text-model-gateway-plan.md).
Branch `feature/text-model-gateway` off `dev`. Pack: `prompt-packs/kisago_text_model_gateway_prompt_pack/`.

---

## Session handoff — 2026-09-14 close of session 1 (P3 done and reviewed; P4a next)

**Supersedes the P3 row below:** P3 landed as `968a7f2` (57 new tests, full suite 1102 green) and Opus
reviewed it. The follow-up commit on top of it fixes what review found: both adapters now keep the
provider's HTTP status and a trimmed upstream error message (Gemini previously swallowed every SDK error
into one generic message; OpenAI/OpenRouter dropped `error.message`, the only clue to a Luna 400), and a
non-abort network failure is `provider_error`, not `timeout`.

**Known P3 gaps, not blocking — fold into P4a:**
- Telemetry metadata no longer carries `promptChars` / `temperature` / `referenceCount` (the old proxy sent
  them). Add an optional `telemetryMetadata` to the request and pass them from the wrappers.
- Gemini `finishReason` / `promptFeedback.blockReason` are not mapped (the old code didn't either).
- `.env.local` has an empty `OPENROUTER_API_KEY=""` placeholder for the owner to fill.

**Next session:** ask the owner for a usage reading, then delegate P4a (plan section 5) to Sonnet with the
gaps above added to its brief. Then P4b, then P5. Migration 119 is still unapplied everywhere.

---

## Earlier handoff — 2026-09-14 (P2 done; P3 was running)

### Where things stand

| Phase | State |
|---|---|
| P1 plan | **Done** — `3da6952` |
| P2 registry (migration 119) | **Done** — `7065153`, reviewed by Opus. Two review fixes to `lib/ai/text-models.ts` (provider key always required by `getMissingEnvVars`; latch comment) ride in the P3 commit. |
| P3 gateway + wrappers | Delegated to Sonnet late in session 1. **Next session: check `git log` first.** If a `feat(text-models): provider gateway…` commit exists, review its diff against plan 3.3/3.4 before anything else; if not, check `git status` for partial work and finish or redo P3. |
| P4a call sites + write validation | not started |
| P4b admin surfaces | not started |
| P5 smoke, gate, docs | not started |

Migration 119: **written, not applied anywhere** (as of session 1 close). Freeze the file once the owner applies it.

### Reviewer additions agreed after the plan was written (apply to P3+)
- `TextGenerationRequest.strictModel`: fallback → throw `model_unavailable` (admin playground uses it in P4a).
- Output cap sent only when `maxOutputTokens > 0`. Router does not re-warn on fallback (resolver already does).
- A process that latched "registry missing" stays Gemini-only until restart/redeploy — applying 119 needs one.

### Next-session start
Opus: read this file and the plan, check P3 state as above, ask the owner for a usage reading, then delegate
P4a (plan 5) to Sonnet. P4b after, then P5.

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
- After P2 (two discovery agents + P2 cost ~47 points): 63%. During P3: 76% — delegation stopped after P3.
