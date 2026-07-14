# Custom Option and Branch Integration — Later Phase

Implement only after story-creation references are stable.

## Capability

While creating a custom option, an eligible user may:

- select an existing story character
- select an existing story world
- upload one new character reference
- upload one new world reference
- optionally name/label it

Actual counts and permissions are tier/admin controlled.

## Continuity rule

A new custom-option reference applies from the custom-option branch point onward.

It must not:

- alter completed earlier beats
- appear in sibling branches
- enter unrelated episodes automatically
- overwrite an existing character merely because the name matches

## Flow

1. User creates custom option.
2. User attaches or selects references.
3. Server validates entitlement and branch ownership.
4. New source upload is processed.
5. New adoption is generated in the story's locked style.
6. Adoption records `first_introduced_beat_id` and `scope_id`.
7. Story Bible branch extension is updated.
8. Continuity journal records the introduction.
9. Downstream branch generation can reference it.
10. Parent and sibling Story Bible views remain unchanged.

## Interaction with backward editing

If the user edits an earlier beat:

- use the existing past-present continuity warning
- clearly state that downstream branch references introduced after the edit may be removed
- preserve reusable source references/library entries where policy permits
- invalidate only affected story adoptions/usages, not unrelated global assets
- avoid orphaned provider handles and coin records

## Name collision

When introducing `Leo` where a different `Leo` already exists:

- do not silently merge
- request rename or provide an explicit replace/link decision
- use internal IDs for all continuity resolution
