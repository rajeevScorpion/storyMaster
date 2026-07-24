# Phase 09 — World and Scene Continuity

Implement a compact world/scene continuity package so the environment remains coherent without repeating a long world description in every panel.

## Separate Scopes

- Story world: persistent visual identity
- Scene location: current place
- Beat state: lighting, weather, time and temporary objects
- Panel variation: camera-specific visible details

## World References

Where world reference images exist:

- Use their stored concise visual description.
- Attach the reference image through native provider mechanisms where supported.
- Avoid repeating the same description per panel.
- Keep stable architectural, palette and material anchors.

## Object Continuity

Track important objects across sequential panels when the story requires it.

For the example scene:

- The same bright red apple is tossed in bottom-left and held in bottom-right.
- Do not create multiple apples unless the scene says so.

Support a compact continuity declaration for:

- Important props
- Their owner/holder
- State changes
- Position changes
- Damage or transformation

## Global and Panel Differences

Compile global environment once. Panel descriptions should contain only:

- Visible action
- Camera framing
- Important local detail
- Intentional deviation from global lighting/environment

## Tests

- Same location across panels
- Lighting override in one panel
- Weather continuity
- Prop continuity
- World reference mapping
- Scene change between beats
- Episodic carry-forward
