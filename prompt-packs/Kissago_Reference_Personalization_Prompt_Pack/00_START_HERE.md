# Kissago Reference Personalization — Start Here

## Purpose

Implement user-uploaded **character references** and **world references** in Kissago without breaking the current story-generation, character-reference, image-composer, continuity, storage, publishing, coin, tier, or admin systems.

This pack is written for an AI coding agent. It is deliberately investigation-first. The codebase is the source of truth.

## Core feature

At story creation, an eligible user can upload:

- Up to **3 character reference images**
- Up to **3 world reference images**

The actual limit is determined by the user's tier and admin settings.

Initial defaults:

- **Free:** maximum 2 character references and 1 world reference
- Other tiers: admin-configurable
- Platform hard ceiling for the first release: 3 character and 3 world references

Character names are optional. A user may name a character, for example `Leo`. Kissago must transform the uploaded identity into the selected story visual style, generate/store a canonical story-specific character reference, and use that adopted reference throughout the story.

World references must be analysed into a concise structured description. A story-styled world visualization may also be generated once and stored. The world description and canonical visualization become continuity inputs for the Image Composer.

## Important product rule

Uploaded references provide **identity, environment and continuity information**. They do not replace or override the story's selected visual style.

The visual style remains locked and consistent throughout the story.

## Delivery order

1. Investigate the codebase and produce a written implementation map.
2. Confirm integration points and unresolved risks.
3. Implement foundations and admin controls behind feature flags.
4. Implement reference upload and preprocessing.
5. Implement character adoption.
6. Implement world analysis and optional visualization.
7. Integrate references into story creation and Image Composer.
8. Add continuity, Story Bible and episodic compatibility.
9. Add custom-option attachment in a later isolated phase.
10. Test, canary, document and roll out.

## Begin with

Paste `01_MASTER_IMPLEMENTATION_PROMPT.md` into the coding agent.

Do not begin implementation by pasting an individual phase prompt without first completing discovery.
