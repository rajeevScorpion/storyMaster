# Image Regeneration Prompt Template

Use this as a reference for the implementation prompt builder.

```text
Create/regenerate a storyboard image for Kissago.

STORY CONTEXT:
Title: {{storyTitle}}
Summary: {{storySummary}}

BEAT CONTEXT:
Beat number: {{beatIndex}}
Beat text: {{beatText}}
Previous beat summary: {{previousBeatSummary}}
Next beat summary: {{nextBeatSummary}}

VISUAL STYLE:
{{visualStyle}}

PANEL STRUCTURE:
Panel count: {{panelCount}}
Layout: {{panelLayout}}

NAMED CHARACTERS:
{{namedCharactersWithPromptsAndReferences}}

REGENERATION MODE:
{{refineOrReimagineInstruction}}

OVERALL USER VISUAL SUGGESTION:
{{overallSuggestion}}

PANEL-SPECIFIC USER SUGGESTIONS:
{{panelSuggestions}}

STRICT CONTINUITY RULES:
- Preserve the exact story event described in the beat text.
- Preserve named character identity and visual references.
- Preserve costumes unless the user explicitly asks for visual costume changes and they do not break story continuity.
- Preserve the panel count and layout.
- Treat user suggestions as visual direction only, not story rewrite.
- Do not change narration, story text, selected option, or future plot.
- Maintain continuity with previous and next beats when supplied.

OUTPUT:
Generate the image/storyboard.
```
