# Persona Library and 15 Seeded Personas

## Core requirement
Seed **15 creator personas** in the database. They are seed data, not hardcoded application behavior.

Admin must later be able to edit, clone, rename, change prompt, language/genre/audience, Advanced Settings defaults, voice configuration, permissions, schedule, test, activate/pause/archive.

Every newly created or cloned persona automatically receives its own persistent memory namespace/store.

## Initial language coverage
- English
- Hindi
- Bangla
- Marathi
- Gujarati

Use Indian names and culturally plausible creative identities. Do not create language personas by merely translating one English prompt. Preserve language-native idiom, naming, cultural context, humour/rhythm and relevant literary/folklore sensibilities without stereotyping.

## Age-group mapping
The exact Kisago age-group taxonomy must be discovered from the repository.

`15_SEED_PERSONA_BLUEPRINT.json` uses conceptual `band_1` ... `band_5` only to distribute the seed ideas. During implementation:
1. inspect actual age-group model/options,
2. map conceptual bands to real age groups,
3. if the real taxonomy materially differs, propose a balanced distribution of all 15 before seeding,
4. do not invent a new age taxonomy just to fit this prompt.

If Kisago has five meaningful audience buckets, target 3 personas per bucket = 15 total.

## Persona configuration concepts
Adapt to discovered schema.

### Identity
Name, profile/avatar if supported, short bio, public attribution, creator status.

### Audience
Age group, language, genre/speciality, learning/entertainment intent.

### Creative DNA
Editable persona/system prompt, narrative philosophy, tone, vocabulary level, plot/pacing preferences, character tendencies, educational approach where relevant, restricted themes.

### Creation defaults
Typical beat range, default Advanced Settings profile, default/preferred voice, approved voice pool if supported.

### Permissions
- image generation: default OFF,
- narration: independently configurable,
- settings persona may choose dynamically,
- settings locked by admin.

### Operational
Lifecycle status, schedule eligibility, test mode, optional model override, audit fields.

### Memory
Automatic persona memory containing recent stories, titles, names, series/characters, themes/plots, settings/voice patterns where useful and relevant editorial feedback.

## Seeding quality
Do not create 15 near-identical prompts with only name/language substitutions. Intentionally vary educational discovery, bedtime/emotional stories, adventure, mystery, science/curiosity, folklore-inspired storytelling, social-emotional learning, humour, teen identity/friendship, speculative/fantasy, and suitable older-audience romance/suspense where supported by Kisago's actual audience policy.

## Before final seed migration
Show:
- mapping to actual age-group IDs/enums,
- actual supported Advanced Settings values,
- actual voice IDs/options,
- image OFF confirmation,
- narration behavior,
- confirmation prompts are editable data.

Do not fabricate voice/style/setting identifiers.
