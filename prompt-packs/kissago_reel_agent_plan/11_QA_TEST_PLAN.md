# 11 QA Test Plan

Run available checks and perform manual flow testing.

## Automated checks

Inspect `package.json` and run appropriate available commands, such as:

```bash
npm run lint
npm run typecheck
npm run build
npm test
```

Only run commands that exist. Document skipped commands and reasons.

## Manual user flow tests

Test as a free user:

1. Reel Story appears beside existing creation methods.
2. Default orientation is 9:16.
3. Default input is without image.
4. User can enter a short idea and generate a reel record.
5. User sees Short/Medium/Long only, not raw word counts.
6. User does not see storyboard image count.
7. Branding removal toggle is hidden or disabled.
8. Generated reel has branding enabled.
9. Expiry/retention notice appears where appropriate.

Test as a paid user if plan simulation is available:

1. Branding toggle appears only if admin allows it.
2. Server enforces branding permission.
3. Longer retention policy is reflected if implemented.

## Admin tests

1. Admin can enable/disable Reel Story.
2. Admin can set storyboard image count per beat.
3. Admin can configure Short/Medium/Long word ranges.
4. Admin can configure default mood, narration, visual style.
5. Admin can edit prompt definers or see seeded ones.
6. Admin can preview combined prompt if playground/minimal preview implemented.
7. Admin can configure cleanup settings.

## Regression tests

Confirm existing flows still work:

- Prompt Story
- Seed Story
- story playback
- published story links
- cover image behavior if touched
- auth/session
- admin access
- storage upload/download

## Storage lifecycle tests

If cleanup script/function is implemented:

1. Run dry-run mode first.
2. Confirm eligible free drafts older than retention are detected.
3. Confirm public stories are excluded.
4. Confirm active generating/exporting stories are excluded.
5. Confirm audit log or dry-run report is created.
6. Do not run destructive cleanup unless explicitly approved.

