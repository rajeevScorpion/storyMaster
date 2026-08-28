# Discovery-First Instructions

Before implementation, inspect the existing Kissago codebase and produce a brief discovery report.

Do not assume architecture. Do not start coding until the discovery report is written.

## Required discovery areas

### 1. Story and beat model

Find:

- Story table/model/schema.
- Beat table/model/schema.
- Option table/model/schema.
- Any selected option/path model.
- Beat order/indexing logic.
- Current story status lifecycle.

Questions to answer:

- How are beats ordered?
- How is a selected choice stored?
- Are beats immutable currently?
- Are deleted beats hard-deleted or soft-deleted anywhere else?

### 2. Image/storyboard generation flow

Find:

- Where image prompts are created.
- Where storyboard/panel layouts are defined.
- How panel count is stored.
- How generated images are stored.
- Whether image generation is synchronous, job-based, server action, route handler, API call, or client-triggered.
- Whether Cloudflare/storage references are used.

Questions to answer:

- Is there already a regeneration flow?
- Are images linked to beats or stories?
- Is there existing image versioning?
- How are character reference images/prompts passed?

### 3. Narration generation flow

Find:

- Where narration text is created.
- Where audio is generated/stored if applicable.
- Whether narration is beat-level or full-story-level.
- Whether word-by-word timestamps are generated.

Questions to answer:

- Does regenerating narration require re-exporting anything?
- Is narration dependent on the image or only beat text?

### 4. Options generation flow

Find:

- Where choice/options are generated.
- How many options are generated.
- Whether user-selected option is stored.
- Whether options are used to generate the next beat.

Questions to answer:

- Can options be regenerated safely after next beat exists?
- How to protect already-selected paths?

### 5. Named character/reference prompt logic

Find:

- Existing named-character extraction/definition code.
- Existing character prompt object or text.
- Existing character reference generation code.
- Existing way character references are passed to image generation.

Questions to answer:

- What is the canonical source of named-character truth for the current story?
- Are names unique within a story?
- How should `@name` be validated?

### 6. Admin settings/feature flags

Find:

- Existing admin settings table/config.
- Existing feature flag pattern.
- Existing tiering pattern if any.
- Existing environment variables relevant to generation.

### 7. Auth and permission boundaries

Find:

- How user ownership of stories is checked.
- How API routes/server actions authorize story access.
- Whether admin-only routes exist.

## Required discovery report format

Before coding, write:

```md
# Kissago Pack 1 Discovery Report

## Current architecture summary

## Relevant files found

## Existing data models

## Existing generation flows

## Character reference handling

## Admin/feature flag handling

## Proposed implementation approach

## Files to change

## Risks and mitigations

## Open questions / assumptions avoided
```

## Stop conditions

Stop and ask for project-owner decision only if:

- There is no clear story/beat model.
- Existing data is at risk of destructive migration.
- The current image pipeline cannot support regeneration without major rewrite.
- Character reference data is not stored anywhere.
- Auth/ownership checks are missing and cannot be inferred.

Otherwise, implement with safe assumptions documented.
