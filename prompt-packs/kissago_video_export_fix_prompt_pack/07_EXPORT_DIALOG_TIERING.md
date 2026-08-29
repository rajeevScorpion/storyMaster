# Export Dialog and Tiering

Goal: The user-facing export dialog should offer SD and HD downloads, with availability controlled by admin tier settings.

## Export dialog requirements

The export dialog should show available export options clearly.

Example:

```txt
Download Video

[Standard / SD]
720x1280 · 30 fps
Fast and mobile-friendly
Available on your plan

[HD]
1080x1920 · 30 fps
Sharper export for sharing and publishing
Locked / Upgrade required OR Available depending on tier
```

Do not expose too many technical settings to normal users.

## Tier logic

Admin should be able to configure which tiers can use which preset.

Example mapping:

```json
{
  "free": ["sd"],
  "starter": ["sd"],
  "pro": ["sd", "hd"],
  "premium": ["sd", "hd", "ultraSmoothExperimental"]
}
```

Use actual tier names from the existing product. Do not invent final tier names if the product already has a tier system.

## Admin-configurable preset availability

Each preset should include something like:

```ts
type ExportPreset = {
  id: string;
  label: string;
  description: string;
  width: number;
  height: number;
  fps: 24 | 30 | 60;
  videoBitrate: number;
  audioBitrate: number;
  audioSampleRate: number;
  enabled: boolean;
  allowedTiers: string[];
  sortOrder: number;
  isExperimental?: boolean;
  adminOnly?: boolean;
};
```

Use the existing auth/subscription/coin/tier system if present.

## User experience rules

- If HD is not allowed for the user tier, show it as locked only if this matches existing product UX.
- Provide clear message: "HD export is available on Pro plan" or equivalent.
- Do not allow client-side bypass by changing local config.
- Final export request should be validated against tier on the server/config authority if applicable.
- If exports consume coins/credits, show coin cost clearly before export starts.
- If export fails due to device limitations, show a useful fallback: "Try Standard export".

## Safety for mobile

For mobile devices:

- SD should remain the safest default.
- HD can be offered if tier allows, but show a heavier-processing note if needed.
- Experimental 60 fps should be hidden unless admin enables it.

## Acceptance

- User sees SD and HD options.
- Options reflect admin configuration.
- Tier gating works.
- Locked options do not start export.
- Allowed options export using the correct preset.
- Export report confirms selected preset was used.
