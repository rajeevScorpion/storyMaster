# Phase 02 — Canonical Image Scene JSON

Design a provider-independent canonical scene specification. Reuse or extend the existing scene model rather than creating an unnecessary parallel source of truth.

## Required Design Qualities

The schema must be:

- Versioned
- Runtime validated
- Type-safe
- Human-readable
- Extensible
- Suitable for storage and regeneration
- Suitable for one-panel and multi-panel output
- Independent of a specific provider
- Able to reference persistent character and world records

## Separate These Concerns

1. Persistent character identity
2. Persistent world identity
3. Story-level visual invariants
4. Beat-level scene information
5. Panel-level staging
6. User regeneration instructions
7. Internal metadata
8. Provider request metadata
9. Compiled prompt output

Do not store the final compiled prompt as the sole source of truth.

## Suggested Shape

Adapt this concept to the existing codebase:

```ts
interface CanonicalImageScene {
  schemaVersion: string;
  imageType: 'single' | 'storyboard';
  aspectRatio: string;
  layout: LayoutSpec;
  global: {
    style?: VisualStyleSpec;
    world?: WorldVisualSpec;
    lighting?: string;
    palette?: string[];
    continuity?: ContinuitySpec;
  };
  characters: SceneCharacterSpec[];
  panels: PanelSpec[];
  negativeConstraints?: string[];
  userInstructions?: {
    overall?: string;
    perPanel?: Record<string, string>;
  };
  internal?: InternalSceneMetadata;
}
```

## Character Fields

Store stable visual identity separately from personality and narrative biography.

Useful visual fields may include:

- Stable key
- Display name
- Age band
- Face/hair/body descriptors
- Distinguishing features
- Base clothing or current beat clothing
- Colour anchors
- Reference asset IDs
- Reference type
- Continuity priority

Do not automatically compile:

- UUIDs
- Database IDs
- Character role labels with no visual purpose
- Personality summaries with no visible expression
- `hasReferencePortrait`
- Storage paths

## Panel Fields

Each panel should support:

- Stable position/index
- Shot/camera framing
- Characters present
- Action
- Emotion/expression
- Pose or interaction
- Important objects
- Spatial relationships
- Visual focus
- Environment differences
- Panel-specific instruction
- Explicit absence only when necessary

## Validation Rules

Validate at minimum:

- Unique panel positions
- Panel count matches layout
- Characters referenced by panels exist
- No accidental duplicate character entries per panel
- Required action is present
- User text respects configured length
- Aspect ratio is supported by the chosen layout
- Unknown schema versions fail safely
- Internal metadata cannot leak into compileable fields

## Migration and Compatibility

- Existing stories must continue to regenerate.
- Add a conversion layer from legacy records where needed.
- Persist schema version.
- Avoid irreversible migrations before rollout.
- Add fixtures for old and new records.

## Deliverables

- Types
- Runtime schema
- Versioning strategy
- Legacy conversion adapter
- Tests
- Developer documentation
