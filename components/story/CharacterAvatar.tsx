'use client';

import { useState, type ReactNode } from 'react';

export interface CharacterAvatarProps {
  /** Portrait or reference-sheet URL; may be null/undefined or a stale/pruned link. */
  src?: string | null;
  alt: string;
  /** Classes applied to the rendered <img>. */
  imgClassName: string;
  /** Rendered when there is no src or the image fails to load (e.g. expired signed URL). */
  fallback: ReactNode;
}

/**
 * Shared library-character image with graceful degradation: a signed URL that
 * 404s (pruned or expired storage object) swaps to the caller's fallback icon
 * instead of showing a broken image. Used by the drawer card, the detail
 * dialog, and the landing "Bring your characters" chips.
 */
export default function CharacterAvatar({ src, alt, imgClassName, fallback }: CharacterAvatarProps) {
  const [errored, setErrored] = useState(false);
  // Reset the error state during render when the source changes (e.g. a
  // repaired thumbnail lands), the recommended alternative to a reset effect.
  const [lastSrc, setLastSrc] = useState(src);
  if (src !== lastSrc) {
    setLastSrc(src);
    setErrored(false);
  }

  if (!src || errored) {
    return <>{fallback}</>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={imgClassName} onError={() => setErrored(true)} />
  );
}
