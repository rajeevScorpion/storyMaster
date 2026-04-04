# Production Audit — Pre-Merge Findings

**Audited:** 2026-04-03
**Branch:** main (4 commits ahead at time of audit)
**Commits in scope:** 8429c60 → 444ec36 (checkpoint groundwork → polish advanced settings)

Update the **Status** column as each item is resolved. Add `Fixed: YYYY-MM-DD` to the detail section when done.

---

## Summary Table

| ID   | Severity    | Status        | File(s)                                  | Summary                                     |
|------|-------------|---------------|------------------------------------------|---------------------------------------------|
| C-1  | 🔴 Critical | ✅ Fixed 2026-04-03 | `app/actions/story-runtime.ts`      | Client-side Gemini API key in browser bundle |
| C-2  | 🔴 Critical | ✅ Fixed 2026-04-03 | `app/actions/prompt-playground.ts`  | NEXT_PUBLIC key fallback in server action    |
| C-3  | 🔴 Critical | ✅ Fixed 2026-04-03 | `supabase/migrations/014_*.sql`     | Migration 014 depends on 013's column silently |
| H-1  | 🟠 High     | ⏳ Pending    | `lib/store/story-store.ts`               | Unhandled Promise in narration pipeline      |
| H-2  | 🟠 High     | ⏳ Pending    | `app/actions/story-runtime.ts`           | JSON.parse with no try/catch on API responses |
| H-3  | 🟠 High     | ⏳ Pending    | `app/actions/persistence.ts`             | Beat upsert failure silently continues       |
| H-4  | 🟠 High     | ⏳ Pending    | `app/actions/persistence.ts`             | Double-publish race condition                |
| H-5  | 🟠 High     | ⏳ Pending    | `lib/store/story-store.ts`               | Multi-step publish has no rollback/error state |
| H-6  | 🟠 High     | ⏳ Pending    | `lib/ai/story-bible.ts`                  | beat.options accessed without null guard     |
| H-7  | 🟠 High     | ⏳ Pending    | `app/actions/exploration.ts`             | Unsafe `as unknown as` casts on DB results   |
| H-8  | 🟠 High     | ⏳ Pending    | `components/story/StoryScreen.tsx`       | panelDurationMs can be null → storyboard freezes |
| M-1  | 🟡 Medium   | ⏳ Pending    | `components/story/LandingScreen.tsx`     | sessionStorage parsed without schema validation |
| M-2  | 🟡 Medium   | ⏳ Pending    | `lib/ai/story-config.ts`                 | normalizeStoryConfig accepts invalid enum values |
| M-3  | 🟡 Medium   | ⏳ Pending    | `lib/ai/model-config.ts`                 | Empty catch blocks mask model config failures |
| M-4  | 🟡 Medium   | ⏳ Pending    | `components/admin/GlobalSettings.tsx`    | Unhandled rejection on settings load         |
| M-5  | 🟡 Medium   | ⏳ Pending    | `components/admin/GlobalSettings.tsx`    | parseInt validation bug (NaN guard by accident) |
| M-6  | 🟡 Medium   | ⏳ Pending    | `supabase/migrations/011_*_rollback.sql` | Rollback chain broken — DROP TABLE destroys 012-014 data |
| M-7  | 🟡 Medium   | ⏳ Pending    | `app/actions/story-runtime.ts`           | No timeout on Gemini API calls               |
| L-1  | ⚪ Low      | ⏳ Pending    | `supabase/migrations/`                   | Missing 001_initial_schema_rollback.sql      |
| L-2  | ⚪ Low      | ⏳ Pending    | `supabase/migrations/010_*_rollback.sql` | Inconsistent SQL style in 010 rollback       |
| L-3  | ⚪ Low      | ⏳ Pending    | `lib/ai/story-bible.ts`                  | beat.beatNumber can be undefined in registry |
| L-4  | ⚪ Low      | ⏳ Pending    | All action files                         | No structured error logging (console.error only) |

---

## Detailed Findings

---

### C-1 — Client-side Gemini API key exposure
**Severity:** 🔴 Critical
**Status:** ✅ Fixed 2026-04-03
**File:** `app/actions/story-runtime.ts` lines 118, 168, 272, 365

`story-runtime.ts` is `'use client'`. All four Gemini AI instantiations use `process.env.NEXT_PUBLIC_GEMINI_API_KEY`, which Next.js embeds verbatim into the browser JS bundle. Any user can extract the key via DevTools → Sources and make unlimited billed API calls.

Note: `compressImage()` intentionally stays client-side to avoid server-side compression overhead — this is correct architecture.

**Fix approach:** Server proxy pattern.
- Create `app/actions/gemini-proxy.ts` (`'use server'`) with functions that call Gemini using `GEMINI_API_KEY` and return serializable data (JSON text or base64 data URL).
- `story-runtime.ts` imports and calls these proxy functions; `compressImage()` calls remain untouched after receiving raw bytes.
- In `.env.local`: add `GEMINI_API_KEY=<value>`, remove `NEXT_PUBLIC_GEMINI_API_KEY`. ✅ Done.

---

### C-2 — NEXT_PUBLIC key fallback in server action
**Severity:** 🔴 Critical
**Status:** ✅ Fixed 2026-04-03
**File:** `app/actions/prompt-playground.ts` line 61

```ts
const key = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
```

Even though this is a `'use server'` file, the `NEXT_PUBLIC_GEMINI_API_KEY` variable is baked into the client bundle by Next.js at build time (regardless of where it's referenced). It should never be set.

**Fix approach:** Remove the fallback — use only `process.env.GEMINI_API_KEY`.

---

### C-3 — Migration 014 depends on 013's column without a guard
**Severity:** 🔴 Critical
**Status:** ✅ Fixed 2026-04-03
**File:** `supabase/migrations/014_storyboard_vignette_flag.sql`

The `value` column in `feature_flags` was added in migration 013. Migration 014 inserts a row using that column with no guard. On any environment where 013 wasn't applied, 014 fails with `column "value" does not exist`.

**Fix approach:** Add at the top of 014:
```sql
ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS value TEXT NULL;
```

---

### H-1 — Unhandled Promise in narration pipeline
**Severity:** 🟠 High
**Status:** ⏳ Pending
**File:** `lib/store/story-store.ts` ~lines 354–393

`Promise.all([voicePromise, earlySavePromise])` chains further narration work but has no `.catch()`. Failures are silently swallowed; the loading state may never clear.

**Fix approach:** Add `.catch(err => { console.error('Narration pipeline failed:', err); set({ error: err.message }); })`.

---

### H-2 — JSON.parse without try/catch on API responses
**Severity:** 🟠 High
**Status:** ⏳ Pending
**File:** `app/actions/story-runtime.ts` lines 135, 204

```ts
return JSON.parse(text) as StoryBeat;      // line 135
return JSON.parse(text) as StoryboardPlan; // line 204
```

Malformed JSON from Gemini (quota error pages, partial streaming responses) throws a raw `SyntaxError` that propagates uncaught.

**Fix approach:** Wrap both in try/catch; throw a descriptive error with the raw text snippet for debugging.

---

### H-3 — Beat upsert failure silently continues
**Severity:** 🟠 High
**Status:** ⏳ Pending
**File:** `app/actions/persistence.ts` ~lines 242–250

```ts
if (beatsError) {
  console.error('Failed to upsert beats (non-fatal):', beatsError.message);
  // execution continues — story_map JSONB is now orphaned
}
```

The "non-fatal" assumption is incorrect: if beats fail to save, the `story_map` JSONB in the `stories` table diverges from the `beats` table, corrupting the story state.

**Fix approach:** Either throw (triggering rollback of the parent save) or surface the error in store state so the user sees a save warning.

---

### H-4 — Double-publish race condition
**Severity:** 🟠 High
**Status:** ⏳ Pending
**File:** `app/actions/persistence.ts` ~lines 477–494

Check-then-insert pattern with a TOCTOU window:
```ts
const { data: existing } = await supabase.from('storylines').select('id').eq('path_hash', pathHash)...
if (existing) return; // ← race window here
// INSERT
```

**Fix approach:** Replace with `INSERT ... ON CONFLICT (path_hash) DO NOTHING` and check the returned row count; remove the pre-check select.

---

### H-5 — Multi-step publish has no rollback/error state
**Severity:** 🟠 High
**Status:** ⏳ Pending
**File:** `lib/store/story-store.ts` ~lines 645–735

Auto-publish runs four steps sequentially (saveBeat → copyCover → setCoverImage → publishStoryline). If step 2 or 3 fails, step 1's data is committed but the storyline is never published — story left in limbo with no user feedback.

**Fix approach:** Wrap the sequence in try/catch; set a user-visible error state identifying which step failed.

---

### H-6 — beat.options accessed without null guard in validator
**Severity:** 🟠 High
**Status:** ⏳ Pending
**File:** `lib/ai/story-bible.ts` ~lines 108–114

```ts
if (beat.options.length !== 0) { ... }  // TypeError if options is null/undefined
```

If the AI returns a beat without an `options` field, this throws a TypeError instead of a validation error.

**Fix approach:** Add `if (!Array.isArray(beat.options)) { issues.push('options must be an array'); return issues; }` before accessing `.length`.

---

### H-7 — Unsafe type casts on DB results
**Severity:** 🟠 High
**Status:** ⏳ Pending
**File:** `app/actions/exploration.ts` lines 94, 111, 143, 152

```ts
const jsonbMap = dbStory.story_map as unknown as StoryMap;
```

No runtime shape validation. Schema drift or migration errors cause silent incorrect casts that crash downstream.

**Fix approach:** Add a `typeof` guard on critical fields (e.g., `story_map` must be an object with a `nodes` key) before casting. Full Zod validation is ideal but a basic check is the minimum.

---

### H-8 — panelDurationMs can be null → storyboard freezes
**Severity:** 🟠 High
**Status:** ⏳ Pending
**Files:** `components/story/StoryScreen.tsx` ~lines 53–56, `components/story/StorylinePlayer.tsx` ~lines 76–79

```ts
const panelDurationMs = cycleOverride ? cycleMs : !audioUrl ? STORYBOARD_ADVANCE_MS : resolvedAudioDurationMs;
// resolvedAudioDurationMs is initialized as null and stays null if audio metadata never loads
```

The cycling useEffect short-circuits on `null`, so panels freeze indefinitely when audio metadata fails to load.

**Fix approach:** Change the last branch to `resolvedAudioDurationMs ?? STORYBOARD_ADVANCE_MS`.

---

### M-1 — sessionStorage parsed without schema validation
**Severity:** 🟡 Medium
**Status:** ⏳ Pending
**File:** `components/story/LandingScreen.tsx` line 43

```ts
const config = normalizeStoryConfig(JSON.parse(savedConfig) as StoryConfig);
```

`sessionStorage` is writable by injected scripts. No validation that the parsed shape matches `StoryConfig`.

**Fix approach:** Add a basic shape check (non-null object with expected keys) before passing to `normalizeStoryConfig`.

---

### M-2 — normalizeStoryConfig accepts invalid enum values
**Severity:** 🟡 Medium
**Status:** ⏳ Pending
**File:** `lib/ai/story-config.ts` lines 103–114

Invalid strings for `preset`, `theme`, `palette`, `detail` pass through unchecked into image generation prompts.

**Fix approach:** Validate each field against its allowed values list; fall back to default if invalid.

---

### M-3 — Empty catch blocks mask model config failures
**Severity:** 🟡 Medium
**Status:** ⏳ Pending
**File:** `lib/ai/model-config.ts` lines 54, 86, 115, 149

Silent fallback to defaults with no logging makes model misconfiguration invisible in production.

**Fix approach:** Add `console.error('model-config fetch failed, using defaults:', err)` in each catch.

---

### M-4 — Unhandled rejection on GlobalSettings load
**Severity:** 🟡 Medium
**Status:** ⏳ Pending
**File:** `components/admin/GlobalSettings.tsx` line 50

`getGlobalSettings().then(...)` has no `.catch()`. Silent failure; admin page shows stale/default values.

**Fix approach:** Add `.catch(err => setError(err.message))` and render an error message in the UI.

---

### M-5 — parseInt validation bug in GlobalSettings
**Severity:** 🟡 Medium
**Status:** ⏳ Pending
**File:** `components/admin/GlobalSettings.tsx` lines 61, 151, 156

```ts
const ms = parseInt(cycleMsInput, 10);
if (!ms || ms < 500) return;  // NaN guard works by accident; semantics are wrong
```

Also calls `parseInt` three times on the same value.

**Fix approach:** `const ms = parseInt(cycleMsInput, 10); if (!Number.isFinite(ms) || ms < 500) return;` Compute once, reference three times.

---

### M-6 — Rollback chain broken at migration 011
**Severity:** 🟡 Medium
**Status:** ⏳ Pending
**File:** `supabase/migrations/011_feature_flags_rollback.sql`

```sql
DROP TABLE IF EXISTS feature_flags;
```

Rolling back past 011 destroys all data inserted by 012, 013, and 014. The 014 rollback (`DELETE FROM feature_flags WHERE ...`) then fails or is a no-op.

**Fix approach:** Change 011's rollback to `DELETE FROM feature_flags WHERE flag_key IN (...)` for its own seed data. Reserve `DROP TABLE` for a dedicated teardown-only script.

---

### M-7 — No timeout on Gemini API calls
**Severity:** 🟡 Medium
**Status:** ⏳ Pending
**File:** `app/actions/story-runtime.ts` (all AI call sites)

Long-running or hung API calls freeze the UI indefinitely with no recovery.

**Fix approach:** Wrap each call in `Promise.race([aiCall, new Promise((_, rej) => setTimeout(() => rej(new Error('Gemini timeout')), 30_000))])`.

---

### L-1 — Missing 001_initial_schema_rollback.sql
**Severity:** ⚪ Low
**Status:** ⏳ Pending
**File:** `supabase/migrations/`

All migrations 002–014 have rollback files; 001 does not. Breaks convention and automated rollback tooling.

---

### L-2 — Inconsistent SQL style in 010 rollback
**Severity:** ⚪ Low
**Status:** ⏳ Pending
**File:** `supabase/migrations/010_portrait_generation_rollback.sql`

Uses lowercase SQL keywords and has no comment header, unlike all other rollback files.

---

### L-3 — beat.beatNumber can be undefined in registry
**Severity:** ⚪ Low
**Status:** ⏳ Pending
**File:** `lib/ai/story-bible.ts` line 237

`uniqueNumbers([...(existing?.seenInBeats || []), beat.beatNumber])` — if `beatNumber` is undefined, the registry array contains `undefined` entries.

**Fix approach:** Guard with `if (beat.beatNumber != null)` before pushing.

---

### L-4 — No structured error logging
**Severity:** ⚪ Low
**Status:** ⏳ Pending
**File:** All server action files

All errors use `console.error`. On Cloud Run, these won't surface in a queryable log aggregator. Consider Sentry or GCP Error Reporting before go-live.
