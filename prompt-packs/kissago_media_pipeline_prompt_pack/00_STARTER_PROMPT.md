# 00 — Starter Prompt for AI Coder

You are working on Kissago. Implement a durable, server-side media pipeline for story image generation, Cloudflare R2 storage, image compression, high-resolution retention, and story publishing controls.

## Critical instructions

Do not assume the current codebase structure. First investigate the repository and identify:
- framework and runtime
- database and ORM
- auth/session model
- current story generation flow
- current image generation providers
- current image save flow
- current storage integration
- current client-side compression logic
- current story visibility/publishing logic, if any
- admin settings implementation, if any
- subscription/tier/coin system implementation, if any

Do not break anything already working.

Work in meaningful feature phases and commit after each phase. Each phase must leave the app in a working state.

Ask clarifying questions only after investigation, and only when the answer materially changes the implementation. If something is missing but a safe default is possible, propose the default and proceed behind a feature flag.

Before writing code, produce an investigation report with:
1. Current architecture summary
2. Current risks
3. Files/modules that need changes
4. Proposed migration plan
5. Compatibility risks
6. Rollback plan


## Rollout safety requirement

Do not hard-replace the current working client-side image flow. The existing flow, where the client downloads/handles image data, performs compression, and re-uploads using the current cloud save method, must remain available as a legacy processing mode.

Add an admin-selectable processing mode so production can switch between:
- `client_legacy`: current client-side download/compress/re-upload/cloud-save flow
- `server_pipeline`: new durable server-side generation, R2 save, compression, retention, and export flow
- optionally `hybrid_canary`: percentage/user-tier based rollout if the existing architecture supports safe canary routing

Every generation job/media record must store the processing mode that created it. Existing stories and images must continue to render correctly regardless of the current admin setting. The admin toggle should affect new generation jobs only unless explicitly designed otherwise.

If server-side processing fails in early rollout, the admin must be able to switch new jobs back to the legacy client path without redeploying. Do not create duplicate jobs or duplicate media records when switching modes.

## Product requirements

Users must be able to fire-and-forget image generation:
- They start generation.
- Browser may close.
- Server continues generation.
- Image is generated, saved, compressed, and made available later.
- On next load, user sees generated image normally.

Cloudflare R2 is the media store:
- Store originals privately.
- Store compressed display variants for normal UI viewing.
- Store thumbnails for gallery/listing.
- Store share/export variants where required.

Tier behavior:
- Free: normal compressed viewing; no high-quality download/export; original retained only as short internal processing buffer, configurable.
- Plus: high-quality original/export retained for admin-configurable days, default 10.
- Studio: high-quality original/export retained for admin-configurable days, default 30.

Publishing behavior:
- Users can set stories to private, public, or unlisted.
- Public/unlisted sharing uses safe derived media, not private originals.
- Higher-tier users get low/high quality toggle before sharing or publishing, subject to entitlement and retention window.

Use feature flags and admin-configurable settings wherever appropriate.
