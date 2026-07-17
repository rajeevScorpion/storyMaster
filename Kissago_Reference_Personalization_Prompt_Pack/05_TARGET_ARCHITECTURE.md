# Target Architecture

Adapt this architecture to the discovered codebase. Names are conceptual, not mandatory class names.

## Durable layers

### 1. Reference Source

Private original user upload.

Responsibilities:

- Ownership
- Type: character or world
- Storage key
- MIME, size, dimensions and checksum
- Moderation/validation state
- Optional user label
- Retention state

### 2. Story Reference Adoption

Story-specific interpretation of a source reference.

Responsibilities:

- Story ID
- Branch/scope
- Selected style ID and style version
- Selected image provider/model
- Structured character or world description
- Canonical adopted image
- Adoption version
- Processing status
- Provider handles
- Cost record

### 3. Story Reference Usage

Records where and how an adopted reference is relevant.

Responsibilities:

- Story/episode/branch
- Beat
- Character appearance or world location
- First introduction point
- Prompt inclusion decision
- Provider handle used
- Canonical asset version

## Suggested request flow

```text
Story Setup UI
  -> Create temporary/private reference source
  -> Validate tier and upload constraints
  -> Upload to private storage
  -> Create adoption request
  -> Reserve coins when applicable
  -> Durable adoption job
      -> validate/moderate
      -> analyse
      -> style-adopt or visualize
      -> store canonical asset
      -> update Story Bible
      -> finalize coin transaction
  -> Story can start when required adoptions are ready
  -> Image Composer selects only relevant adoptions
  -> Provider adapter chooses handle reuse or reference resend
```

## Source of truth

Kissago owns:

- Structured descriptions
- Canonical adopted references
- Story Bible anchors
- Adoption status/version
- Usage history

Providers own only transient processing and optional handles.

## Compatibility principle

A story with no references should continue to execute the existing generation pipeline without additional provider inputs or prompt noise.

## Reference selection principle

The core Image Composer should receive a normalized reference context, for example:

```ts
type NormalizedReferenceContext = {
  characters: CharacterReferenceContext[];
  worlds: WorldReferenceContext[];
  styleLock: StoryVisualStyleLock;
};
```

Provider adapters convert this normalized context into provider-specific image inputs, handles, weights and prompt fragments.
