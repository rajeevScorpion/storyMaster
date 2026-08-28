# 07 — Phase 5: Age Classification, Genres, and Kids Experience

## Objective
Introduce reliable age-appropriate content discovery and a dedicated Kids experience without inventing unsupported safety claims.

## Product bands
The product direction requires at minimum:
- **Kids:** approximately ages 3–8
- **Older Kids:** approximately ages 8–12
- **General / older audiences:** older teen/adult discovery as appropriate

Do not label 8-year-old content as "Teen" merely because an earlier discussion loosely grouped it that way. Use neutral naming in the data model and let UI labels be refined.

## First inspect
Find whether the project already stores:
- intended age
- minimum/maximum age
- reading level
- content rating
- genre/category/tag
- safety moderation labels
- creator-supplied audience selection

Reuse existing fields where semantically sound.

## Data model principles
Age eligibility should be machine-filterable. Prefer explicit fields/enums over free text.

A practical model may contain concepts equivalent to:
- audience band
- minimum age
- maximum age
- genre(s)

Use the repository's existing data conventions. Do not add all of these if one existing representation is sufficient.

## Classification source
For newly generated Storylines, capture intended audience/age information at creation/generation time where possible.

Do not rely solely on after-the-fact title keyword heuristics.

If AI-assisted classification is used:
- make output structured and validated
- constrain to supported enums/categories
- store the result
- do not classify on every Gallery request

## Kids Gallery
Create a clear Kids discovery mode/section using eligible Storylines only.

For Kids 3–8:
- do not surface content outside permitted classification
- prioritize simple navigation
- keep visual hierarchy understandable
- do not add unnecessary engagement pressure or autoplay patterns

For 8–12:
- keep separate filtering capability even if the UI initially shares some rails with general discovery

## Genres
Use genres supported by actual data. Build reusable filtering/rail logic rather than hard-coded one-off sections.

## Important safety/quality note
Age metadata is a discovery/filtering mechanism, not a substitute for content safety/moderation. If the repository already has moderation controls, preserve them and apply them before Gallery eligibility.

## Acceptance criteria
- Kids mode cannot query/show out-of-band Storylines through normal UI paths
- direct URLs still honor existing authorization/visibility rules
- age filtering occurs server-side or at the trusted data layer where practical, not only through client-side hiding
- genres are data-driven
- empty categories fail gracefully

## Commit split
Prefer:
1. schema/classification changes
2. Gallery filtering/sections
