# AGENTS.md

Instructions for AI coding agents (Codex, Claude Code, and others) working in this repository.

## Start here

Read [CLAUDE.md](CLAUDE.md) first — it is the canonical architecture and conventions document for this
project, and it applies to every agent regardless of vendor. Then, before non-trivial work:

- [docs/agent-context/WORKING_AGREEMENTS.md](docs/agent-context/WORKING_AGREEMENTS.md) — how work is delivered here
- [docs/agent-context/PROJECT_STATE.md](docs/agent-context/PROJECT_STATE.md) — shipped vs. pending, migration status
- [docs/agent-context/GOTCHAS.md](docs/agent-context/GOTCHAS.md) — traps already paid for once

## The rules that break things if ignored

These are repeated here because violating them causes real damage, not just style drift.

1. **Never run the Supabase CLI and never apply a migration yourself.** Deliver `supabase/migrations/NNN_name.sql`
   plus a matching `NNN_name_rollback.sql`. The user applies them by hand in the Supabase dashboard.

2. **Never commit secrets.** Every `.env*` file except `.env.example` is gitignored and must stay that way.
   If you add an env var, document it in `.env.example` with an empty value.

3. **Stop the dev server before `npm run build`.** On Windows both write `.next`; the build stalls silently with
   no output, and deleting `.next` under a live dev server makes it 500 on every route.

4. **Never export a non-function value from a `'use server'` file.** Typecheck and lint pass; production throws
   a 500 at runtime. Shared constants belong in a plain module.

5. **Never import a plain value from a `'use client'` module into server code.** You silently receive a
   client-reference stub instead of the value.

6. **Don't launch the dev server or drive a browser to verify a change unless asked.** `npx tsc --noEmit`
   plus `npm run lint` is the expected verification for UI work. Offer browser QA; don't assume it.

7. **Merge to `main` with `--no-ff`**, always — so any deploy can be reverted with a single `git revert -m 1`.

8. **Beat images are 2×2 storyboard grids.** Never render the raw grid to a viewer. Read the rendering rules in
   GOTCHAS before touching any surface that displays beat artwork.

9. **All dropdowns use the shared `FilterDropdown`** component — never a native `<select>`.

10. **Feature-gated code must fail closed** when its flag or migration is missing, so the app still runs on an
    un-migrated database.

## Verification

```bash
npx tsc --noEmit     # must be clean
npm run lint         # one pre-existing warning in AdvancedOptions.tsx is expected
npm test             # full vitest suite
npm run build        # only with the dev server stopped
```

## Branches

`dev` is the integration branch; `main` is production. Cut feature branches off `dev`, merge back to `dev`,
and promote `dev` → `main` with a `--no-ff` merge commit.
