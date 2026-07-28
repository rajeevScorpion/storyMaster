# Master Prompt for the AI Coder

You are working directly inside the existing Kissago codebase.

Your task is to design and implement a premium `/learn` route that explains why Kissago exists, demonstrates how the platform works and prepares a viewer for a live product demonstration.

This is not a standalone marketing microsite and not a generic pitch deck. It must use the same visual language, design tokens, components, motion patterns, typography and interaction principles already present in Kissago.

## Step 1 — Audit before implementation

Before changing code, inspect the codebase and report:

1. Framework, routing model and rendering approach
2. Existing design token files and CSS variables
3. Current emerald, ember, glow and neutral color usage
4. Typography stack and hierarchy
5. Shared card, button, navigation, modal and media components
6. Existing animation library and motion conventions
7. Theme and dark/light mode implementation
8. Responsive breakpoints
9. Existing screenshot-worthy product routes
10. Existing reusable background, illustration or decorative assets
11. Any likely conflicts with horizontal scrolling
12. Accessibility and reduced-motion utilities already present

Do not begin by inventing colors, gradients or component styles.

Create a concise implementation map showing which existing components will be reused, extended or composed. Only introduce a new component when the current system genuinely lacks the required behavior.

## Core objective

Build a horizontal, slide-based learning journey of approximately 18 slides, grouped into three visual chapters:

1. Why Kissago Exists
2. How Kissago Works
3. What You Can Build

The journey should communicate the following central idea:

Meaningful multimedia storytelling currently requires people to learn and coordinate several tools for writing, image generation, narration, timing, text overlays, transitions, effects and export. Kissago brings these steps into a guided experience so parents, educators, children and creators can turn an idea into a narrated visual story in approximately five to ten minutes.

The experience must also communicate the need for calmer, better-curated storytelling. It should explain that content does not become meaningful merely because it can be generated quickly. Kissago gives parents, educators and responsible creators more control over pace, narrative, visuals, characters and continuity.

## Primary audiences

The page must work for:

- First-time users
- Parents
- Educators
- Children using the platform with guidance
- Independent creators
- Character-led and episodic storytellers
- Potential collaborators
- Investors and institutional partners

Do not force a different page for each audience. Use one clear story that expands naturally from accessibility to creative depth.

## Route behavior

- Add `/learn`
- Redirect `/tutorial` to `/learn`
- Support direct slide access through stable hashes or equivalent route state
- Preserve browser back and forward behavior where practical
- Do not interfere with global navigation or authenticated user state
- Provide clear final actions that lead into the actual product

## Navigation and interaction

Desktop:

- Horizontal slide progression
- Mouse wheel and trackpad support
- Left and right arrow keys
- Scroll snapping or an equally reliable controlled slider
- Discreet chapter and slide progress
- No automatic advancement
- Optional presentation mode that reduces navigation chrome without hiding essential controls

Mobile:

- Horizontal swipe navigation
- Responsive slide composition
- Important copy always visible
- Secondary details may collapse into expandable sections
- Touch targets must remain comfortable
- Do not shrink desktop layouts until they become unreadable
- Respect device safe areas

## Visual design

The visual language must be unmistakably Kissago.

Use the current system as the source of truth and map the following semantic roles to existing tokens:

- Emerald: creation, guidance, positive progression, structure and control
- Ember: imagination, voice, emotional warmth and moments of emphasis
- Glow: sparse atmospheric depth around key transitions, media frames or chapter changes
- Neutral surfaces: content-first, calm and readable
- High contrast: maintain legibility over all decorative backgrounds

Use emerald and ember as a complementary narrative pair, not as competing gradients on every slide.

Avoid:

- Generic startup gradients
- Unrelated purple-blue AI visuals
- Continuous neon outlines
- Excessive glass panels
- Overly reflective 3D mockups
- Heavy particle systems
- Decorative animation that delays reading
- A visual treatment that feels more like a finance dashboard than a storytelling product

## Motion principles

Motion should feel authored, subtle and cinematic.

Use existing animation tools in the codebase. If Framer Motion is already present, reuse it.

Appropriate motion includes:

- Small depth shifts as cards enter
- Gentle parallax in large visual compositions
- Story components assembling into one final output
- Text arriving in meaningful groups
- Screenshot frames moving slightly within a controlled viewport
- Chapter transitions using restrained emerald or ember glow
- Progress indicators that quietly respond to movement

Requirements:

- Support `prefers-reduced-motion`
- No animation may be required to understand the content
- Avoid large layout shifts
- Avoid permanent looping animation unless extremely subtle
- Avoid scroll hijacking that traps users
- Keep transitions responsive rather than theatrical

## Content and screenshots

Use `06_SLIDE_NARRATIVE_AND_COPY.md` as the source for the 18-slide structure.

Use real Kissago screens wherever available.

Potential screenshot areas:

- Story idea entry
- Character setup or character references
- Story beat generation
- Scene or panel output
- Narration controls
- Pace controls
- Editing and regeneration
- Story playback
- Text overlay during narration
- Export or sharing
- Story library
- Episodic continuation

Do not fabricate unavailable screens. If a future direction is mentioned, label it clearly as future direction, expansion or vision.

Use one consistent demonstration story across screenshots when possible so the experience feels coherent.

## Architecture expectations

Prefer data-driven slides rather than 18 unrelated hard-coded page sections.

Recommended structure:

- `LearnPage`
- `LearnShell`
- `ChapterProgress`
- `HorizontalSlideViewport`
- `LearnSlide`
- `SlideHeader`
- `ScreenshotFrame`
- `ExpandableDetail`
- `StoryAssemblyVisual`
- `BestPracticeCard`
- `FinalActionPanel`

Keep slide content in structured data so wording, visuals and ordering can be updated without rewriting layout logic.

Do not over-engineer a new state system. Reuse the current application patterns.

## Performance expectations

- Lazy-load non-critical screenshots and large backgrounds
- Preload only the current and next slide assets
- Use responsive image sizes
- Prefer WebP or AVIF for new raster assets
- Prevent cumulative layout shift
- Avoid shipping large animation libraries twice
- Keep the route useful even before all decorative assets are added
- Ensure the route builds cleanly in production

## Final calls to action

The last slide should naturally move the viewer into the product.

Recommended actions:

- Start Creating
- Explore a Sample Story
- Watch a Guided Demo

Use existing product routes and button components.

## Deliverables

Provide:

1. Codebase audit
2. Route implementation
3. Data-driven 18-slide content structure
4. Desktop, tablet and mobile behavior
5. Keyboard, wheel, trackpad and touch navigation
6. Chapter and slide progress
7. Reduced-motion support
8. Screenshot asset slots and fallbacks
9. Presentation mode if it fits the architecture cleanly
10. Build, lint and type-check results
11. A concise list of reused and newly introduced components
12. Screenshots or a short screen recording of the final route at desktop and mobile widths

Follow the phased implementation plan in this pack. Do not break existing Kissago behavior while creating a visually disconnected presentation layer.
