# 03 Product and UX Requirements

## Product direction

Add a new creation mode for Kissago called **Reel Story** or **Visual Reel**.

The mode should help users create short vertical emotionally expressive videos from text ideas. It should support still images changing every 2 to 3 seconds, narration, optional subtitles, branding, and export/download.

This is not a generic AI video editor. It is a mobile-first emotional storytelling layer for Gen Z and social sharing.

## Entry point

Place the new method beside existing creation methods such as Prompt Story and Seed Story.

Do not remove or alter existing methods.

## Default user settings

Default values:

- Orientation: 9:16
- Input mode: without uploaded image
- Script length: Medium, unless an admin default says otherwise
- Mood preset: admin default active preset
- Branding: on by default
- Image rhythm: controlled by admin, not user

## User-facing controls

Expose only simple controls:

1. Main prompt: “What do you want to express?” or similar.
2. Mood preset selector.
3. Script length: Short, Medium, Long.
4. Narration style selector.
5. Visual style selector.
6. Branding toggle only if the user plan and admin settings allow branding removal.

Do not expose:

- number of images per beat
- storyboard grid size
- panel resolution
- internal prompt definer text
- model provider details
- storage policy internals except user-facing expiry notices

## Script length

Users see only:

- Short
- Medium
- Long

Admin controls the actual word count ranges behind these options.

Example defaults, adjustable by admin:

- Short: 25 to 40 words per beat
- Medium: 45 to 70 words per beat
- Long: 80 to 120 words per beat

## Mood presets

Mood presets are bundles, not just labels. A preset can imply:

- narration style
- visual style
- emotional tone
- color mood
- pacing
- subtitle style
- transition rhythm
- script density

Seed suggested presets if the codebase supports seeding:

- Midnight Memories
- Soft Hope
- Broken but Beautiful
- Dreamlike Childhood
- Quiet Motivation
- Dark Academia Reflection
- Mythic Vision
- Lo-fi Nostalgia
- Spiritual Morning
- Cinematic Sadness

If seeding is not immediately practical, create the admin-ready structure and document the seed data.

## Mobile-first preview

The creation and preview experience must be usable on mobile.

Show progress states like:

- Writing your reel script
- Designing visual rhythm
- Creating images
- Generating narration
- Preparing video
- Ready to download

Show friendly metadata:

- estimated duration
- number of visuals
- branding status
- export/download readiness
- expiry notice for free/private/unpublished stories where relevant

