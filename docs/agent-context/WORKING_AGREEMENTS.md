# Working Agreements

How work gets delivered on this project. These are the owner's standing preferences, learned over many
sessions — treat them as requirements, not suggestions. If a change here is needed, it is the owner's call.

---

## Database migrations

**Every schema change ships as a numbered SQL file plus a matching rollback file.**

```
supabase/migrations/NNN_short_name.sql
supabase/migrations/NNN_short_name_rollback.sql
```

The rollback contains the reverse statements (`DROP` / `ALTER … DROP COLUMN` / flag deletion). Never deliver
inline SQL in chat as the only artifact.

**Never run the Supabase CLI. Never apply a migration programmatically.** The owner runs every migration by
hand in the Supabase dashboard SQL editor, against each environment separately. Your job ends at producing
the file and saying clearly which environments still need it.

A direct consequence: **dev and production drift**. A feature can be merged and deployed while its migration
is unapplied on one environment. Code must therefore *fail closed* — detect the missing column or table and
degrade, rather than 500. This has already caused one production outage (batch narration 500ing because
`069_narration_accent.sql` was never applied to prod).

**Every migration from 102 onward records itself in `public.schema_migration_ledger`** (introduced in
`101_schema_migration_ledger.sql`). Add this as the final statement of the migration file:

```sql
INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (102, '102_short_name.sql')
ON CONFLICT (migration_number) DO NOTHING;
```

and the mirror in that migration's `_rollback.sql`:

```sql
DELETE FROM public.schema_migration_ledger WHERE migration_number = 102;
```

This exists because there was previously no way to ask a database "has migration NNN actually run here?"
other than inferring it from column/table existence or trusting `PROJECT_STATE.md`, which has gone stale at
least once. The ledger is queryable directly per environment via the read-only Supabase MCP connection —
`select * from public.schema_migration_ledger where migration_number = NNN` — and is the source of truth over
any doc. The Supabase dashboard's own "saved queries" list is **not** evidence either way; it is client-side
history unrelated to whether SQL actually executed.

## Verification before saying "done"

The expected gate for any change:

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build:verify   # builds into .next-verify; safe while a dev server runs
npm run test:e2e       # Playwright smoke, signed-out
```

`npm run lint` is clean — no expected warnings. It previously carried one in `AdvancedOptions.tsx`; that is
gone as of the 2026-08-25 dependency update.

**Browser verification is now expected where it adds proof, and the agent owns the tooling for it.** This
reverses the earlier rule. `npm run dev:agent` runs a dev server on port 3100 against `.next-agent`, entirely
separate from the developer's port 3000 and `.next`; `npm run test:e2e` drives it with Playwright. The
guardrails: never take port 3000 or `.next`, always stop what you start, and prefer adding a durable spec in
`e2e/` over one-off clicking, so the next change re-runs the same proof in seconds.

The earlier rule existed because an unprompted browser-verification effort — spinning up a dev server and
hand-building a DevTools driver — was interrupted as a waste of time. The objection was to the improvised
harness, not to browser testing; with a real one in the repo, that cost is paid once.

Report honestly what was and wasn't verified. "tsc, lint, unit tests and build:verify green; e2e smoke covers
the signed-out surfaces only, so the owner path is unverified" is a good report. Claiming a build passed when
it never ran is not. Note that "the dev server holds `.next`" is no longer a valid excuse for an unrun build —
`build:verify` writes elsewhere.

## Git

- `dev` is the integration branch. `main` is production.
- Feature branches are cut off `dev` and merged back into `dev`.
- **Promote `dev` → `main` with `--no-ff`, always.** Never fast-forward.

```bash
# on dev: commit and push first
git checkout main
git pull
git merge dev --no-ff -m "Merge dev: <summary>"
git push
git checkout dev
```

**Why:** a `--no-ff` merge commit makes any deployment revertible in one step with
`git revert -m 1 <merge-commit>`. A fast-forward destroys that property.

The same applies to large feature merges into `dev` — merging a 14-commit feature with `--no-ff` means the
whole feature can be reverted as a unit.

## Planning and execution

The owner **plans with one model and executes the plan on Opus**, switching models after approving the plan.
Each execution session therefore starts cold, with none of the planning session's exploration in context.

**Implementation plans must be self-contained handover documents.** A plan is finished when a fresh session
could execute it without re-deriving discovery:

- exact file paths and function names
- line-anchored descriptions of each edit
- the complete migration SQL, not a description of it
- a "verified current-state facts" section recording what was actually checked in the code
- a per-phase verification section

Intent alone is not a plan.

## UI conventions

- **All dropdowns use the shared `FilterDropdown`** (`@/components/ui/FilterDropdown`). Never a native
  `<select>`. It takes `value`, `options` (`{value, label}[]`), and `onChange`, and carries the app's dark
  theme — animated, backdrop blur, emerald accents, checkmark indicators.
- Row actions collapse into the shared `RowActionsMenu` (⋮) rather than a row of hover-revealed icons.
  Hover-only controls are unreachable on touch devices unless they also carry the `touch-visible` class.

## Scope discipline

Deferred work is recorded, not silently dropped — see [PROJECT_STATE.md](PROJECT_STATE.md) for the standing
list of known gaps and deferred items. When you defer something deliberately, add it there.
