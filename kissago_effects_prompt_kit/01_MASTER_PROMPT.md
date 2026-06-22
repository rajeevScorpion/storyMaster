# MASTER PROMPT FOR AI CODER

You are working on the Kissago codebase.

## Mission
Implement a **story effects system** that makes still-image story beats feel alive during playback and in exported videos.

Kissago already has:
- overlay text synced with narration
- panel transitions
- beat-based structure and timing

We now want to add effects such as:
- particle effects
- parallax illusion / depth motion
- cinematic pan / zoom / drift
- atmospheric overlays
- beat-emphasis effects
- richer transitions

## Functional requirements
1. Effects must be **beat-specific**.
2. User must be able to apply one effect configuration to a single beat.
3. User must also be able to **apply the same effect configuration to all beats in the same story with one click**.
4. User must be able to create, save, edit, delete, and reuse **presets** across stories.
5. User must be able to control effect settings such as:
   - particle amount
   - visibility / opacity
   - density
   - speed
   - size / scale
   - direction
   - color where relevant
   - parallax depth / intensity
   - motion amplitude
   - transition duration / easing where relevant
6. Effects must appear both:
   - in interactive story playback
   - in exported videos
7. The solution must be performant on web and compatible with future app packaging / mobile-oriented use.

## Process instructions
- **Do not assume** architecture, framework, export pipeline, or state shape.
- First inspect the codebase and understand:
  - current player architecture
  - beat model
  - narration timing model
  - transition system
  - export pipeline
  - rendering stack
  - state management
  - persistence model
- Ask clarifying questions before implementation if anything is ambiguous.
- Every decision must be grounded in the existing codebase and current product behavior.
- Prefer practical solutions.
- Avoid introducing large complexity unless justified.

## Git workflow
1. Create a new branch before touching code.
2. Investigate first.
3. Share findings and clarifying questions.
4. Implement in phases.
5. Commit after meaningful milestones using clear progressive commit messages.
6. Resolve conflicts gracefully and avoid disturbing existing working features.

## Implementation expectation
Produce:
- discovery note
- architecture proposal grounded in codebase
- clarifying questions
- phased plan
- implementation
- tests
- migration / docs notes

## Strong preference
Use a **shared declarative effect schema** so the same story data can drive:
- live preview / playback
- editing UI
- exported video rendering

If that is not possible in the current codebase, explain why and propose the most practical fallback.

