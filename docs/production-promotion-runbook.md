# Production promotion runbook — Agentic Creator (dev → main)

Written 2026-09-14, when `feat/agentic-creator` merged into `dev` for online testing.
**Nothing here has been executed.** This is the list to work through when the owner decides to promote.

Scope of this promotion: `dev` and `main` held identical *content* before the merge (`main` was only
ahead by four `--no-ff` promotion merge commits, which carry no unique work). So promoting `dev` to
`main` now ships **exactly the Agentic Creator system — 155 commits, 210 changed files, 16 migrations.**

**The blast radius is wider than `lib/agentic/`.** The branch also changes shared pricing
(`pricing-enforcement`, `pricing-runtime`), narration (batch and interactive), `story-runtime`,
`beat-bundle`, the `/story/[id]` and `/explore/[id]` layouts, and the anonymous gallery RLS policy.
Do not treat this as an isolated feature behind a flag: migration **116** changes what signed-out
visitors can read, and it applies the moment it is run, flags or no flags.

---

## 1. Before touching production

- [ ] Finish the three verifications still owed on **dev** — they are listed in
      `docs/agentic-creator-phase10-handoff.md` section 2 and none has been reported done:
      signed-out gallery after 116, the reviewer-billing proof read from the database, and Unit 9J.
      Promoting before these is promoting untested behaviour.
- [ ] Confirm the prod ledger really is empty for this range, rather than trusting this document:
      `select migration_number from public.schema_migration_ledger where migration_number >= 102 order by 1;`
      Expect **zero rows**. The ledger is the only source of truth; `PROJECT_STATE.md` has gone stale before.
- [ ] Take note of prod's current `feature_flags` rows so the post-deploy state can be compared.

## 2. Migrations — apply by hand, in numeric order

Sixteen files. **There is no 109** (deliberate — see PROJECT_STATE); do not go looking for it and do
not treat 110 as blocked on it. Each file records itself in `schema_migration_ledger` as its last
statement, so re-running one is safe but pointless.

| Order | Migration | Notes |
|---|---|---|
| 1 | `102_agentic_creator_flags` | six `agentic_*` flags, all `false`. Nothing observable changes |
| 2 | `103_agent_personas` | **must precede 104, 105 and 106** — they FK to its tables |
| 3 | `104_seed_agent_personas` | inserts the 15 seed personas; 103's trigger creates 15 memory rows |
| 4 | `105_agent_story_memory` | |
| 5 | `106_agent_tasks` | |
| 6 | `107_agent_runs` | |
| 7 | `108_agent_evaluations` | |
| 8 | `110_riya_sen_narration_voice` | data-only; depends on 103 + 104, not on a contiguous run |
| 9 | `111_agent_reviewers` | lands empty — only `ADMIN_USER_ID` passes `requireReviewer()` until a row exists |
| 10 | `112_agent_review_decisions` | |
| 11 | `113_agent_reviewer_roles` | **drops** `can_publish` / `can_trigger_media`. Safe only because 111 is empty on prod |
| 12 | `114_agent_review_assignments` | |
| 13 | `115_beats_owner_only_writes` | ⚠ **RLS change.** Apply only *after* the deploy in §4, never before — see below |
| 14 | `116_narrow_anonymous_stories_read` | ⚠ **affects signed-out visitors immediately.** See below |
| 15 | `117_agent_review_decisions_reviewer_index` | additive index |
| 16 | `118_rename_agentic_pipeline_image_flag` | order-independent: UPDATEs 102's row, or INSERTs it off |

**115 must come after the code deploy.** It narrows `beats` INSERT/UPDATE RLS to the story owner. The
application-level gates that make this safe ship in the code; applying 115 while prod still runs the old
code means a non-owner's continuation is charged and generated, then refused at the database — the
charge-and-write-nothing failure this project has already fixed four times.

**116 is the one that can take the gallery down.** It narrows the anonymous `stories` policy. The gallery
joins `stories!inner(...)` on the anon client, so if it over-narrows, the signed-out gallery renders
**empty rather than erroring** — no exception, no log line, just no content. Immediately after applying it,
load `/` in a signed-out/private window and confirm the rails populate. Its `_rollback.sql` restores the
old policy exactly.

## 3. Environment — the step most likely to be missed

- [ ] **Create a new Supabase auth user in the *production* project** to own agent-generated stories,
      and set its UUID as `AGENTIC_SYSTEM_USER_ID` in Vercel (production scope).
      **It is a different UUID from dev's — copying dev's value across is wrong.**
      *Failure mode:* `lib/pricing/enforcement.ts` compares `input.userId === process.env.AGENTIC_SYSTEM_USER_ID`.
      A wrong or unset value means the bypass stops matching and agent runs are **denied**, not billed.
      That fails closed — safe, but it presents as "agent runs mysteriously fail", not as a config error.
- [ ] `CRON_SECRET` — **no action.** Already set on Vercel. The agentic worker reuses it and piggybacks the
      existing daily `/api/batch/reconcile` cron rather than adding a `vercel.json` entry (Hobby allows one).
- [ ] `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` — **no action.** Local test-only; never set in production.

## 4. Deploy

```bash
git checkout main
git pull
git merge dev --no-ff -m "Merge dev: Agentic Creator system (Phases 1-11)"
git push
git checkout dev
```

`--no-ff` is required, not stylistic: it makes the whole promotion revertible with
`git revert -m 1 <merge-commit>`. A fast-forward destroys that.

## 5. Flags — leave them off

All six `agentic_*` flags land `false` and **stay** `false`. Turning the system on is a separate,
deliberate act after prod is verified quiet. For reference, dev currently runs:

| Flag | dev | prod at promotion |
|---|---|---|
| `agentic_creator_enabled` | on | **off** |
| `agentic_billing_bypass_enabled` | on | **off** |
| `agentic_reviewer_workflow_enabled` | on | **off** |
| `agentic_pipeline_image_generation_enabled` | off | off — and enforced **nowhere in code**, so it does nothing either way |
| `agentic_scheduler_enabled` | off | off |
| `agentic_supervisor_enabled` | off | off |

## 6. After deploying

- [ ] Signed-out `/` — gallery rails populate (the 116 check; do this first).
- [ ] A signed-in non-owner can still read in-story beat images on a published storyline. This exercises
      the `story-assets` policy the branch deliberately left wide; if it broke, that is why.
- [ ] Ordinary story generation, one beat, on a real account — the branch touched `story-runtime`,
      `beat-bundle` and pricing, so this is the regression that matters most and has nothing to do with agents.
- [ ] Narration on a normal user's story still bills that user (batch and single-beat paths both changed).
- [ ] `/admin/agents` renders with the flags off.
- [ ] Ledger shows 102-118 present: `select count(*) from public.schema_migration_ledger where migration_number >= 102;` → **16**.

## 7. If it goes wrong

Revert the deploy with `git revert -m 1 <merge-commit>` and push. Code reverts cleanly; **migrations do
not roll back automatically**. Each has a `_rollback.sql` twin, but only 115 and 116 change existing
behaviour — the rest are additive and can be left in place while the code is reverted, because all the
application code fails closed when the tables are absent and behaves identically when they are present
but the flags are off.

## 8. Deferred — not part of this promotion

Assignment notifications and role-change audit history are deferred by the owner (2026-09-14) and are
**not** in scope here. See PROJECT_STATE's "Deferred / known gaps".
