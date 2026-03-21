# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kissago is an interactive AI-powered branching narrative app built with Next.js 15 (App Router) and React 19. Users enter a prompt, and the app generates story "beats" with choices using the Gemini API. Stories include AI-generated images and track characters/setting for continuity across beats. All state is persisted client-side via IndexedDB.

## Commands

```bash
npm run dev       # Start dev server at localhost:3000
npm run build     # Production build (standalone output for Cloud Run)
npm start         # Run production build
npm run lint      # ESLint
npm run clean     # Clear Next.js cache
```

Requires `GEMINI_API_KEY` in `.env.local`.

## Architecture

**Data flow:** LandingScreen (prompt) → Zustand store action → Server action (Gemini API) → StoryScreen (display beat + options) → user picks option → loop

Key layers:
- **`app/page.tsx`** — Client component entry point; conditionally renders LandingScreen or StoryScreen based on session state
- **`app/actions/story.ts`** — Server actions: `generateStoryBeat()` (structured JSON output from Gemini) and `generateImage()` (via `gemini-2.5-flash-image`)
- **`lib/store/story-store.ts`** — Zustand store with IndexedDB persistence (`idb-keyval`). Contains `startStory`, `continueStory`, `resetStory` actions that orchestrate API calls and state updates
- **`lib/ai/prompts.ts`** — Two system prompts: `STORY_MASTER_SYSTEM_PROMPT` (generates beats as JSON schema) and `VISUAL_PROMPT_COMPOSER_PROMPT` (generates image descriptions)
- **`lib/types/story.ts`** — Core types: `StorySession`, `StoryBeat`, `Character`, `Option`
- **`components/story/`** — Three components: LandingScreen, StoryScreen, LoadingState

**Mock mode:** Entering `"mock"` as the prompt returns hardcoded story data, useful for UI testing without API calls.

## Conventions

- All components are client components (`'use client'`)
- Styling: Tailwind CSS v4 with dark theme (`bg-neutral-950`), emerald/indigo/purple accents, glassmorphism patterns
- Animations via `motion` (Framer Motion)
- Path alias: `@/*` maps to project root
- Fonts: Inter (sans) and Playfair Display (serif) via `next/font/google`
- TypeScript strict mode enabled
- ESLint v9 flat config extending Next.js defaults
