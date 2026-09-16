# PHASE 7 PROMPT — Prompt Playground Migration

Preserve the existing Prompt Playground as the place where admins control task prompt templates and generation parameters. Replace its Gemini-specific model dependency with the shared Text Model Registry.

For each text task entry, show the configured text model, allow selection from enabled text models, preserve temperature/prompt editing and published/draft semantics, persist model selection, and ensure runtime uses the selected registry model.

Inspect how current model names are stored. Implement the least disruptive migration: compatibility resolver, seeded equivalent records, or migration as appropriate. Do not leave a state where Admin shows one model but runtime silently uses another.

Helpful dropdown labels may include display name + provider. If capability tags exist, filter incompatible models only when it improves safety/usability; do not make Admin unnecessarily restrictive.

Centralize any emergency fallback and log when it is used. Test selecting, saving, reloading, publishing if applicable, runtime generation, disabled/deleted model, and missing provider credentials.
