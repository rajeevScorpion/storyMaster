# Prompt Contracts

This document defines stable prompt contracts for Pack 1. Adapt to the actual model/provider code, but preserve intent.

## Image regeneration contract

### Goal

Regenerate a beat storyboard/image while preserving story continuity.

### Inputs

```ts
ImageRegenerationPromptInput {
  storyTitle?: string
  storySummary?: string
  beatIndex: number
  beatText: string
  previousBeatSummary?: string
  nextBeatSummary?: string
  visualStyle: string
  panelCount: 1 | 2 | 4
  panelLayout?: string
  namedCharacters: Array<{
    name: string
    characterPrompt: string
    appearancePrompt?: string
    referenceImageUrl?: string
    currentCostumeOrState?: string
  }>
  existingImageDescription?: string
  mode: 'refine' | 'reimagine'
  overallSuggestion?: string
  panelSuggestions?: Array<{
    panelNumber: number
    suggestion: string
  }>
  safetyAndContinuityRules: string[]
}
```

### Required continuity rules

Always include these rules in the image-generation instruction:

- Preserve the exact story event described in the beat text.
- Do not add a new plot event unless explicitly requested and still consistent with beat text.
- Do not remove named characters required by the beat.
- Preserve named character identity and visual references.
- Preserve costumes unless user asks for visual costume change and it does not conflict with story continuity.
- Preserve the chosen visual style unless user specifically requests a visual style shift.
- Preserve panel count and layout.
- Treat user suggestions as visual direction, not story rewrite.
- Maintain continuity with previous and next beats when supplied.

### Mode behavior

#### Refine

Use when user wants improvement without major reinterpretation.

Instruction:

```text
Refine the existing storyboard concept. Keep the scene composition, character identities, story event, and panel logic close to the current version. Improve clarity, polish, emotional expression, visual consistency, detail, lighting, and composition according to the user's visual suggestions.
```

#### Reimagine

Use when user wants stronger visual variation.

Instruction:

```text
Reimagine the visual treatment of the storyboard while preserving the same story event, named characters, character identities, narrative meaning, visual style constraints, and panel count. You may change camera angles, composition, lighting, staging, and background richness according to the user's suggestions.
```

### Prompt template

```text
Create/regenerate a storyboard image for Kissago.

STORY CONTEXT:
Title: {{storyTitle}}
Summary: {{storySummary}}

BEAT:
Beat number: {{beatIndex}}
Beat text: {{beatText}}

CONTINUITY CONTEXT:
Previous beat summary: {{previousBeatSummary}}
Next beat summary: {{nextBeatSummary}}

VISUAL STYLE:
{{visualStyle}}

PANEL STRUCTURE:
Panel count: {{panelCount}}
Layout: {{panelLayout}}

NAMED CHARACTERS TO PRESERVE:
{{namedCharacters}}

REGENERATION MODE:
{{modeInstruction}}

USER OVERALL VISUAL SUGGESTION:
{{overallSuggestion}}

USER PANEL-SPECIFIC SUGGESTIONS:
{{panelSuggestions}}

STRICT RULES:
- Preserve the story event and narrative meaning.
- Preserve named character identity and appearance references.
- Preserve panel count and storyboard layout.
- Apply panel-specific suggestions only to their panels.
- Do not change story text, narration, or future story direction.
- Do not introduce continuity-breaking elements.

OUTPUT:
Generate the image/storyboard according to the above.
```

## Narration regeneration contract

### Goal

Regenerate narration from current beat text only.

### Inputs

```ts
NarrationRegenerationInput {
  beatText: string
  storyTone?: string
  narrationStyle?: string
  audienceAge?: string
  voiceSettings?: Json
  timestampRequired?: boolean
}
```

### Rules

- Do not rewrite beat story text unless the existing narration system always adapts it.
- Keep meaning identical.
- Match current story tone.
- Regenerate word-level timestamps if the app uses them.

### Prompt template

```text
Create narration for this Kissago beat.

Beat text:
{{beatText}}

Narration style:
{{narrationStyle}}

Audience:
{{audienceAge}}

Rules:
- Preserve meaning.
- Keep it suitable for the story tone.
- Do not add new plot events.
- Return output in the format expected by the existing narration pipeline.
```

## Options regeneration contract

### Goal

Generate fresh continuation options for the current beat.

### Inputs

```ts
OptionsRegenerationInput {
  storyContext: string
  beatText: string
  namedCharacters: Character[]
  previousChoices?: string[]
  numberOfOptions: number
  audienceAge?: string
  tone?: string
}
```

### Rules

- Options must continue from the current beat.
- Options should be meaningfully different.
- Options should respect story tone and audience age.
- Do not introduce excessive new named characters unless existing system allows.
- Preserve named character continuity.

### Prompt template

```text
Generate {{numberOfOptions}} continuation options for the current Kissago story beat.

Story context:
{{storyContext}}

Current beat:
{{beatText}}

Named characters:
{{namedCharacters}}

Rules:
- Each option must be clear and choice-like.
- Each option should lead to a different plausible next beat.
- Preserve story tone and character continuity.
- Do not contradict earlier beats.
- Keep the language simple and user-friendly.
```

## Custom option parsing contract

Custom options are user-authored. Do not rewrite them before storing unless the existing app normalizes options.

Parse `@name` mentions and validate them against current story named characters.

Example:

```text
@Milo and @Tara climb the spiral staircase to see the city from above.
```

Parsed result:

```json
{
  "optionText": "@Milo and @Tara climb the spiral staircase to see the city from above.",
  "mentions": [
    { "displayText": "@Milo", "characterName": "Milo", "valid": true },
    { "displayText": "@Tara", "characterName": "Tara", "valid": true }
  ]
}
```

## Prompt anti-patterns

Do not let image-regeneration prompts say:

- “Create a new story.”
- “Change the plot.”
- “Ignore previous image.”
- “Use any characters.”
- “Change the character appearance freely.”

Do not let narration prompts introduce new events.

Do not let options regeneration silently rewrite a selected path.
