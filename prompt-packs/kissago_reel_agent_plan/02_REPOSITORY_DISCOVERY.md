# 02 Repository Discovery

Perform discovery before implementation. Do not modify files until this inspection is complete, except for creating the implementation documentation file if needed.

## Commands to run first

```bash
git status
ls
find . -maxdepth 3 -type f | sed 's#^./##' | sort | head -300
```

Then inspect package and framework setup:

```bash
cat package.json
```

If the project uses Next.js, inspect app/pages routes. If it uses another structure, adapt.

## Discover story creation flows

Search for existing creation methods and related terms:

```bash
rg -n "Seed Story|Prompt Story|seed story|prompt story|creation method|story creation|create story|generate story|storyline|beat" .
```

Identify:

- user-facing creation page(s)
- story generation API route(s)
- story/beat data structures
- payload contracts
- existing advanced settings
- image generation logic
- narration/TTS logic
- published story logic

## Discover admin settings

```bash
rg -n "admin|Admin|settings|global settings|prompt playground|playground|config" .
```

Identify:

- admin settings UI
- settings persistence location
- settings fetch/update APIs
- authorization checks
- global settings schema or table
- any prompt management system

## Discover plans, credits, and rate limiting

```bash
rg -n "plan|subscription|paid|free|credit|coin|rate limit|limit|quota|branding|watermark" .
```

Identify:

- plan model
- user role/account type
- credits/coins logic
- rate limit enforcement points
- branding/export restrictions if any

## Discover storage and assets

```bash
rg -n "storage|bucket|upload|download|getPublicUrl|signedUrl|asset|image|audio|cover|thumbnail|mp4|video" .
```

Identify:

- storage utility files
- bucket names
- asset tables or references
- delete logic
- public/private URL handling
- image compression or optimization if present
- R2 integration if present

## Discover export/video support

```bash
rg -n "export|render|video|mp4|ffmpeg|remotion|canvas|download|subtitle|srt|webm" .
```

Identify:

- whether MP4 export exists
- whether rendering is client-side or server-side
- existing export queues/status fields
- download buttons/components
- media composition logic

## Discovery output requirement

Update `docs/reel-story-generator-implementation.md` with:

- exact files inspected
- existing flows found
- existing tables/settings inferred from code
- safe extension points
- risks and unknowns
- implementation approach chosen

