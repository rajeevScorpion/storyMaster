# Starter Prompt for AI Coder

You are working on the Kissago codebase. Your task is to design and implement **client-side persistence for stories, images, audio, story progress, and replay performance**, while keeping the codebase ready for a future **Capacitor Android/iOS app**.

## Non-negotiable working rules

1. **Do not assume anything. Investigate first.**
   - Inspect the current repository structure.
   - Identify the frontend framework, routing model, build system, API layer, auth flow, media loading flow, and story data model.
   - Confirm whether the app is Next.js, React/Vite, or another stack before making implementation decisions.

2. **Every decision must be based on the existing codebase.**
   - Do not introduce Dexie, Workbox, SQLite, Capacitor plugins, or service worker logic blindly.
   - First check what is already installed, how state is managed, how stories are fetched, and how media URLs are generated.
   - Prefer small, reversible changes that align with the repo’s current architecture.

3. **Ask clarifying questions when required.**
   - Ask before changing story schema, auth assumptions, bucket privacy, signed URL behavior, offline requirements, or native app constraints.
   - Ask if the app currently uses private Supabase storage, short-lived signed URLs, or server-rendered pages that may not work well inside Capacitor.

4. **Do not break existing production behavior.**
   - The server remains the source of truth.
   - Client persistence is a performance and offline-readiness layer, not a replacement for Supabase/server data.
   - Add feature flags if needed.

5. **Preserve future Capacitor viability.**
   - Web version can use IndexedDB + Cache Storage.
   - Native Capacitor version should be able to switch media persistence to Capacitor Filesystem.
   - Keep storage behind an abstraction so web/native backends can differ without rewriting story UI.

## Goal

Implement a robust persistence system so that when a user creates or watches a Kissago story:

- story metadata is cached locally;
- story progress is saved locally;
- images and audio are reused instead of repeatedly loading from server;
- opening a previously watched story feels instant;
- server egress is reduced;
- the architecture remains compatible with future Capacitor Android/iOS packaging.

## Required first step

Before coding, produce an investigation report covering:

- current frontend stack;
- current story fetch flow;
- current story data shape;
- where image/audio URLs come from;
- whether URLs are public, signed, or proxied;
- current auth/session flow;
- current storage/caching packages;
- current deployment model;
- risks for Capacitor compatibility;
- recommended implementation path based on actual code.

Use `01_REPO_INVESTIGATION_FIRST.md` as the checklist.

## Implementation direction

After investigation, implement in phases:

1. Add storage abstraction.
2. Add story manifest cache.
3. Add playback progress persistence.
4. Add media cache adapter for web.
5. Add version/hash-based invalidation.
6. Add cleanup and quota checks.
7. Prepare Capacitor-native adapter contract.
8. Add tests and logging.

Follow `00_ORCHESTRATOR.md` for execution order.
