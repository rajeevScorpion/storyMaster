# 01 — Investigation Prompt

Before implementation, inspect the codebase. Do not write feature code yet.

## Questions to answer from code inspection

### App stack
- What framework is used?
- What runtime is used for API routes/server logic?
- Is there a separate worker process?
- Is there a queue system already?
- What database and ORM are used?
- How are migrations handled?

### Auth and tiers
- Where is the authenticated user read?
- Where are plans/tier/role/coin balances stored?
- How are admin settings stored?
- Is there already an admin panel?

### Existing generation flow
- Where does story generation start?
- Where are image model calls made?
- Are generated images returned to the client as URLs, blobs, base64, or remote provider URLs?
- Does the server currently download generated images?
- Does the client currently compress images?
- Where are current save failures/timeouts happening?

### Current media storage
- Is Cloudflare R2 already configured?
- Are public/private buckets used?
- Are R2 credentials stored in env variables?
- Are media URLs persisted in DB?
- Is any CDN/custom domain configured?

### Story publishing
- Is there an existing story visibility field?
- Are story routes public/private?
- Is there gallery/discovery?
- Is there moderation/reporting?

## Output required before implementation

Create an `INVESTIGATION_REPORT.md` in the repository with:

```md
# Kissago Media Pipeline Investigation Report

## Current Stack

## Current Generation Flow

## Current Storage Flow

## Current Client-Side Compression Logic

## Current Story Visibility Flow

## Relevant Files

## Existing Constraints

## Risks

## Recommended Implementation Plan

## Clarifying Questions, if required
```

Only proceed to implementation after this report is complete.
