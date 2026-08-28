# Screenshot and Asset Plan

## Screenshot principle

Use authentic product screens. Do not create fictional UI merely to make the tutorial look complete.

## Recommended demonstration story

Use one consistent story across most screenshots.

The story should have:

- One memorable main character
- One supporting character at most
- A visually distinctive but calm world
- A simple emotional progression
- Enough scenes to demonstrate pacing, narration, text overlay and continuation
- No sensitive personal data
- No copyrighted external character

A consistent example will make the tutorial feel like one connected experience rather than a collage of features.

## Screenshot capture list

Suggested keys:

1. `idea-entry-desktop`
2. `idea-entry-mobile`
3. `character-setup`
4. `character-reference`
5. `story-beats`
6. `scene-generation`
7. `scene-editing`
8. `image-regeneration`
9. `narration-controls`
10. `pace-controls`
11. `story-playback`
12. `spoken-text-overlay`
13. `export-share`
14. `story-library`
15. `episode-continuation`

Capture only what currently exists.

## Capture standards

- Use stable demo data
- Remove personal or production-sensitive information
- Keep browser zoom at 100%
- Capture at a consistent desktop viewport
- Capture dedicated mobile screenshots rather than shrinking desktop images
- Use the same theme across a sequence unless a slide explicitly discusses themes
- Avoid cursor clutter
- Avoid partially open menus unless they are the subject
- Keep tooltips only when they explain a feature
- Name files consistently
- Prefer PNG for UI captures, then optimize for delivery
- Provide WebP or AVIF versions for production where appropriate

## Background assets to be added later

Expected future background filenames:

- `bg-01-story-seed.webp`
- `bg-02-fragmented-creation.webp`
- `bg-03-calm-attention.webp`
- `bg-04-story-convergence.webp`
- `bg-05-character-continuity.webp`
- `bg-06-episodic-world.webp`
- `bg-07-create-invitation.webp`

The route must render well before these files are added.

## Illustration asset ideas

Optional future assets:

- Story seed symbol
- Fragmented tool constellation
- Narration waveform with synchronized text
- Character continuity ribbon
- Story beat pathway
- Episodic branching map
- Calm particle or atmospheric texture

Do not use generic robot, brain, circuit or sparkle iconography unless it already belongs to Kissago.

## Asset slot behavior

Each asset slot should support:

- Source key
- Alternative text when meaningful
- Decorative mode
- Focal position
- Mobile crop
- Optional overlay strength
- Optional glow role
- Missing-asset fallback

## Future asset handoff

When custom backgrounds are generated later, place them inside:

- `/assets/backgrounds`

Then update:

- `/assets/asset-manifest.sample.json`
- The project’s actual asset mapping file
- Relevant slide data entries
