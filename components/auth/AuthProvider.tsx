'use client';

import { createContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useMyStoriesStore } from '@/lib/store/my-stories-store';
import AuthDialog, { type AuthActionResult, type AuthDialogMode } from '@/components/auth/AuthDialog';
import type { User } from '@supabase/supabase-js';
import { getStoryPersistence } from '@/lib/persistence';
import { startNavigationProgress } from '@/lib/navigation/progress';

export interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  openAuthDialog: (mode?: AuthDialogMode, returnTo?: string) => void;
  closeAuthDialog: () => void;
  signInWithGoogle: (returnTo?: string) => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<AuthActionResult>;
  signUpWithPassword: (email: string, password: string) => Promise<AuthActionResult>;
  sendPasswordReset: (email: string) => Promise<AuthActionResult>;
  updatePassword: (password: string) => Promise<AuthActionResult>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  openAuthDialog: () => {},
  closeAuthDialog: () => {},
  signInWithGoogle: async () => {},
  signInWithPassword: async () => ({}),
  signUpWithPassword: async () => ({}),
  sendPasswordReset: async () => ({}),
  updatePassword: async () => ({}),
  signOut: async () => {},
});

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(false);
  const [authDialogMode, setAuthDialogMode] = useState<AuthDialogMode>('sign_in');
  const [pendingReturnTo, setPendingReturnTo] = useState<string | null>(null);
  const activeUserIdRef = useRef<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    const applyUser = (nextUser: User | null) => {
      const previousUserId = activeUserIdRef.current;
      if (previousUserId && previousUserId !== nextUser?.id) {
        void getStoryPersistence().clearUser(previousUserId);
      }
      activeUserIdRef.current = nextUser?.id ?? null;
      setUser(nextUser);
      setIsLoading(false);
      if (nextUser) {
        useMyStoriesStore.getState().hydrateFromCache(nextUser.id);
        useMyStoriesStore.getState().prefetchAll();
      } else {
        // No validated user: drop anything the local session let us paint,
        // including the on-disk copy.
        useMyStoriesStore.getState().clear();
      }
    };

    // Paint the drawer from the last session's cache off the *local* session,
    // which reads from storage — waiting for the validated `getUser()` round
    // trip would put the cached rows on screen after the network answered,
    // which is the delay this cache exists to remove. The validated user
    // arriving below re-keys the cache (and drops it) if it disagrees.
    void supabase.auth.getSession().then(({ data }) => {
      const cachedUserId = data.session?.user?.id;
      if (cachedUserId) useMyStoriesStore.getState().hydrateFromCache(cachedUserId);
    });

    void Promise.all([supabase.auth.getUser(), supabase.auth.getSession()])
      .then(([validated, local]) => {
        const offlineUser = validated.error && !navigator.onLine
          ? local.data.session?.user ?? null
          : null;
        applyUser(validated.data.user ?? offlineUser);
      });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      applyUser(session?.user ?? null);
      if (event === 'SIGNED_IN') {
        useMyStoriesStore.getState().prefetchAll();
      } else if (event === 'SIGNED_OUT') {
        useMyStoriesStore.getState().clear();
        // A full document navigation on purpose, not a client-side push: the story
        // store is a module singleton and the RSC payload cache is in memory, so a
        // SPA navigation would carry signed-in state into the signed-out session.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = '/signed-out';
      }
    });

    const revalidateOnline = () => {
      void supabase.auth.getUser().then(({ data: { user: nextUser } }) => applyUser(nextUser));
    };
    window.addEventListener('online', revalidateOnline);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('online', revalidateOnline);
    };
  }, [supabase.auth]);

  const openAuthDialog = useCallback((mode: AuthDialogMode = 'sign_in', returnTo?: string) => {
    setAuthDialogMode(mode);
    setPendingReturnTo(returnTo ?? `${window.location.pathname}${window.location.search}`);
    setIsAuthDialogOpen(true);
  }, []);

  const closeAuthDialog = useCallback(() => {
    setIsAuthDialogOpen(false);
  }, []);

  const finishAuthFlow = useCallback((returnTo?: string | null) => {
    setIsAuthDialogOpen(false);
    const next = returnTo ?? pendingReturnTo;
    if (!next) return;

    const currentPath = `${window.location.pathname}${window.location.search}`;
    if (next !== currentPath) {
      startNavigationProgress();
      window.location.href = next;
    }
  }, [pendingReturnTo]);

  const signInWithGoogle = useCallback(async (returnTo?: string) => {
    const next = returnTo ?? pendingReturnTo ?? `${window.location.pathname}${window.location.search}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      console.error('Sign-in error:', error.message);
    }
  }, [pendingReturnTo, supabase.auth]);

  const signInWithPassword = useCallback(async (email: string, password: string): Promise<AuthActionResult> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return { error: error.message };
    }

    finishAuthFlow();
    return { message: 'Signed in successfully.' };
  }, [finishAuthFlow, supabase.auth]);

  const signUpWithPassword = useCallback(async (email: string, password: string): Promise<AuthActionResult> => {
    const redirectTo = `${window.location.origin}/`;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectTo },
    });

    if (error) {
      return { error: error.message };
    }

    if (data.session) {
      finishAuthFlow();
      return { message: 'Account created and signed in.' };
    }

    return { message: 'Check your email to confirm your account before signing in.' };
  }, [finishAuthFlow, supabase.auth]);

  const sendPasswordReset = useCallback(async (email: string): Promise<AuthActionResult> => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/update-password`,
    });

    if (error) {
      return { error: error.message };
    }

    return { message: 'Password reset link sent. Check your email.' };
  }, [supabase.auth]);

  const updatePassword = useCallback(async (password: string): Promise<AuthActionResult> => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      return { error: error.message };
    }

    return { message: 'Password updated successfully.' };
  }, [supabase.auth]);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Sign-out error:', error.message);
    }
  }, [supabase.auth]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        openAuthDialog,
        closeAuthDialog,
        signInWithGoogle,
        signInWithPassword,
        signUpWithPassword,
        sendPasswordReset,
        updatePassword,
        signOut,
      }}
    >
      {children}
      <AuthDialog
        key={isAuthDialogOpen ? 'auth-dialog-open' : 'auth-dialog-closed'}
        isOpen={isAuthDialogOpen}
        mode={authDialogMode}
        onModeChange={setAuthDialogMode}
        onClose={closeAuthDialog}
        onGoogleSignIn={async () => {
          await signInWithGoogle();
          return {};
        }}
        onPasswordSignIn={signInWithPassword}
        onPasswordSignUp={signUpWithPassword}
        onPasswordReset={sendPasswordReset}
      />
    </AuthContext.Provider>
  );
}
