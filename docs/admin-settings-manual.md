# Kissago Admin — Settings Manual

A tutorial-style operator guide to the Kissago admin panel: what each page and
setting does, which user-facing surface it affects, and how settings connect to
one another. This file is the source of truth; the in-app **Admin manual** page
(`/admin/help`) renders it directly.

## How to use this manual

- The admin panel is grouped by workflow. The left sidebar (desktop) and the
  hamburger drawer (mobile) share the same navigation tree, and the Global
  Settings overview page shows the same destinations as cards.
- Most switches **save immediately** — there is no separate Save button, and the
  change takes effect for readers within about a minute (see
  [Operational safety notes](#operational-safety-notes)). The two exceptions are
  **Image uploads** and **Media pipeline / storage**, which use an editable draft
  with an explicit Save and an "unsaved changes" banner.
- Every setting maps to a `feature_flags` row. This manual lists the flag key
  where a control is backed one-to-one by a flag, so you can trace behavior.
- When in doubt, prefer the documented safe default. Pricing changes are the only
  ones with an audit trail (**Pricing → Recent audit**).

## Admin area map

The sidebar is organized into four top-level groups.

| Group | Pages |
|---|---|
| **Content** | Content (moderation), Share Covers, Backfill |
| **Studio** | Image Models, Graphic Styles, Moods, Story Playground, Reel Playground |
| **Finance** | Cost (AI spend dashboard), Pricing and offers (workshop + sub-pages) |
| **Configuration** | Global Settings (16 focused pages), Admin manual (this page) |

Note on a legacy route: `/admin/playground` still exists on disk and renders the
same studio as **Story Playground** (`/admin/story-playground`). It has no
sidebar entry and is a legacy alias; treat Story Playground as canonical. It is a
candidate for a redirect in a future cleanup.

---

## Global settings

The Global Settings overview (`/admin/settings`) groups the 16 focused settings
pages into five sections. Each page below notes its purpose, key controls, the
user surface it affects, and safe defaults.

### Story & Reels

#### Storyboard — `/admin/settings/storyboard`

Controls how beat images are generated and displayed. Storyboard generation is
always on; every beat renders as a 2×2 panel grid. Image size and browser-side
WebP processing apply to newly generated beat images only.

| Setting | What it does | Affects | Safe default | Flag key |
|---|---|---|---|---|
| Image size | Output resolution for beat images | Reader beat images | 2K | `storyboard_image_size` |
| Layout mode | Panel grid layout | Reader beat images | 2×2 | `storyboard_layout_mode` |
| Vignette enabled | Adds a darkened edge vignette | Reader beat images | On | `storyboard_vignette_enabled` |
| Vignette amount | Vignette strength (percent) | Reader beat images | — | `storyboard_vignette_amount_percent` |
| Panel cycle override | Override the auto panel-cycle timing | Reader panel playback | Off | `storyboard_cycle_override` |
| Panel cycle ms | Milliseconds per panel when overridden | Reader panel playback | 2500 | `storyboard_cycle_ms` |
| Client processing | Do WebP processing in the browser | Upload/generation path | — | `storyboard_client_processing_enabled` |
| WebP compression | Compress beat images to WebP | Image size on disk | — | `storyboard_webp_compression_enabled` |
| WebP quality | WebP quality percent | Image fidelity vs size | — | `storyboard_webp_quality_percent` |

WebP quality and compression only take effect when client processing is on.

#### Reel Story — `/admin/settings/reels`

Short-form (9:16) reel generation defaults: prompt-only reels, editable JSON
prompt "definers", retention windows for drafts, and manual draft cleanup.
Affects the Reel Playground and user-facing reel generation. Reel narration
presets connect to the Narration voices page (see interconnections).

#### Reader and loader — `/admin/settings/reader`

Controls the reading experience and the loading screen shown while a beat
generates.

| Setting | What it does | Affects | Safe default | Flag key |
|---|---|---|---|---|
| Text line count | Visible story text lines | Reader | — | `story_ui_text_line_count` |
| Overlay words per line | Words per overlay line | Reader text overlay | — | `story_text_overlay_words_per_line` |
| Auto-scroll | Auto-scroll story text | Reader | On | `story_ui_auto_scroll_enabled` |
| Loading node labels | Show node labels while loading | Loading screen | On | `story_loading_node_labels_enabled` |
| Hint typewriter | Typewriter effect on hints | Loading screen | Off | `story_loading_hint_typewriter_enabled` |
| Reader anticipation (ms) | Delay before revealing text | Loading→reader transition | 10000 | `story_loading_reader_anticipation_ms` |
| Reader story text preview | Reveal story text while loading | Loading screen | On | `story_loading_reader_story_text_enabled` |
| Reader options preview | Reveal options while loading | Loading screen | On | `story_loading_reader_options_enabled` |
| Reader scroll speed | Reveal scroll speed (px/sec) | Loading screen | 24 | `story_loading_reader_scroll_speed_px_per_second` |
| Branch choice flash | Flash effect on branch choice | Reader | On | `storyline_choice_flash_enabled` |
| Branch flash (ms) | Flash duration (500–30000, clamped) | Reader | 3000 | `storyline_choice_flash_ms` |
| Client persistence | Persist story state in the browser | Reader continuity | Off | `client_story_persistence_enabled` |

#### Authoring — `/admin/settings/authoring`

Prompt/seed authoring limits and seed preview pricing.

| Setting | What it does | Affects | Safe default | Flag key |
|---|---|---|---|---|
| Word cap | Max words in a prompt/seed | Landing / authoring | 500 | `story_authoring_word_cap` |
| Default Beat length | Baseline Brief-to-Immersive text amount for each new standard-story beat; audience profiles resolve it to a safe word range and users may override it | Landing / story generation / narration | Balanced (3) | `story_beat_length_default_level` |
| Seed preview price | Coin price to preview a seed plan | Authoring paywall | — | (from pricing action costs) |
| Vertical stories | Allow vertical (9:16) stories | Authoring | Off | `vertical_stories_setting_enabled` |

Beat length does not change Reel text length. Strictly Follow seeded stories
preserve canonical source wording even when it falls outside the selected Beat
length range.

The seed preview price is sourced from the pricing action-cost catalog, not a
feature flag — change it under **Pricing → Action costs**.

#### Beat control — `/admin/settings/beat-control`

Per-beat editing capabilities: beat text editing, timeline rewrite protection,
image/narration/options regeneration, custom options, and image version history
(including the max image versions retained per beat). Affects the reader's beat
edit tools and the regeneration controls.

### Media & Images

#### Image uploads — `/admin/settings/media`

Client-side upload compression plus storage provider selection.

| Setting | What it does | Affects | Safe default | Flag key |
|---|---|---|---|---|
| Client compression | Compress images in the browser before upload | All uploads | — | `image_upload_client_compression_enabled` |
| Per-type compression | Toggle compression for beats, storyboard, covers, social covers, character refs | Respective uploads | — | `image_upload_compress_*` |
| Output format / quality | WebP output and quality percent | Upload size vs fidelity | — | `image_upload_output_format`, `image_upload_default_webp_quality` |
| Size limits | Max landscape/vertical dimensions and raw/final upload MB caps | Upload validation | — | `image_upload_max_*`, `image_upload_*_limit_mb` |
| Storage provider | Supabase / hybrid / R2 for stored media | Where media is served from | Hybrid | `media_storage_provider` |
| R2 enabled + routing | Enable Cloudflare R2 and route images/covers/audio/public delivery | Media delivery | — | `media_r2_*` |

Storage and R2 changes here are draft-and-Save. R2 routing also depends on
server env being configured (the page shows effective status).

#### Media pipeline — `/admin/settings/media-pipeline`

Server-side image processing after upload: processing mode, HQ retention,
variant generation, cleanup, publishing gates, and job monitoring. This is the
server-side counterpart to the client-side Image uploads compression.

#### Batch visuals — `/admin/settings/image-batch`

Scope and rollout controls for bulk/batch image generation jobs. Affects which
stories/users batch image generation runs for.

#### Image prompt compiler — `/admin/settings/prompt-compiler`

JSON image prompt optimization: rollout mode (off / shadow / on), per-model
capability status, and legacy-vs-compiled comparison views. Governs how beat
image prompts are compiled before being sent to the image model.

### Characters & Personalization

#### Character references — `/admin/settings/characters`

Character sheet availability by plan tier.

| Setting | What it does | Affects | Safe default | Flag key |
|---|---|---|---|---|
| Free/Plus sheets | Enable character sheets for Free and Plus | Character workflow | — | `character_sheet_enabled_free_plus` |
| Creator sheets | Enable character sheets for Creator/Studio | Character workflow | — | `character_sheet_enabled_creator` |

#### Characters & episodes — `/admin/settings/character-universe`

The character universe pack: character library, save-to-library, mixing
characters into new stories, episodic branching, series story bible, and episode
journal. Each is an independent capability toggle.

#### References & personalization — `/admin/settings/references`

Reference image sources and personalization defaults: which reference slots are
available and how uploaded references and adopted styles feed generation.

### Audio & Video

#### Narration voices — `/admin/settings/narration`

User-led voice selection and the curated voice catalog.

| Setting | What it does | Affects | Flag key |
|---|---|---|---|
| User-led voice selection | Let users pick a narration voice | Narration UI | `narration_user_led_voice_selection_enabled` |
| Male / female voice lists | Curated voice options and defaults | Narration voices | `narration_male_voice_list`, `narration_female_voice_list`, `narration_default_*_voice` |
| Accent selection | Enable accent steering (English only) and the accent list/default/tiers | Narration voices | `narration_accent_*` |
| Sample text | Per-language sample text for voice previews | Voice samples | `narration_sample_text_*` |

Narration is a two-layer concern: **language** × **accent**. Accents apply to
English narration only; other languages skip accent steering.

#### Video export — `/admin/settings/video-export`

| Setting | What it does | Affects | Safe default | Flag key |
|---|---|---|---|---|
| Video download | Global availability of video download | Reader export | — | `video_download_enabled` |
| Admin bypass | Allow admins to download even when disabled | Admin testing | — | `video_download_admin_bypass` |

### Platform

#### Generation timeouts — `/admin/settings/generation`

Guardrail timeouts for AI calls and cloud save. If a call exceeds its timeout it
fails gracefully rather than hanging.

| Setting | What it does | Affects | Safe default | Flag key |
|---|---|---|---|---|
| Text timeout | Gemini text generation timeout | Beat generation | 30000 ms | `gemini_text_timeout_ms` |
| Image timeout | Gemini image generation timeout | Beat images | 90000 ms | `gemini_image_timeout_ms` |
| TTS timeout | Narration TTS timeout | Narration | 120000 ms | `gemini_tts_timeout_ms` |
| Cloud save timeout | Cloud persistence timeout | Story saving | 20000 ms | `cloud_save_timeout_ms` |
| Asset sync warning | Delay before warning on slow asset sync | Reader save UX | 15000 ms | `story_asset_sync_warning_timeout_ms` |
| Signed URL swap | Swap to signed URLs for assets | Asset delivery | Off | `story_asset_signed_url_swap_enabled` |
| Incremental asset sync | Sync assets incrementally | Story saving | Off | `story_incremental_asset_sync_enabled` |
| Pause upload during generation | Hold asset uploads while generating | Generation stability | Off | `story_asset_upload_pause_during_generation_enabled` |

#### Pages — `/admin/settings/pages`

Manages the DB-backed "managed pages" (legal, support, blog, docs, FAQ) and
footer controls: enable/disable, footer placement, access level, and content.
This is separate from this manual, which lives in the repo.

---

## Pricing and offers

The pricing workspace (`/admin/pricing`) is a hub with focused sub-pages. Display
convention throughout: **10 coins = 1 internal beat**.

| Page | Purpose |
|---|---|
| **Pricing workshop** (`/admin/pricing`) | Catalog health metrics (plans, versions, top-ups, promotions) and links into each tool |
| **Plans** (`/admin/pricing/plans`) | Draft, publish, and archive subscription plan variants by market and billing interval |
| **Top-up packs** (`/admin/pricing/top-up-packs`) | One-time coin packs by market |
| **Promotions** (`/admin/pricing/promotions`) | Campaign/event bonus offers (immediate-save) |
| **Action costs** (`/admin/pricing/action-costs`) | Coin cost per billable action (beat generation, seed preview, etc.); immediate-save |
| **Runtime controls** (`/admin/pricing/runtime-controls`) | Live visibility and rollout switches for pricing/billing behavior |
| **Recovery tools** (`/admin/pricing/recovery-tools`) | Repair test wallets, checkouts, and stuck reservations |
| **Recent audit** (`/admin/pricing/audit`) | Paginated history of pricing changes for traceability |

Plans and top-ups use a draft → publish flow; action costs and runtime controls
save immediately. Only the pricing area writes an audit trail.

---

## How settings interconnect

Settings rarely act alone. The main chains an operator should know:

- **Image pipeline:** [Image uploads](#image-uploads--adminsettingsmedia)
  (client-side compression + size caps and storage provider) →
  [Media pipeline](#media-pipeline--adminsettingsmedia-pipeline) (server-side
  processing, variants, retention) →
  [Batch visuals](#batch-visuals--adminsettingsimage-batch) (which jobs run in
  bulk) → [Image prompt compiler](#image-prompt-compiler--adminsettingsprompt-compiler)
  (how the prompt JSON is built) →
  [Storyboard](#storyboard--adminsettingsstoryboard) (output size and WebP for
  the final beat image). A too-aggressive size cap in Image uploads can override
  what Storyboard tries to produce.
- **Narration:** [Narration voices](#narration-voices--adminsettingsnarration)
  (catalog, accents, sample text) → Reel Story narration presets →
  TTS timeout in [Generation timeouts](#generation-timeouts--adminsettingsgeneration).
  If narration fails, check both the voice catalog and the TTS timeout.
- **Characters:** [Character references](#character-references--adminsettingscharacters)
  (sheets by plan) →
  [Characters & episodes](#characters--episodes--adminsettingscharacter-universe)
  (library, mixing, episodic branching) →
  [References & personalization](#references--personalization--adminsettingsreferences)
  (reference sources feeding generation).
- **Cost levers:** [Action costs](#pricing-and-offers) + Runtime controls +
  the Authoring seed preview price together determine what users are charged;
  the [Cost dashboard](#suggested-future-admin-features) shows what those
  generations actually cost to serve.

---

## Operational safety notes

- **Flag cache (up to ~1 minute lag).** Feature flags are cached in-memory for
  60 seconds (`lib/ai/model-config.ts`). After you flip a switch, readers may not
  see the change for up to a minute. Do not assume a toggle "didn't work" within
  that window.
- **Immediate-save vs draft.** Most toggles save on click. Image uploads and
  Media storage use an explicit draft + Save with an "unsaved changes" banner —
  navigating away discards unsaved edits there.
- **Audit trail is pricing-only.** Global Settings changes are not audited;
  pricing changes are (**Pricing → Recent audit**). Note non-obvious settings
  changes elsewhere yourself.
- **R2 depends on env.** R2 routing only takes effect when server env is
  configured; the Image uploads page shows effective status.
- **Timeouts fail closed.** Generation timeouts abort a slow call rather than
  hang; raising them helps slow models but delays failure feedback.

---

## Suggested future admin features

These are proposals grounded in data that already exists; none are built yet.

- **Users page (`/admin/users`).** A user list/detail view joining `profiles`
  with `billing_customers` / `billing_subscriptions` for plan status, wallet
  balance from `beat_grants` minus consumed allocations, and a link to the
  existing per-user filter on the Cost dashboard (`/admin/cost?userId=`).
- **Activity feed.** Recent `beat_usage_events` and `beat_spend_reservations`
  plus generation-job rows, filterable by user and action — this would surface
  stuck reservations that today require Recovery tools to find.
- **Per-user cost rollups.** Aggregate `ai_cost_events` by user, day, and
  activity to show spend and (joined with pricing) margin per user, extending the
  existing Cost dashboard.

---

## Appendix: deferred engineering follow-ups

- **Scoped per-section settings fetch.** Today the settings overview and each
  monolith section fetch the full settings set. After flag-read batching this is
  cheap, but a per-section fetch (mirroring the dedicated-panel pages) would trim
  it further.
- **GlobalSettings component split.** The settings monolith is one large client
  component; splitting each section into its own memoized child would remove
  whole-tree re-renders on keystrokes.
- **`/admin/playground` redirect.** The legacy alias should redirect to
  `/admin/story-playground` in a future cleanup.
