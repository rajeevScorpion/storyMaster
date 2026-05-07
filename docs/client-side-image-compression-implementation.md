# Client-Side Image Compression Implementation

## Current Upload Flow Summary
- Prompt-only storyboard/beat uploads are selected in `StoryScreen`, validated in the browser, converted to a data URL, then passed into the story store.
- Character reference sheets follow the same `StoryScreen` data URL path with separate square-image validation.
- Storyline share, YouTube, and reel cover uploads are selected in `StorylineCoverEditorForm`, converted to data URLs, submitted to server actions, processed with Sharp, and uploaded to `public-storylines`.
- Supabase upload logic lives in `lib/supabase/storage.ts`; no general storage-provider abstraction exists yet.

## New Compressed Upload Flow
- User selects a JPG, PNG, or WebP image.
- Client validates raw MIME type and raw selected file size.
- If compression is enabled, the browser inspects dimensions, skips already-optimized WebP files when safe, otherwise resizes and encodes WebP with Canvas.
- The UI previews an object URL where possible; data URLs remain only where the current store/server action contract requires them.
- The optimized file/data URL is passed to the existing upload path. Supabase receives the optimized asset today; the compression result is provider-neutral for future R2.

## Files Changed
- Added `lib/media/imageUploadOptimization.ts` for shared settings, asset types, metadata, defaults, and formatting.
- Added `lib/media/clientImageCompression.ts` for browser-side decoding, resizing, WebP encoding, skip logic, fallback handling, and object URL cleanup.
- Updated `components/story/StoryScreen.tsx` for prompt-only beat/storyboard and character reference uploads.
- Updated `components/story/StorylineCoverEditorForm.tsx` for social/share, YouTube, and reel cover uploads.
- Updated `lib/supabase/storage.ts` so storage uploads can accept data URLs or provider-neutral `Blob/File` bodies.
- Added admin settings through `app/actions/admin.ts`, `components/admin/GlobalSettings.tsx`, `app/admin/settings/media/page.tsx`, and migration `044_client_side_image_compression_settings.sql`.

## Compression Approach
- Uses browser APIs only: `createImageBitmap` where available, `Image` fallback, Canvas `toBlob('image/webp')`, and explicit timeouts.
- No new package was added. This keeps bundle and dependency risk lower, and avoids coupling upload optimization to Supabase.
- Character references use quality `0.9`, preserve aspect ratio, never crop, and resize only when larger than `maxCharacterRefDimension`.
- Social cover uploads may still be normalized server-side with Sharp; server WebP quality is kept high to reduce visible double-compression artifacts.

## Settings Added
- Master rollback: `clientSideCompressionEnabled`.
- Per-asset toggles for beat/storyboard, cover, social cover, and character reference uploads.
- WebP quality, character reference quality, landscape/vertical max dimensions, character reference max dimension, raw selected file limit, final upload limit, stats visibility, and fallback-original behavior.
- Settings are seeded in `feature_flags` and exposed in Admin > Settings > Image uploads.

## Fallback Behavior
- If compression succeeds, the optimized WebP is uploaded with WebP MIME data and `.webp` paths where possible.
- If an input WebP is already within size and dimension limits, recompression is skipped.
- If compression fails and the original is within the final upload limit, upload can continue with a non-blocking warning.
- If compression fails on an oversized image, upload is blocked with low-memory/mobile guidance.
- If optimized output is still above the final limit, upload is blocked with a clear message.

## Mobile Memory Safety
- Current upload UI processes one selected image at a time.
- The compression helper releases image bitmaps, canvas dimensions, and object URLs after use.
- Multi-image picker support should process files sequentially if introduced later.
- Remaining data URLs are a transitional compatibility layer for the current story store and server action payloads.

## Basic Metadata
- Gallery entries can carry lightweight `optimizationMetadata` where existing JSON structures allow it.
- Captured fields include original size, optimized size, output MIME type, quality, asset type, compression applied/skipped state, and failure reason when available.
- No large asset metadata migration was added.

## R2 Preparation
- Compression helpers do not import Supabase or assume bucket/path behavior.
- The helper returns provider-neutral `File`/metadata output that can be sent to Supabase now or R2 later.
- Future media metadata should include `storage_provider`, `bucket`, `object_key`, `public_url`, `cache_control`, and `is_public`.

## Testing Checklist
- Upload 2 MB JPG storyboard image; confirm WebP conversion, upload, and display.
- Upload 4.5 MB PNG storyboard image; confirm significant compression and display.
- Upload 7-10 MB raw image; confirm it is not rejected before compression and uploads if optimized under 5 MB.
- Try a very large mobile image; confirm graceful failure.
- Upload character reference; confirm higher quality and no crop.
- Upload already optimized WebP; confirm recompression is skipped when safe.
- Simulate compression failure; confirm fallback original under limit and block above limit.
- Confirm compressed upload MIME/extension, existing story loading, Supabase uploads, private signed URLs, publish flow, and social cover management.

## Verification Run
- `npm run lint` passed.
- `npm run build` passed.
- Manual browser/device upload tests are still required on staging/local with real files.

## Known Limitations
- Existing store and server action contracts still require data URLs in some places. This is intentionally documented as transitional until the R2/media abstraction lands.
- Browser WebP Canvas encoding depends on device/browser support and available memory.
- Upload metadata is stored opportunistically in existing JSON shapes, not in a dedicated media asset table.
