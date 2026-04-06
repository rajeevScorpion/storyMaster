'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { KeyRound, LogIn, Mail, Sparkles, UserPlus, X } from 'lucide-react';

export type AuthDialogMode = 'sign_in' | 'sign_up' | 'reset_password';

export interface AuthActionResult {
  error?: string;
  message?: string;
}

interface AuthDialogProps {
  isOpen: boolean;
  mode: AuthDialogMode;
  onModeChange: (mode: AuthDialogMode) => void;
  onClose: () => void;
  onGoogleSignIn: () => Promise<AuthActionResult>;
  onPasswordSignIn: (email: string, password: string) => Promise<AuthActionResult>;
  onPasswordSignUp: (email: string, password: string) => Promise<AuthActionResult>;
  onPasswordReset: (email: string) => Promise<AuthActionResult>;
}

export default function AuthDialog({
  isOpen,
  mode,
  onModeChange,
  onClose,
  onGoogleSignIn,
  onPasswordSignIn,
  onPasswordSignUp,
  onPasswordReset,
}: AuthDialogProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [feedback, setFeedback] = useState<AuthActionResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetTransientState = useCallback(() => {
    setPassword('');
    setConfirmPassword('');
    setFeedback(null);
    setIsSubmitting(false);
  }, []);

  const handleClose = useCallback(() => {
    resetTransientState();
    onClose();
  }, [onClose, resetTransientState]);

  const handleModeChange = useCallback((nextMode: AuthDialogMode) => {
    resetTransientState();
    onModeChange(nextMode);
  }, [onModeChange, resetTransientState]);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        handleClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleClose, isOpen]);

  const header = useMemo(() => {
    if (mode === 'sign_up') {
      return {
        title: 'Create your account',
        subtitle: 'Save stories, come back later, and keep making magic together.',
      };
    }

    if (mode === 'reset_password') {
      return {
        title: 'Reset your password',
        subtitle: 'We will send you a secure link so you can set a new password.',
      };
    }

    return {
      title: 'Welcome back',
      subtitle: 'Sign in to continue your stories or begin a new one.',
    };
  }, [mode]);

  const submitLabel =
    mode === 'sign_up'
      ? 'Create account'
      : mode === 'reset_password'
      ? 'Send reset link'
      : 'Sign in';

  const handleGoogle = async () => {
    setIsSubmitting(true);
    setFeedback(null);
    const result = await onGoogleSignIn();
    setFeedback(result.error ? result : null);
    setIsSubmitting(false);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);

    if (!email.trim()) {
      setFeedback({ error: 'Enter your email address.' });
      return;
    }

    if (mode !== 'reset_password') {
      if (password.length < 8) {
        setFeedback({ error: 'Use at least 8 characters for your password.' });
        return;
      }

      if (mode === 'sign_up' && password !== confirmPassword) {
        setFeedback({ error: 'Passwords do not match.' });
        return;
      }
    }

    setIsSubmitting(true);

    let result: AuthActionResult;
    if (mode === 'sign_up') {
      result = await onPasswordSignUp(email.trim(), password);
    } else if (mode === 'reset_password') {
      result = await onPasswordReset(email.trim());
    } else {
      result = await onPasswordSignIn(email.trim(), password);
    }

    setFeedback(result);
    setIsSubmitting(false);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-4 backdrop-blur-md"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950/95 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute -top-20 left-10 h-44 w-44 rounded-full bg-emerald-500/10 blur-3xl" />
              <div className="absolute bottom-0 right-0 h-40 w-40 rounded-full bg-indigo-500/10 blur-3xl" />
            </div>

            <div className="relative space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <p className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-emerald-300">
                    <Sparkles className="h-3.5 w-3.5" />
                    Kissago
                  </p>
                  <div className="space-y-1">
                    <h2 className="text-2xl font-serif text-neutral-100">{header.title}</h2>
                    <p className="text-sm leading-relaxed text-neutral-400">{header.subtitle}</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-full border border-white/10 bg-white/5 p-2 text-neutral-400 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-neutral-100"
                  aria-label="Close authentication dialog"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="inline-flex rounded-2xl border border-white/10 bg-white/5 p-1">
                <button
                  type="button"
                  onClick={() => handleModeChange('sign_in')}
                  className={`rounded-xl px-4 py-2 text-sm transition-colors ${
                    mode === 'sign_in'
                      ? 'bg-white text-neutral-950'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => handleModeChange('sign_up')}
                  className={`rounded-xl px-4 py-2 text-sm transition-colors ${
                    mode === 'sign_up'
                      ? 'bg-white text-neutral-950'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  Create account
                </button>
              </div>

              {mode !== 'reset_password' && (
                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={isSubmitting}
                  className="flex w-full items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-sm font-medium text-neutral-200 transition-all hover:border-emerald-500/30 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <LogIn className="h-4 w-4" />
                  Continue with Google
                </button>
              )}

              {mode !== 'reset_password' && (
                <div className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-neutral-500">
                  <div className="h-px flex-1 bg-white/10" />
                  <span>Or use email</span>
                  <div className="h-px flex-1 bg-white/10" />
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.16em] text-neutral-500" htmlFor="auth-email">
                    Email
                  </label>
                  <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <Mail className="h-4 w-4 text-neutral-500" />
                    <input
                      id="auth-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="w-full bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
                      placeholder="you@example.com"
                      disabled={isSubmitting}
                    />
                  </div>
                </div>

                {mode !== 'reset_password' && (
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-[0.16em] text-neutral-500" htmlFor="auth-password">
                      Password
                    </label>
                    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                      <KeyRound className="h-4 w-4 text-neutral-500" />
                      <input
                        id="auth-password"
                        type="password"
                        autoComplete={mode === 'sign_up' ? 'new-password' : 'current-password'}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="w-full bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
                        placeholder="At least 8 characters"
                        disabled={isSubmitting}
                      />
                    </div>
                  </div>
                )}

                {mode === 'sign_up' && (
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-[0.16em] text-neutral-500" htmlFor="auth-confirm-password">
                      Confirm password
                    </label>
                    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                      <UserPlus className="h-4 w-4 text-neutral-500" />
                      <input
                        id="auth-confirm-password"
                        type="password"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        className="w-full bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
                        placeholder="Repeat your password"
                        disabled={isSubmitting}
                      />
                    </div>
                  </div>
                )}

                {feedback && (
                  <div
                    className={`rounded-2xl border px-4 py-3 text-sm ${
                      feedback.error
                        ? 'border-red-500/30 bg-red-500/10 text-red-200'
                        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                    }`}
                  >
                    {feedback.error ?? feedback.message}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full rounded-2xl bg-white px-4 py-3.5 text-sm font-semibold text-neutral-950 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? 'Please wait...' : submitLabel}
                </button>
              </form>

              <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-neutral-400">
                {mode === 'reset_password' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleModeChange('sign_in')}
                      className="transition-colors hover:text-neutral-200"
                    >
                      Back to sign in
                    </button>
                    <button
                      type="button"
                      onClick={() => handleModeChange('sign_up')}
                      className="transition-colors hover:text-neutral-200"
                    >
                      Need an account?
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => handleModeChange(mode === 'sign_in' ? 'sign_up' : 'sign_in')}
                      className="transition-colors hover:text-neutral-200"
                    >
                      {mode === 'sign_in' ? 'Create account instead' : 'Already have an account?'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleModeChange('reset_password')}
                      className="transition-colors hover:text-neutral-200"
                    >
                      Forgot password?
                    </button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
