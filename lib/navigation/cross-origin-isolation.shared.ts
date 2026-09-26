/**
 * Every route is served with COOP/COEP so ffmpeg.wasm video export gets SharedArrayBuffer, except the wallet.
 * Under COEP, Chrome and Firefox refuse cross-origin frames that don't opt in, and Razorpay Checkout's frame
 * doesn't. Keep the header rule in next.config.ts matching this.
 */
export function isCrossOriginIsolationExemptPath(pathname: string): boolean {
  return pathname === '/wallet' || pathname.startsWith('/wallet/');
}

/**
 * Headers belong to the document, so a client-side navigation across the wallet boundary keeps the wrong ones:
 * the wallet stays isolated (checkout blocked) or the rest of the app stays unisolated (export fails).
 * A reload fixes it. Loop-safe: after the reload the document path and the route agree.
 */
export function shouldReloadAcrossIsolationBoundary(input: {
  documentPath: string;
  routePath: string;
  crossOriginIsolated: boolean;
}): boolean {
  const documentExempt = isCrossOriginIsolationExemptPath(input.documentPath);
  const routeExempt = isCrossOriginIsolationExemptPath(input.routePath);
  if (documentExempt === routeExempt) return false;

  // Entering the wallet: only when isolation actually took hold. Browsers without credentialless COEP never
  // isolate, and checkout already works there.
  if (routeExempt) return input.crossOriginIsolated;

  return true;
}
