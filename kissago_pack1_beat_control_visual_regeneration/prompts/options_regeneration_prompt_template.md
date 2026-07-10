# Options Regeneration Prompt Template

```text
Generate {{numberOfOptions}} continuation options for the current Kissago story beat.

STORY CONTEXT:
{{storyContext}}

CURRENT BEAT:
{{beatText}}

NAMED CHARACTERS:
{{namedCharacters}}

PREVIOUS USER CHOICES:
{{previousChoices}}

RULES:
- Each option must be a clear next choice.
- Each option should lead to a meaningfully different next beat.
- Preserve character continuity.
- Do not contradict previous story events.
- Keep the tone suitable for the selected audience.
- Do not introduce unnecessary new named characters.

OUTPUT FORMAT:
Return options in the exact structured format used by the existing Kissago options pipeline.
```
