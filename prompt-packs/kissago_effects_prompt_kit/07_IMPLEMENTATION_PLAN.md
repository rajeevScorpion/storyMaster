# Implementation Plan

This plan should be adapted after repository discovery.

## Phase 0 - Discovery (mandatory)
Before coding, inspect and document:
- project framework(s)
- story player structure
- beat and timing model
- overlay text sync implementation
- transition implementation
- existing render stack (DOM/CSS/canvas/WebGL)
- export pipeline
- state management
- persistence layer / database schema
- testing setup

### Deliverable
A short discovery note answering:
- What parts can be reused?
- Where should effects integrate?
- What is the least disruptive implementation path?
- What risks exist?

---

## Phase 1 - Design the effect schema
Tasks:
- define normalized effect config
- define preset model
- define story-level default behavior
- define beat assignment behavior
- decide where in data model these values live
- create validation utilities and defaults

### Deliverable
- types/interfaces
- normalization helpers
- validation helpers
- decision note

---

## Phase 2 - Build minimal runtime renderer
Start with the simplest high-value effect set:
1. pan / zoom / drift
2. one particle effect
3. one atmosphere overlay
4. one transition enhancement

Tasks:
- integrate effect layer into story player
- ensure sync with beat timing and playback state
- support enable/disable per beat
- support preview updates on settings changes

### Deliverable
A working runtime preview with a minimal supported effect set.

---

## Phase 3 - Build preset and controls UI
Tasks:
- effect inspector panel
- sliders / toggles
- preset create/save/update/delete
- apply to current beat
- apply to all beats in story
- story default behavior if needed

### Deliverable
Creators can manage effects practically from the UI.

---

## Phase 4 - Export parity
Tasks:
- inspect current export pipeline
- integrate effect rendering into export path
- ensure deterministic playback for export
- combine visuals with narration audio
- verify transitions, particles, and text overlays appear in export

### Deliverable
Exported video includes visual effects accurately.

---

## Phase 5 - Expand effect catalog
Add more presets and effect families only after foundation is stable.

Examples:
- snow
- embers
- rain
- magical particles
- dream mist
- glow + grain styles

---

## Phase 6 - Performance hardening
Tasks:
- low-end device testing
- quality tiers
- guardrails for heavy settings
- fallbacks
- frame budgeting
- disable expensive effects when needed

### Deliverable
Stable playback and usable editing experience.

---

## Suggested Git commit milestones
1. `chore: create branch and document discovery findings`
2. `feat: add normalized story effect schema and helpers`
3. `feat: integrate minimal effect runtime into story player`
4. `feat: add effect controls and preset management`
5. `feat: support apply-to-all beat effects`
6. `feat: include story effects in export pipeline`
7. `test: add regression and performance coverage for effects`
8. `docs: document story effects architecture and usage`

