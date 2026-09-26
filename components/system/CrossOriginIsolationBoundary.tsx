'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { shouldReloadAcrossIsolationBoundary } from '@/lib/navigation/cross-origin-isolation.shared';

/**
 * Reloads when a client-side navigation crosses into or out of the wallet, the one route served without
 * COOP/COEP. Story surfaces open the wallet in a new tab instead, so an in-memory story session never meets
 * this reload.
 */
export default function CrossOriginIsolationBoundary() {
  const pathname = usePathname();
  const documentPathRef = useRef<string | null>(null);

  useEffect(() => {
    // The root layout never remounts, so the first run sees the path this document was loaded at.
    documentPathRef.current ??= window.location.pathname;
    if (!pathname) return;

    if (
      shouldReloadAcrossIsolationBoundary({
        documentPath: documentPathRef.current,
        routePath: pathname,
        crossOriginIsolated: window.crossOriginIsolated,
      })
    ) {
      window.location.reload();
    }
  }, [pathname]);

  return null;
}
