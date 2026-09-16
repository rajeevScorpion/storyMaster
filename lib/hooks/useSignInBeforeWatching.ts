'use client';

import { useCallback } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';

/**
 * Gate for the gallery's story-opening links. A signed-out visitor must not see
 * the open-flow loader at all -- sign-in is asked for immediately, before the
 * link is allowed to navigate.
 */
export function useSignInBeforeWatching() {
  const { user, isLoading, openAuthDialog } = useAuth();

  return useCallback((event: React.MouseEvent, href: string): boolean => {
    if (isLoading || user) return false;
    // A modifier/middle click means "open in a new tab" -- let the browser do
    // that and land on the preview, which auto-opens the dialog on its own.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;

    event.preventDefault();
    openAuthDialog('sign_in', href);
    return true;
  }, [user, isLoading, openAuthDialog]);
}
