# Manual QA Checklist — Pack 1

Use this checklist before reporting completion.

- [ ] Existing story generation works.
- [ ] Existing stories open normally.
- [ ] Beat action menu appears only when feature flags allow it.
- [ ] Image regeneration basic mode works.
- [ ] Image regeneration advanced per-panel mode works for 1-panel layout.
- [ ] Image regeneration advanced per-panel mode works for 2-panel layout.
- [ ] Image regeneration advanced per-panel mode works for 4-panel layout.
- [ ] Image regeneration does not alter beat text.
- [ ] Image regeneration does not wipe future beats.
- [ ] Failed image regeneration keeps old image active.
- [ ] Image version history shows older versions.
- [ ] Restore image version works.
- [ ] Narration regeneration works.
- [ ] Narration regeneration does not alter image/story text.
- [ ] Options regeneration works for latest beat.
- [ ] Options regeneration is protected for past beats with downstream content.
- [ ] Custom option can be added.
- [ ] Valid `@name` mention is accepted.
- [ ] Invalid `@name` mention shows useful error.
- [ ] Editing latest beat text works.
- [ ] Editing past beat shows warning.
- [ ] Canceling past edit preserves everything.
- [ ] Confirming past edit wipes/archives downstream content only.
- [ ] Timeline rewrite event/revision is stored.
- [ ] Feature flags disable backend access as well as UI.
- [ ] Mobile UI is usable.
- [ ] Build/lint/typecheck pass or baseline issues are documented.
