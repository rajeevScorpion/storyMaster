# Character Adoption Pipeline

## Goal

Transform a user-uploaded character identity into a canonical character reference that matches the story's selected visual style and current Kissago character-reference conventions.

## Required stages

1. **Validate**
2. **Analyse identity**
3. **Compile stable character specification**
4. **Apply story style**
5. **Generate canonical adopted reference**
6. **Quality check**
7. **Store canonical asset**
8. **Persist Story Bible entry**
9. **Finalize cost**
10. **Notify/update UI**

## Identity versus costume

The analyser must separate:

### Stable identity

- facial structure
- hair and hairline
- visible age category needed for depiction
- body silhouette
- distinctive marks
- recurring accessories intentionally marked stable
- species/type for non-human characters

### Changeable story attributes

- clothing
- pose
- expression
- temporary objects
- background
- lighting

Do not freeze temporary clothing merely because it appears in the source. Kissago already expects costumes to change when the plot requires it.

## Naming

- User name is optional.
- Normalize whitespace and length.
- Prevent collisions within a story.
- Preserve user-facing spelling.
- Maintain a stable internal ID.
- Support `@name` integration if the current custom-option system already uses it.
- Auto-name unnamed entries without exposing fragile array indices as identity.

## Canonical generation

Reuse the current character-reference visualization mechanism if it can accept:

- identity specification
- selected story style
- provider/model
- canonical pose/background rules

Prefer a neutral, readable canonical reference over a dramatic scene.

## Quality gate

Check:

- primary identity preserved
- selected style adopted
- no unrelated extra character
- no major facial drift
- no source background copied as part of identity
- no accidental text/watermark
- usable crop and resolution

On failure:

- retry with bounded attempts
- do not duplicate charges
- provide safe error state
- use description-only fallback only when enabled
- allow user replacement where appropriate

## Story Bible entry

Persist:

- stable identity anchors
- changeable attributes
- canonical asset
- source/adoption version
- style lock
- first introduction
- aliases
- provider handles
- restrictions such as `do not add spectacles` where confidently derived
