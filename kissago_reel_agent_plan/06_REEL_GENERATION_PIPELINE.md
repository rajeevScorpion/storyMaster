# 06 Reel Generation Pipeline

Build the Reel Story pipeline by reusing existing story generation, image generation, narration, and storage services where possible.

## Pipeline stages

A practical generation flow:

1. Validate user, plan, limits, and feature flag.
2. Read admin Reel Story settings.
3. Resolve user selections and defaults.
4. Resolve mood preset bundle.
5. Resolve Short/Medium/Long word range from admin settings.
6. Generate reel script and beat structure.
7. Generate image prompts per beat based on storyboard image count.
8. Generate images.
9. Generate narration audio if current pipeline supports it.
10. Generate subtitle/timing metadata if supported or derive approximate timing.
11. Create timeline metadata.
12. Save story/reel record and assets.
13. Prepare export status.

## Beat and image density

For Reel Story, one beat can have multiple images.

Example:

- Admin setting: `storyboard_image_count_per_beat = 8`
- User creates a one-beat reel
- System generates 8 image prompts/assets for that beat
- Timeline sequences each image for around 2 to 3 seconds

This control is admin-only.

## Timing

Default image duration should come from admin settings, e.g. 2.5 seconds.

If narration is longer:

- stretch image durations proportionally within safe max
- or allow final image to hold longer

If narration is shorter:

- compress image durations within safe min
- or trim timeline if export system allows

## Image style

Default output should be highly artistic. Lower resolution or softer texture can be acceptable for mobile-first artistic reels.

Do not hardcode one visual style. Use admin/user visual style definers.

## Script length

Users select only Short, Medium, or Long.

The actual word count ranges come from admin settings and must be inserted into the generation prompt.

## Prompt composition

Effective prompt should combine:

- system safety/story requirements
- user idea
- mood preset definer
- narration style definer
- visual style definer
- script length definer
- storyboard rhythm definer
- language if applicable
- output schema instructions

## Output schema

Prefer structured JSON output from the model if existing generation pipeline supports structured output.

A useful shape:

```json
{
  "title": "",
  "beats": [
    {
      "beat_index": 1,
      "script": "",
      "narration_text": "",
      "image_prompts": ["", ""]
    }
  ],
  "timeline": [
    {
      "beat_index": 1,
      "image_index": 1,
      "duration_seconds": 2.5,
      "transition": "soft_zoom"
    }
  ]
}
```

Adapt to current code conventions.

## Failure handling

- Retry failed images individually where existing services allow.
- If narration fails, save the reel and allow retry.
- If export fails, preserve generated assets and allow retry.
- Do not regenerate all assets on every export attempt.

