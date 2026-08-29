# Rollout and Rollback Guide

## Rollout strategy

### Step 1 — Hidden backend deployment

Deploy migrations and backend services with all new UI flags disabled.

Verify:

- Existing stories still load.
- Existing image fields still work.
- New tables do not break reads.

### Step 2 — Admin/internal testing

Enable for admin/test users only if user segmentation exists.

Test:

- Image regeneration.
- Version history.
- Beat edit warning.
- Downstream wipe.

### Step 3 — Limited user release

Enable:

- Image regeneration.
- Basic suggestions.
- Version history.

Keep advanced panel controls disabled until image consistency is stable.

### Step 4 — Advanced visual controls

Enable per-panel suggestions.

Monitor:

- Regeneration success rate.
- User retries.
- Image cost.
- Failed jobs.

### Step 5 — Story-changing controls

Enable beat text editing with continuity lock.

Monitor:

- Accidental wipe complaints.
- Confirmation conversion.
- Restore/support issues.

### Step 6 — Options/custom options

Enable custom options and options regeneration last.

## Rollback strategy

### Fast rollback

Disable flags:

```json
{
  "enableBeatTextEditing": false,
  "enableImageRegeneration": false,
  "enableAdvancedPanelImageRegeneration": false,
  "enableNarrationRegeneration": false,
  "enableOptionsRegeneration": false,
  "enableCustomOptions": false
}
```

Existing stories should continue using old rendering path.

### Data rollback

Do not immediately delete new tables. Keep them dormant.

If active image versioning causes display issue:

- Fall back to legacy beat image URL field if present.
- Keep generated versions for later cleanup.

### Migration rollback

Only run down migrations if:

- Deployment must revert fully.
- No new production data needs preservation.
- Project owner approves.

Otherwise prefer feature-flag rollback.

## Failure scenarios and handling

### Image regeneration fails

Expected behavior:

- Previous active image remains visible.
- Failed request is logged.
- User sees retry option.

### Downstream wipe bug suspected

Immediate action:

- Disable beat text editing and options regeneration.
- Preserve logs.
- Investigate timeline rewrite events.

### Storage cost spike

Immediate action:

- Limit max image versions per beat.
- Disable reimagine mode.
- Restrict advanced panel regeneration.

### Prompt inconsistency

Immediate action:

- Tighten prompt contract.
- Add stronger character identity preservation.
- Consider using previous image/reference as input if provider supports it.

## Post-release monitoring

Track:

- Number of image regenerations per story.
- Regeneration failure rate.
- Average regeneration time.
- Number of timeline rewrite confirmations.
- Number of canceled rewrite warnings.
- Most common visual suggestions.
- Custom option validation failures.
