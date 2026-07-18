# Recommended Branch and Commit Plan

Use the repository's existing conventions. Suggested logical commits:

1. `docs: map current Kissago image generation pipeline`
2. `test: add legacy prompt and image quality baseline fixtures`
3. `feat: add versioned canonical image scene schema`
4. `feat: add legacy scene conversion adapter`
5. `feat: add visual relevance filtering`
6. `feat: add scene normalisation and semantic deduplication`
7. `feat: add provider-neutral image prompt compiler`
8. `feat: add image model capability registry fields`
9. `feat: add provider prompt adapters`
10. `feat: improve character reference mapping and continuity`
11. `feat: add world and object continuity compilation`
12. `feat: add storyboard composition strategy support`
13. `feat: integrate regeneration visual deltas`
14. `feat: add prompt budgets and graceful compression`
15. `feat: add compiler observability and admin comparison`
16. `feat: add feature flags shadow mode and rollback path`
17. `test: add provider integration and quality evaluation suite`
18. `docs: add rollout rollback and adapter authoring guide`

Do not force this exact split if the codebase requires a different sequence. Keep commits reviewable, buildable and reversible.

At every commit:

- Run relevant tests.
- Avoid unrelated formatting changes.
- Note migrations.
- Update snapshots intentionally.
- Record important decisions.
