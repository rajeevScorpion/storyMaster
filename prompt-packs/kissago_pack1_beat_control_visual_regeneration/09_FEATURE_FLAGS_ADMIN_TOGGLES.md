# Feature Flags and Admin Toggles

Implement using the existing admin/config system. If no such system exists, add a minimal safe configuration layer and document it.

## Required flags

```json
{
  "enableBeatTextEditing": false,
  "enableTimelineLock": true,
  "enableImageRegeneration": false,
  "enableAdvancedPanelImageRegeneration": false,
  "enableNarrationRegeneration": false,
  "enableOptionsRegeneration": false,
  "enableCustomOptions": false,
  "enableImageVersionHistory": false
}
```

Default new user-facing features to disabled unless project owner wants immediate rollout.

## Optional admin controls

```json
{
  "imageRegenerationDefaultMode": "refine",
  "allowReimagineMode": true,
  "maxImageRegenerationsPerBeat": 5,
  "maxCustomOptionsPerBeat": 3,
  "maxVisualSuggestionLength": 500,
  "maxPanelSuggestionLength": 300,
  "preserveOldImageVersions": true,
  "showTimelineRewriteWarning": true
}
```

## Tier-aware controls if existing tier system exists

Only implement if existing tier system is already present.

Possible controls:

- Free users: limited image regenerations.
- Paid users: more regenerations.
- Higher tier: advanced per-panel controls.
- Admin can configure limits.

Do not create a full new billing system in this pack.

## Flag behavior

### `enableBeatTextEditing`

Controls beat text edit UI and backend route access.

### `enableTimelineLock`

Should normally remain on. If disabled for emergency, editing should still be cautious.

### `enableImageRegeneration`

Controls image regeneration modal and backend route.

### `enableAdvancedPanelImageRegeneration`

Controls per-panel UI only. Basic image regeneration can remain available.

### `enableNarrationRegeneration`

Controls narration regeneration UI/backend action.

### `enableOptionsRegeneration`

Controls generated option refresh.

### `enableCustomOptions`

Controls custom option input and storage.

### `enableImageVersionHistory`

Controls version drawer/restore UI. Backend can still preserve versions for safety.

## Admin safety requirement

Backend must enforce flags too. Do not hide only in frontend.

## Rollout recommendation

1. Enable image versioning internally.
2. Enable image regeneration for admin/test users.
3. Enable basic image suggestions.
4. Enable advanced per-panel suggestions.
5. Enable narration regeneration.
6. Enable custom options.
7. Enable beat text editing with timeline lock.
8. Enable options regeneration last.

Options regeneration should be last because it has more continuity risk.
