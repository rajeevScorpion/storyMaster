# Visual System — Emerald, Ember and Controlled Glow

## Primary rule

The existing Kissago design system is the source of truth.

Do not paste a new design system into the project. First identify the current tokens, then map the semantic roles below to them.

## Semantic accent roles

### Emerald

Use emerald for:

- Guided creation
- Forward progression
- Control
- Structure
- Successful assembly
- Active chapter progress
- Best-practice recommendations
- Primary creation actions

Emerald should feel intelligent, steady and constructive.

### Ember

Use ember for:

- Imagination
- Voice
- Narrative warmth
- Human authorship
- Emotional emphasis
- Moments of creative possibility
- Character and story-world expansion

Ember should feel alive and expressive without becoming aggressive.

### Balanced accent

Use a restrained combination of emerald and ember where two ideas converge:

- Technology and authorship
- Structure and imagination
- Guided flow and creative freedom
- Individual scenes becoming one story

Do not use a two-color gradient merely because both colors exist. The combination must have narrative meaning.

## Glow principles

Glow is atmospheric support, not a component style.

Use glow:

- Behind a central story assembly visual
- Around a chapter transition
- Behind one important screenshot
- As a faint edge reflection on a key card
- As a subtle visual response during slide entry

Do not use glow:

- Around every card
- Behind every button
- As permanent animated neon
- As a substitute for spacing or hierarchy
- At an intensity that lowers text contrast
- In several saturated colors at once

## Suggested token mapping

Map to existing tokens wherever possible.

Fallback naming only if the codebase has no equivalent:

```css
--kissago-bg-primary
--kissago-bg-elevated
--kissago-surface
--kissago-surface-soft
--kissago-text-primary
--kissago-text-muted
--kissago-border-subtle
--kissago-emerald
--kissago-emerald-soft
--kissago-ember
--kissago-ember-soft
--kissago-glow-emerald
--kissago-glow-ember
```

Do not hard-code these names if current tokens already exist.

## Surface treatment

The page should feel content-first.

Recommended hierarchy:

1. Deep or neutral page field using the existing theme
2. Quiet elevated surfaces
3. Strong typography
4. Media or illustrated focal point
5. Sparse emerald or ember emphasis
6. Very limited glow

Avoid a dashboard grid of equal cards. Each slide should have one primary idea.

## Typography

Reuse the current Kissago type system.

Recommended behavior:

- Large editorial statements for slide titles
- Clear supporting copy
- Short line lengths
- Strong contrast between headline and explanation
- Use serif and sans-serif only in the way Kissago already combines them
- Avoid novelty fonts
- Avoid putting long paragraphs inside centered text blocks
- Avoid all-caps paragraphs
- Keep numerals and progress indicators subtle

## Image treatment

Platform screenshots should remain readable and authentic.

- Do not over-tint screenshots
- Do not mask interfaces with decorative overlays
- Use subtle edge treatment and depth
- Maintain correct aspect ratios
- Avoid perspective distortion that makes UI unreadable
- Use cropped detail shots only when the full screen is also shown elsewhere

## Chapter distinction

Keep one system, not three themes.

Suggested chapter emphasis:

### Chapter 1 — Why Kissago Exists

- More neutral space
- Ember used for human concerns, imagination and attention
- Emerald appears as the possibility of guidance
- Visuals feel fragmented at first, then become calmer

### Chapter 2 — How Kissago Works

- Emerald becomes more active
- Layouts feel structured and assembled
- Screenshot usage increases
- Ember highlights narration, character and emotion

### Chapter 3 — What You Can Build

- Emerald and ember become balanced
- Visual space expands
- Character and story-world imagery becomes more prominent
- Final slide feels open and invitational

## Decorative background strategy

Background assets will be added later.

The implementation must therefore:

- Work without custom backgrounds
- Expose clear asset slots
- Use graceful CSS fallbacks
- Lazy-load large backgrounds
- Keep text readable even if an asset fails
- Allow each background to be disabled independently
- Avoid baking important words into images

See `/assets/README.md` for future background specifications.
