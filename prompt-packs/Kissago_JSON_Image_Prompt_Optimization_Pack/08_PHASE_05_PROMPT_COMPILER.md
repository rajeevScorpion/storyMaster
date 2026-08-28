# Phase 05 — Provider-Neutral Prompt Compiler

Create a deterministic compiler that converts the normalised canonical scene into a compact, provider-neutral prompt representation.

## Intermediate Output

Prefer an intermediate structure rather than immediately creating one string:

```ts
interface CompiledImagePrompt {
  compilerVersion: string;
  composition: string;
  styleAndWorld: string;
  characters: string;
  panels: string[];
  continuity: string;
  negativePrompt: string;
  fullPrompt: string;
  characterCount: number;
  estimatedTokens?: number;
  removedInformation: DiagnosticItem[];
  compressionActions: DiagnosticItem[];
  warnings: string[];
}
```

Adapt names to current conventions.

## Default Instruction Priority

1. Output format and layout
2. Character identity/reference mapping
3. Panel action and staging
4. Sequential continuity
5. World and scene
6. Style, palette and lighting
7. Secondary environmental detail
8. Negative constraints

Provider adapters may reorder sections when evidence supports it.

## Compilation Rules

- Define layout once.
- Define style and world once.
- Define each character once.
- Describe each panel once.
- Name only characters actually present in the panel.
- Use explicit absence only where ambiguity is likely.
- State continuity once.
- State negatives once.
- Preserve user visual instructions in a clearly bounded section.
- Avoid UUIDs and internal labels.
- Produce deterministic output for the same scene and compiler version.

## Character Presence Example

```text
Characters
Master Elrick — elderly scholar with a long white beard, spectacles and scholarly medieval robes.
Leo — curious boy with messy brown hair and a simple medieval tunic.

Bottom-left — Medium close-up of Master Elrick smiling as he strokes his beard and tosses a bright red apple. Leo is not present.
```

Do not add `Leo is not present` mechanically to every panel. Add explicit absence only when it prevents likely duplication or ambiguity.

## User Instructions

Treat user instructions as visual deltas, not as a replacement for canonical identity or layout rules.

Example:

- Overall: `make the market busier and add evening light`
- Panel: `in bottom-right, move the apple closer to Leo`

Compile them with clear scope and ensure they cannot silently remove mandatory panel count or character identity requirements.

## Outputs and Tests

Implement:

- Pure compile function
- Compiler versioning
- Snapshot tests
- Character-count tests
- Determinism tests
- Legacy-versus-new prompt comparison output
- Diagnostics showing what was removed and why
