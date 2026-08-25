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

3. **Build with `npm run build:verify`, not `npm run build`.** Both `next dev` and `next build` write the same
   directory, and on Windows the collision makes the build stall silently with no output. `build:verify` builds
   into `.next-verify` instead, so it is safe to run while a dev server is up. Plain `npm run build` still writes
   `.next` and still requires the dev server to be stopped.

4. **Never export a non-function value from a `'use server'` file.** Typecheck and lint pass; production throws
   a 500 at runtime. Shared constants belong in a plain module.

5. **Never import a plain value from a `'use client'` module into server code.** You silently receive a
   client-reference stub instead of the value.

6. **Verify in a browser when the change warrants it — using the agent's own server.** `npm run dev:agent` runs
   Next on port 3100 writing `.next-agent`, and `npm run test:e2e` drives it with Playwright. Never touch port
   3000 or `.next`; those belong to the developer. Stop what you start (`npm run dev:agent:stop`). Typecheck and
   lint remain the floor, not the ceiling — a UI change a smoke test could have caught should have one.

7. **Merge to `main` with `--no-ff`**, always — so any deploy can be reverted with a single `git revert -m 1`.

8. **Beat images are 2×2 storyboard grids.** Never render the raw grid to a viewer. Read the rendering rules in
   GOTCHAS before touching any surface that displays beat artwork.

9. **All dropdowns use the shared `FilterDropdown`** component — never a native `<select>`.

10. **Feature-gated code must fail closed** when its flag or migration is missing, so the app still runs on an
    un-migrated database.

## Verification

```bash
npx tsc --noEmit     # must be clean
npm run lint         # must be clean
npm test             # full vitest suite (543 tests, 81 files)
npm run build:verify # builds into .next-verify; safe while a dev server runs
npm run test:e2e     # Playwright smoke over the signed-out surfaces
```

`npm run test:e2e` starts the agent dev server itself if it is not already up. Browser binaries are a
one-time per-machine install: `npx playwright install chromium`.

## Branches

`dev` is the integration branch; `main` is production. Cut feature branches off `dev`, merge back to `dev`,
and promote `dev` → `main` with a `--no-ff` merge commit.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
