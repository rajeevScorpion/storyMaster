# Admin Routes and UX Modularization

## Preferred product structure

### `/admin/agents`
Potential sections: Overview, Personas, Persona Test Lab, Task Pool, Editorial Supervisor, Schedules, Runs, Evaluations, Memory/Similarity, Model Routing, Cost/Usage, Settings/Permissions.

### `/admin/authors`
Potential sections: Reviewers/Expert Authors, Review Queue, Assignments, Activity/History, Permissions, Publishing actions.

## Mandatory precondition
Validate this split in Phase 0 against router conventions, admin shell, auth guards, navigation, RBAC, server/client layouts, APIs and route naming/casing. If a cleaner equivalent exists, present it before changing code.

## Persona catalogue UX
Keep compact and filterable by Age Group, Language, Genre, Status and Search. Do not render all persona detail forms at once.

Persona detail can include identity, prompt, creative defaults, Advanced Settings, voice, permissions, schedules, memory summary, recent runs/evaluation, and clone/edit/archive actions.

## Test Lab
Allow admin to choose persona, supply/auto-generate brief, run text-only test, optionally enable narration, enable images only when explicitly permitted, inspect settings/memory/model routing/evaluator, and keep results unpublished.

## Lean admin principle
Keep main `/admin` lean. Prefer compact links/cards into these modules, module-local secondary navigation and reuse of current admin components/design system.
