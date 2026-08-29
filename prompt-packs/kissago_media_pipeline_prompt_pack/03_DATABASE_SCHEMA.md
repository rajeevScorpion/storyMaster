# 03 — Database Schema Guidance

Adapt names to the existing ORM/schema conventions. Do not blindly create duplicate tables if equivalents exist.

## Story fields

Add or confirm:

```ts
Story {
  id
  userId
  title
  slug
  status: 'draft' | 'processing' | 'ready' | 'partially_ready' | 'failed' | 'published'
  visibility: 'private' | 'public' | 'unlisted'
  publishedAt?: Date
  unpublishedAt?: Date
  publicShareToken?: string
  allowPublicIndexing: boolean
  preferredPublishQuality?: 'standard' | 'high'
  createdAt
  updatedAt
}
```

## StoryMedia table

```ts
StoryMedia {
  id
  storyId
  userId
  generationJobId?
  sequenceNo

  originalKey?
  displayKey?
  thumbnailKey?
  shareLowKey?
  shareHighKey?

  originalMimeType?
  displayMimeType?
  width?
  height?
  originalBytes?
  displayBytes?
  thumbnailBytes?

  status: 'queued' | 'generating' | 'original_saved' | 'compressing' | 'ready' | 'failed' | 'expired_original'
  compressionStatus: 'pending' | 'processing' | 'complete' | 'failed'

  originalExpiresAt?
  hqDownloadAllowedUntil?
  hqShareAllowedUntil?

  errorCode?
  errorMessage?
  retryCount

  createdAt
  updatedAt
}
```

## GenerationJob table

```ts
GenerationJob {
  id
  userId
  storyId
  mediaId?
  type: 'story_image' | 'cover_image' | 'regeneration'
  status: 'queued' | 'generating' | 'saving_original' | 'compressing' | 'ready' | 'failed' | 'cancelled'

  provider
  model
  promptHash?
  requestPayloadJson
  providerResponseJson?

  attemptCount
  maxAttempts
  lastErrorCode?
  lastErrorMessage?

  startedAt?
  completedAt?
  failedAt?
  createdAt
  updatedAt
}
```

## Admin media settings

Use existing admin settings system if present.

```ts
MediaSettings {
  id
  serverSideMediaPipelineEnabled: boolean
  freeOriginalRetentionHours: number // default 24 or 0 after safe rollout
  plusOriginalRetentionDays: number // default 10
  studioOriginalRetentionDays: number // default 30
  displayMaxWidth: number // default 1440
  thumbnailMaxWidth: number // default 512
  displayWebpQuality: number // default 82
  thumbnailWebpQuality: number // default 75
  shareLowMaxWidth: number // default 1440
  shareHighMaxWidth: number // default original width or capped
  shareHighQuality: number // default 92
  cleanupJobEnabled: boolean
  publicPublishingEnabled: boolean
  unlistedSharingEnabled: boolean
  moderationRequiredForPublic: boolean
  allowFreePublicPublishing: boolean
  allowPlusHighQualityShare: boolean
  allowStudioHighQualityShare: boolean
  createdAt
  updatedAt
}
```

## Migration rules

- Migrations must be backward compatible.
- Existing stories should default to `private` unless current behavior requires otherwise.
- Existing media should be marked `ready` if display URLs already exist.
- Use nullable fields during rollout to avoid breaking existing records.
- Add indexes for `storyId`, `userId`, `status`, `visibility`, `originalExpiresAt`.


## Processing mode fields for safe rollout

Add these fields wherever they best fit the existing schema. Do not duplicate if equivalent fields already exist.

```text
generation_jobs
- processing_mode: client_legacy | server_pipeline | hybrid_canary
- requested_processing_mode: nullable, admin setting at time of request
- effective_processing_mode: nullable, actual mode used after routing/fallback
- fallback_from_job_id: nullable, if a failed server job was intentionally retried through legacy path
```

```text
story_media
- processing_mode: client_legacy | server_pipeline | imported | unknown
- source_flow: generated | uploaded_reference | migrated
- legacy_cloud_save_url: nullable, for existing/current client-side saved assets
- original_r2_key: nullable
- display_r2_key: nullable
- thumbnail_r2_key: nullable
- share_low_key: nullable
- share_high_key: nullable
```

Rules:
- Never assume all media has R2 keys during rollout.
- Rendering must support legacy URLs and new R2 keys.
- New server-generated assets should prefer R2 keys.
- Existing legacy assets should continue to load from their current saved location until a deliberate migration is built.
