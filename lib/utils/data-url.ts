/**
 * Split a base64 data URL into its mime type and payload WITHOUT running a
 * greedy regex over the (potentially multi-megabyte) payload.
 *
 * A pattern like `/^data:([^;]+);base64,(.+)$/` looks innocent but the `(.+)$`
 * capture backtracks on V8's regex stack; matched against a large string (e.g. a
 * full-resolution base64 PNG returned by OpenAI's image API) it throws
 * `RangeError: Maximum call stack size exceeded`. Splitting on the first comma
 * and only regex-matching the small header avoids the payload entirely.
 *
 * Dependency-free and directive-free so it is safe to import from both server
 * (`'use server'`) and client (`'use client'`) modules.
 */
export function splitBase64DataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) return null;
  const header = dataUrl.slice(0, commaIndex);
  const headerMatch = /^data:([^;]+);base64$/.exec(header);
  if (!headerMatch) return null;
  return { mimeType: headerMatch[1], base64: dataUrl.slice(commaIndex + 1) };
}
