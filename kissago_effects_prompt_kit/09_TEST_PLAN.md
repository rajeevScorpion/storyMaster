# Test Plan

## 1. Unit tests
Test:
- effect schema normalization
- defaults merging
- preset application
- beat override merging
- apply-to-all behavior
- validation / clamping of settings

## 2. Integration tests
Test:
- beat playback with effects enabled
- transitions + effect coexistence
- narration synced text with active effects
- preset save/load/apply
- story-level bulk effect application

## 3. Export tests
Test:
- exported video includes effects visually
- exported duration remains aligned with narration
- transitions are preserved
- text overlays remain synchronized

## 4. Visual regression tests
Use automated screenshots or frame captures where practical.

Recommended targets:
- no effect baseline
- cinematic drift preset
- snow preset
- ember preset
- rain preset
- blur dissolve transition

## 5. Performance tests
Measure:
- frame rate in preview
- CPU/GPU impact of heavy presets
- memory usage
- export times

## 6. Failure-mode tests
Test:
- missing preset
- deleted preset referenced by beat
- invalid effect values
- export interrupted mid-run
- unsupported browser/device capabilities

## 7. Manual QA checklist
- edit one beat effect
- apply to all beats
- save custom preset
- reuse preset on another story
- export story
- compare preview vs exported video

