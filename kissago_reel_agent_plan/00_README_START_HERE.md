# Kissago Reel Story Generator Layer: Agent Orchestration Pack

This folder contains implementation instructions for a senior AI coding agent working inside the Kissago repository.

The agent must treat these files as the implementation source of truth, but must not assume the codebase structure. Every action must be grounded in inspection of the actual repository.

## Core objective

Add a new Kissago creation method called **Reel Story** or **Visual Reel**. This mode creates short vertical reel-style stories using still images that change every 2 to 3 seconds, narration, subtitles or timing metadata where available, branding rules, and downloadable export support where current infrastructure allows.

## Non-negotiable constraints

1. Create a feature branch first.
2. Inspect the existing codebase before changing files.
3. Do not break existing Prompt Story, Seed Story, published story playback, auth, storage, or admin settings.
4. Migrations must remain manual. Generate migration SQL files if needed, but do not apply them automatically.
5. Commit is allowed after implementation, but do not push.
6. Documentation of implementation is mandatory and must be committed alongside code changes.
7. If export rendering infrastructure does not exist, create safe metadata, UI, and placeholder states rather than adding a heavy unreviewed renderer.
8. Server-side checks must protect paid/free branding rules and retention policies.
9. Storage cleanup must be safe, reversible where possible, and auditable.

## Suggested execution command

Point the coding agent to this folder and ask it to execute `01_ORCHESTRATOR.md` first.

## File order

Read and execute in this order:

1. `01_ORCHESTRATOR.md`
2. `02_REPOSITORY_DISCOVERY.md`
3. `03_PRODUCT_AND_UX_REQUIREMENTS.md`
4. `04_DATA_MODEL_AND_MANUAL_MIGRATIONS.md`
5. `05_ADMIN_SETTINGS_AND_PROMPT_DEFINERS.md`
6. `06_REEL_GENERATION_PIPELINE.md`
7. `07_STORAGE_LIFECYCLE_MANAGEMENT.md`
8. `08_RATE_LIMITING_BRANDING_AND_PLANS.md`
9. `09_EXPORT_AND_DOWNLOAD.md`
10. `10_EDGE_CASES_AND_SAFETY.md`
11. `11_QA_TEST_PLAN.md`
12. `12_IMPLEMENTATION_DOCUMENTATION.md`

