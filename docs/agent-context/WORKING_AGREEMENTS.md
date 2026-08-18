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

## Verification before saying "done"

The expected gate for any change:

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build      # dev server must be stopped first
```

`npm run lint` has one pre-existing warning in `AdvancedOptions.tsx`; that is the known-clean baseline.

**Do not launch the dev server or drive the app in a browser to verify a change unless the owner asks or
approves it first.** For UI and layout work, typecheck plus lint is the expected level of proof. Offer browser
QA as an option and let them decide. (This rule exists because an unprompted browser-verification effort —
spinning up a dev server and building a DevTools driver — was interrupted as a waste of time and tokens.)

Report honestly what was and wasn't verified. "tsc and tests green, build not run because the dev server holds
`.next`, browser QA pending" is a good report. Claiming a build passed when it never ran is not.

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
