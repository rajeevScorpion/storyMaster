# Kissago `/learn` Experience — AI Coder Prompt Pack

## Purpose

This pack guides the implementation of a premium, horizontally navigated `/learn` experience inside the existing Kissago product.

The page is not a conventional website tutorial and not a disconnected investor pitch deck. It is a native Kissago experience that performs three jobs at once:

1. Introduces the problem Kissago is solving.
2. Teaches a new user how storytelling works on the platform.
3. Helps the founder present Kissago to investors, collaborators, educators, parents and creators before moving into a live product demonstration.

The experience must feel as if it has always belonged inside Kissago.

## Primary route

- Primary: `/learn`
- Compatibility alias: `/tutorial`
- `/tutorial` should redirect to `/learn`
- Each slide should have a stable hash or route state so a presenter can directly open a specific section.

## Narrative structure

The experience contains 18 slides divided into three chapters:

- Chapter 1 — Why Kissago Exists
- Chapter 2 — How Kissago Works
- Chapter 3 — What You Can Build

## Mandatory visual direction

The implementation must inherit the existing Kissago design system after auditing the codebase.

The intended accent language is:

- **Emerald** — creation, guidance, continuity, trust and constructive control
- **Ember** — imagination, narration, human warmth, energy and emotional emphasis
- **Glow accents** — restrained atmospheric highlights, never constant neon decoration

These must be mapped to the existing design tokens and component system rather than introduced as an unrelated theme.

## How to use this pack

Recommended sequence:

1. Give the coder `00_MASTER_PROMPT.md`
2. Ask the coder to complete `08_PHASED_IMPLEMENTATION.md` in order
3. Use `10_COPY_PASTE_PROMPTS.md` for phase-specific follow-ups
4. Validate using `09_QA_AND_ACCEPTANCE.md`
5. Add future image assets to the included `/assets` folders

## Non-negotiable guardrails

- Do not invent a new visual identity.
- Do not create a generic SaaS pitch deck.
- Do not use random gradients, excessive glassmorphism or constant neon glow.
- Do not represent future features as already available.
- Do not replace established Kissago components when an equivalent already exists.
- Do not make the presentation auto-advance.
- Do not make the main narrative dependent on opening accordions.
- Do not compromise mobile usability for desktop spectacle.
- Do not break existing routes, authentication, themes, global styles or story creation flows.
