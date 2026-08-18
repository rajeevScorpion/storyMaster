# Setting up a new development machine

Everything needed to go from a bare machine to a running Kissago dev environment. Written for Windows (the
project's primary platform), but the only Windows-specific parts are the shell commands and the `.next`
locking behaviour.

---

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| **Node.js** | **22.13+ or 24** | `@google/genai` 2.12 declares `node ^22.13.0 \|\| >=24`. The project ran on 22.11 with an `EBADENGINE` warning; start clean instead. |
| **npm** | bundled with Node | The repo pins exact versions via `package-lock.json` — use `npm ci`, not `npm install`. |
| **Git** | any recent | |
| **VS Code** | any recent | The project is developed with the Claude Code extension. |

No Supabase CLI, Docker, or Postgres is needed locally — the app talks to hosted Supabase.

## 2. Clone

```bash
git clone https://github.com/rajeevScorpion/storyMaster.git
cd storyMaster
git checkout dev          # dev is the integration branch; main is production
npm ci
```

Only `dev` and `main` exist. Feature branches are cut from `dev` as needed.

## 3. Environment variables

**Secrets are not in the repository and never will be.** `.gitignore` excludes every `.env*` file except
`.env.example`.

Bring the three env files over from the old machine by hand — password manager, encrypted archive, or USB:

```
.env.local          # what `npm run dev` reads
.env.development
.env.production
```

If you no longer have them, `.env.example` lists every key, and the table below says where each one comes
from. Some can also be recovered with `vercel env pull` if they were set in the Vercel project.

### What each key is and where to get it

**Core — the app will not start without these**

| Key | Source |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio. Powers story text, image generation, and TTS. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page. Safe to expose to the browser. |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page. **Server-only — never prefix with `NEXT_PUBLIC_`.** |
| `ADMIN_USER_ID` | The Supabase auth UUID of your admin account. This account bypasses feature gates and always resolves to the `studio` tier. |
| `APP_URL` | `http://localhost:3000` locally; the deployment URL in hosted environments. |
| `CRON_SECRET` | Any long random string, but it must **match between the app and Vercel Cron**. Worker routes (`/api/batch/*`, `/api/media/jobs/run`, `/api/reference/jobs/run`) reject requests without this bearer token. |
| `SUPPORT_EMAIL` | Shown to users in support surfaces. |

**Media storage — Cloudflare R2**

| Key | Notes |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 → Manage API tokens. **Never prefix with `NEXT_PUBLIC_`.** |
| `R2_BUCKET_NAME`, `R2_PRIVATE_BUCKET_NAME` | `kissago-media-staging` / `kissago-media-private-staging` for dev |
| `R2_PUBLIC_BASE_URL` | `https://media-stage.kissago.cc` for staging |
| `R2_ENDPOINT` | `https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `R2_ENABLED`, `R2_STORAGE_MODE`, `R2_ENVIRONMENT`, `R2_PRODUCTION_ENABLED`, `R2_PUBLIC_DELIVERY_ENABLED`, `R2_CACHE_CONTROL_PUBLIC`, `R2_CACHE_CONTROL_PRIVATE` | Behaviour switches — copy the values from `.env.example`. `hybrid` mode falls back to Supabase Storage. |

Bucket setup scripts and CORS policies live in [cloudflare/r2/](../cloudflare/r2/); the operational runbook is
[docs/cloudflare-r2-runbook.md](cloudflare-r2-runbook.md).

**Optional providers — each gates its own features**

| Key | Unlocks |
|---|---|
| `ELEVENLABS_API_KEY` | Reel TTS with word timestamps. Server-only. |
| `OPENAI_API_KEY` | GPT-Image rows in `image_model_registry` |
| `XAI_API_KEY` | Grok image rows |
| `RUNWARE_API_KEY` | Runware open-weight image models (FLUX.2, Seedream, Qwen) |

A model row stays unavailable until every var in its `required_env_vars` is set, so missing keys degrade
gracefully rather than crashing.

**Payments — Razorpay (India checkout)**

`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` — from the Razorpay dashboard. Rollout
procedure: [docs/razorpay-stage-rollout-runbook.md](razorpay-stage-rollout-runbook.md).

**Client image compression** (optional, has defaults)

`NEXT_PUBLIC_IMAGE_MAX_WIDTH` (960), `NEXT_PUBLIC_IMAGE_MAX_HEIGHT` (540), `NEXT_PUBLIC_IMAGE_QUALITY` (0.65)
— defaults live in `lib/constants/media.ts`.

## 4. Run it

```bash
npm run dev        # http://localhost:3000
```

Then:

```bash
npx tsc --noEmit   # should be clean
npm run lint       # one pre-existing warning in AdvancedOptions.tsx is expected
npm test           # full vitest suite
```

**Stop the dev server before running `npm run build`.** On Windows they fight over `.next`: the build stalls
silently with no output, and deleting `.next` under a live dev server makes it 500 on every route. See
[docs/agent-context/GOTCHAS.md](agent-context/GOTCHAS.md).

Type `mock` as a story prompt to exercise the UI with hardcoded data — no API calls, no coins spent.

## 5. External services to regain access to

None of these are recoverable from the repo. Make sure the new machine can sign in to all of them:

| Service | Used for |
|---|---|
| **Supabase** | Two projects: dev `dxbwzcpbfacrwrauhdbk`, prod `pddjsopcemsfiwyvhlkr`. All migrations are applied by hand in the SQL editor here. |
| **Vercel** | Hosting, env vars, the daily reconcile cron, deployment skew protection. |
| **Cloudflare** | R2 buckets and the `media-stage.kissago.cc` / `media.kissago.cc` domains. |
| **Google AI Studio** | Gemini API key |
| **Razorpay** | Payments dashboard and webhooks |
| **ElevenLabs / OpenAI / xAI / Runware** | Optional provider keys |
| **GitHub** | `rajeevScorpion/storyMaster` |

## 6. Database state

The repo carries 96 numbered migrations in [supabase/migrations/](../supabase/migrations/), each with a
rollback twin. **It does not record which are applied to which environment** — that ledger is
[docs/agent-context/PROJECT_STATE.md](agent-context/PROJECT_STATE.md), which also contains a ready-to-paste
SQL query that tells you what a given database actually has.

Run that query against both projects early — several migrations were still pending at the time of the machine
switch, and knowing which is the difference between "this feature is broken" and "this feature isn't turned
on yet".

## 7. Agent context

The working context that used to live in local Claude Code memory now travels in the repo:

- [CLAUDE.md](../CLAUDE.md) — architecture and conventions
- [AGENTS.md](../AGENTS.md) — the same rules, for Codex and other agents
- [docs/agent-context/WORKING_AGREEMENTS.md](agent-context/WORKING_AGREEMENTS.md) — how work is delivered
- [docs/agent-context/PROJECT_STATE.md](agent-context/PROJECT_STATE.md) — shipped vs. pending
- [docs/agent-context/GOTCHAS.md](agent-context/GOTCHAS.md) — traps already paid for once

An agent on the new machine starts with no memory of this project — these files are what replaces it. Keep
`PROJECT_STATE.md` current as packs land, and add to `GOTCHAS.md` whenever something costs an afternoon.

Deeper background lives in the rest of [docs/](.) (pricing architecture, gallery discovery, media pipeline,
video export, per-feature implementation logs) and in the `Kissago_*` / `kissago_*` prompt-pack directories at
the repo root, which are the original specs for each major feature.
