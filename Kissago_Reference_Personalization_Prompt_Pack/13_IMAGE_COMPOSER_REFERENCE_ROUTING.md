# Image Composer Reference Routing

## Objective

Add relevant reference context without polluting every prompt or exceeding provider limits.

## Normalized input

Extend the Image Composer with a provider-neutral object:

```json
{
  "style_lock": {},
  "characters": [],
  "worlds": [],
  "usage_context": {
    "story_id": "",
    "branch_id": "",
    "beat_id": "",
    "panel_id": ""
  }
}
```

## Selection logic

### Characters

Include an adopted character only when:

- explicitly present in beat/panel data
- referenced by stable character ID
- inferred through existing named-character resolution with sufficient confidence

Do not include all character references merely because they belong to the story.

### Worlds

Include a world when:

- the beat has a resolved world/location ID
- the narrative clearly continues in the same world under existing continuity rules
- the branch Story Bible establishes it as current location

### Priority under input limits

1. Main foreground characters
2. Character whose identity is most vulnerable to drift
3. Current world
4. Secondary characters
5. Additional contextual world reference

The exact policy should be configurable or provider-aware where practical.

## Prompt construction

Keep three logically separate sections:

1. **Story visual style lock**
2. **Scene/beat instructions**
3. **Reference continuity anchors**

Reference descriptions must never contain instructions that override the style lock.

## Provider adaptation

Adapters decide:

- handle versus resend
- number of images
- image role/weight
- supported MIME/size
- provider-specific ordering

Core services must not embed provider-specific payloads.

## Logging

Record:

- selected adoption IDs
- selection reason
- input mode
- omitted references due to limit
- provider handle status
- compiler version

Do not log signed private URLs.
