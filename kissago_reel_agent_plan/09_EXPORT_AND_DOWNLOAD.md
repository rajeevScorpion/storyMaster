# 09 Export and Download

The Reel Story layer should allow users to create and download vertical videos for social media.

## First inspect export support

Before implementing, inspect whether the app already has:

- MP4 rendering
- client-side video generation
- server-side rendering
- export queues
- download buttons
- storage bucket for exports
- subtitle rendering
- audio mixing

Do not add heavy dependencies like ffmpeg, Remotion, or canvas video libraries without assessing current architecture and documenting the tradeoff.

## If export infrastructure exists

Integrate Reel Story into it.

Output should include:

- 9:16 vertical format
- still images changing every 2 to 3 seconds
- subtle zoom/pan if feasible
- narration audio if available
- subtitles if supported
- branding watermark/outro according to plan rules
- final MP4 stored and reused

## If export infrastructure does not exist

Implement safe foundation only:

- export status field
- preview timeline
- placeholder export button/state
- documentation of required rendering step
- TODO in implementation docs, not risky broken code

Possible status values:

- `not_started`
- `queued`
- `rendering`
- `completed`
- `failed`

## Reuse existing exports

If a completed export exists and story settings have not changed:

- serve existing MP4
- do not regenerate unnecessarily

If the user changes script, visuals, narration, branding, or style:

- mark export stale if architecture supports it
- require re-export

## User experience

Show:

- preview
- estimated duration
- number of images
- export status
- download button when ready
- retry export if failed

Do not block user from leaving page if status is saved and recoverable.

