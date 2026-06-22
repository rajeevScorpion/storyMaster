# Clarifying Questions the Coder Should Ask

The coder should ask these after initial repository discovery and before major structural decisions.

## Product / UX
1. What are the first-release effect families that matter most?
2. Should every beat allow multiple simultaneous effect families, or only one preset-driven composite effect?
3. Should “apply to all beats” overwrite existing beat settings or only fill empty beats?
4. Should users be able to unlink a beat from a preset after applying it?
5. Should presets be global per user, per workspace, or both?
6. Should there be system presets seeded by the product?
7. Should effect intensity auto-scale based on story style or be fully manual?

## Content model
8. What does a beat object look like today?
9. Is there already a place to store per-beat visual metadata?
10. Are story settings already stored separately from beat settings?

## Rendering
11. Is the current player DOM-based, canvas-based, or hybrid?
12. Are transitions currently CSS-driven, JS-driven, or timeline-driven?
13. Is there already a reusable timing/timeline abstraction?
14. Can the current player support a canvas/WebGL overlay without major rewrite?

## Export
15. How are videos exported today?
16. Is export done client-side, server-side, or both?
17. Can the export path reuse browser rendering components?
18. Is deterministic frame-based rendering already available?
19. Are there duration / resolution / performance constraints for export?

## Persistence
20. Where should presets be stored?
21. Is there already a user settings/preferences model?
22. How are story schema migrations handled today?

## Performance / platform
23. What are minimum target devices?
24. Do we need quality tiers such as low / medium / high?
25. Is future Capacitor/mobile compatibility a hard requirement for this phase or just a compatibility preference?

## Delivery / process
26. What level of test coverage is expected?
27. Are there feature flags for gradual rollout?
28. Should this ship behind an experimental toggle first?

