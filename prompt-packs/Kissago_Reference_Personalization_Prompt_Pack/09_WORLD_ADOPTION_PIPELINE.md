# World Adoption Pipeline

## Goal

Turn a world/location/environment reference into a reusable structured continuity anchor and, when enabled, a canonical story-styled visualization.

## Required stages

1. Validate environment reference.
2. Extract World DNA.
3. Compile concise Image Composer description.
4. Optionally create a canonical styled visualization.
5. Quality-check the visualization.
6. Store the description and asset.
7. Add the world to the Story Bible.
8. Finalize cost and status.

## World DNA schema

Capture only visually useful information:

- concise summary
- location/world category
- architecture
- geography/terrain
- spatial relationships
- materials and textures
- scale
- lighting source and direction
- atmosphere/weather
- distinctive recurring objects
- entrances, paths, windows, towers or landmarks
- continuity anchors
- elements that are incidental and should not be preserved

## Style adoption

The source may provide palette and lighting observations, but the selected story style remains authoritative.

Example:

- Source: realistic photograph of a stone courtyard
- Story style: whimsical pastel storybook
- Result: preserve courtyard layout, arches, central fountain and vegetation; render them in the selected storybook style

## Visualization modes

Admin/tier controlled:

- `description_only`
- `description_plus_canonical_visual`

Do not generate a new world visualization for every beat.

## Use in Image Composer

The compact world anchor should normally accompany relevant prompts.

For providers supporting reference handles:

- reuse handle when valid
- include concise description

For stateless providers:

- resend canonical world visualization only when it provides meaningful continuity value
- always include description
- respect provider input-image limit

## World naming

- Optional user label
- Non-colliding generated fallback
- Stable internal ID
- Support multiple worlds in one story
- Never attach all worlds to every beat
