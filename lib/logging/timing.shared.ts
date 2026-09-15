// Shared, isomorphic body for the timing helpers scattered across the server surface
// (lib/ai/text-gateway/router.ts's logTiming, lib/ai/beat-orchestration.ts's
// timeRuntimeStep, app/actions/narration.ts's timeNarrationStep,
// lib/pricing/enforcement.ts's timeEnforcementStep, app/actions/gemini-proxy.ts's
// timeGeminiStep). They used to be five copy-pasted console.info calls, always on,
// flooding the dev terminal with a line per AI call.
//
// Routine timing is dev-only noise and stays silent unless explicitly asked for.
// A failed step (`meta.success === false`) is a real signal, not spam, so it always
// logs regardless of the flag.
//
// Pure and isomorphic on purpose: no `server-only`, no Node APIs. `NEXT_PUBLIC_LOG_TIMING`
// is read as the exact literal expression below -- no destructuring, no dynamic key --
// so Next.js can statically inline it into the browser bundle the same way it inlines
// every other NEXT_PUBLIC_* value.
export function logTiming(scope: string, meta: Record<string, unknown>): void {
  if (meta.success === false) {
    console.warn(`[timing:${scope}]`, meta);
    return;
  }
  if (process.env.NEXT_PUBLIC_LOG_TIMING === '1') {
    console.info(`[timing:${scope}]`, meta);
  }
}
