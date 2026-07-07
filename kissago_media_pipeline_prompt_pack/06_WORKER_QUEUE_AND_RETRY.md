# 06 — Worker, Queue, Retry, and Idempotency

Use the existing queue/worker system if present. If none exists and the stack is Cloudflare-native, consider Cloudflare Queues. If the app is hosted elsewhere, use the platform's queue/worker equivalent.

## Queue message payload

Keep queue messages small. Store heavy request data in DB.

```json
{
  "jobId": "job_123",
  "storyId": "story_123",
  "mediaId": "media_123",
  "type": "story_image"
}
```

## Idempotency rules

A worker may receive the same message more than once. Therefore:
- Always load job from DB.
- If job is already `ready`, acknowledge and exit.
- If original already exists, do not regenerate unless explicitly requested.
- If display variant already exists, do not recreate unless missing/invalid.
- Use deterministic R2 keys based on storyId/mediaId/jobId and variant.

## Suggested worker steps

```ts
async function processGenerationJob(message) {
  const job = await db.generationJob.findUnique(message.jobId)
  if (!job || job.status === 'ready') return

  await markJobGenerating(job.id)

  const generated = await callImageProvider(job.requestPayloadJson)

  await markSavingOriginal(job.id)
  const originalBuffer = await fetchGeneratedImageServerSide(generated)
  const originalKey = getOriginalKey(job)
  await r2Put(originalKey, originalBuffer, metadata)

  await markOriginalSaved(job.id, originalKey)

  await markCompressing(job.id)
  const variants = await createVariants(originalBuffer)
  await uploadVariants(variants)

  await markReady(job.id, variants)
}
```

## Retry policy

Retry transient failures:
- provider timeout
- provider rate limit
- network fetch failure
- R2 upload failure
- compression worker crash

Do not retry indefinitely for terminal failures:
- unsafe content response
- invalid prompt payload
- unsupported model
- user/job deleted
- quota exhausted after job creation, if applicable

## Dead-letter behavior

After max retries:
- mark job `failed`
- preserve error code
- show user a friendly retry/regenerate option
- alert admin/developer if failure rate crosses threshold

## User-facing failure messages

Do not expose raw provider errors.

Examples:
- “Image generation failed. Please try again.”
- “The image was generated but optimization failed. We are retrying.”
- “High-quality export is temporarily unavailable. Standard quality is ready.”
