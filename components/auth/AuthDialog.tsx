'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { KeyRound, Loader2, Mail, Sparkles, UserPlus, X } from 'lucide-react';

import Checkbox from '@/components/ui/Checkbox';
import Modal from '@/components/ui/Modal';
import LegalDocumentModal from '@/components/legal/LegalDocumentModal';

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

const TABS: { mode: AuthDialogMode; label: string }[] = [
  { mode: 'sign_in', label: 'Sign in' },
  { mode: 'sign_up', label: 'Create account' },
];

/** Official four-colour Google "G" mark, inline rather than a `public/` asset — Next's image optimizer refuses local SVGs without `dangerouslyAllowSVG`, and this keeps it consistent with the lucide icons used inline throughout this file. */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.8741 2.6836-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.4673-.8064 5.9564-2.1809l-2.9087-2.2581c-.8064.54-1.8368.8591-3.0477.8591-2.3436 0-4.3282-1.5827-5.0359-3.7104H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z"/>
      <path fill="#FBBC05" d="M3.9641 10.71c-.18-.54-.2823-1.1168-.2823-1.71s.1023-1.17.2823-1.71V4.9582H.9573C.3477 6.1732 0 7.5477 0 9s.3477 2.8268.9573 4.0418L3.9641 10.71z"/>
      <path fill="#EA4335" d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.3459l2.5813-2.5814C13.4632.8918 11.4259 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.9641 7.29C4.6718 5.1623 6.6564 3.5795 9 3.5795z"/>
    </svg>
  );
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
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [acceptanceError, setAcceptanceError] = useState<string | null>(null);
  const [openLegalDoc, setOpenLegalDoc] = useState<'terms' | 'privacy_policy' | null>(null);
  const [feedback, setFeedback] = useState<AuthActionResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const tabRefs = useRef<Record<AuthDialogMode, HTMLButtonElement | null>>({
    sign_in: null,
    sign_up: null,
    reset_password: null,
  });

  const resetTransientState = useCallback(() => {
    setPassword('');
    setConfirmPassword('');
    setAgreedToTerms(false);
    setAcceptanceError(null);
    setFeedback(null);
    setIsSubmitting(false);
  }, []);

  const handleClose = useCallback(() => {
    resetTransientState();
    onClose();
  }, [onClose, resetTransientState]);

  const handleModeChange = useCallback(
    (nextMode: AuthDialogMode) => {
      resetTransientState();
      onModeChange(nextMode);
    },
    [onModeChange, resetTransientState]
  );

  const handleTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const currentIndex = TABS.findIndex((tab) => tab.mode === mode);
      const nextIndex = event.key === 'ArrowRight'
        ? (currentIndex + 1) % TABS.length
        : (currentIndex - 1 + TABS.length) % TABS.length;
      const nextTab = TABS[nextIndex];
      handleModeChange(nextTab.mode);
      tabRefs.current[nextTab.mode]?.focus();
    },
    [mode, handleModeChange]
  );

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
    setAcceptanceError(null);

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

      if (mode === 'sign_up' && !agreedToTerms) {
        setAcceptanceError('Please agree to the Terms & EULA before creating your account.');
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
    <>
      <Modal isOpen={isOpen} onClose={handleClose} ariaLabel={header.title} showCloseButton={false}>
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]">
          <div className="absolute -top-20 left-10 h-44 w-44 rounded-full bg-emerald-500/10 blur-3xl" />
          <div className="absolute bottom-0 right-0 h-40 w-40 rounded-full bg-indigo-500/10 blur-3xl" />
          <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/[0.06] to-transparent" />
          {!prefersReducedMotion && (
            <motion.div
              className="absolute -inset-1 rounded-[28px]"
              style={{
                background:
                  'radial-gradient(60% 60% at 20% 0%, rgba(52,211,153,0.16), transparent 70%), radial-gradient(50% 50% at 100% 100%, rgba(99,102,241,0.14), transparent 70%)',
              }}
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
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
              className="rounded-full border border-white/10 bg-white/5 p-2 text-neutral-400 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-neutral-100 focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgba(52,211,153,0.5)]"
              aria-label="Close authentication dialog"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div role="tablist" aria-label="Sign in or create an account" className="inline-flex rounded-2xl border border-white/10 bg-white/5 p-1">
            {TABS.map((tab) => {
              const selected = mode === tab.mode;
              return (
                <button
                  key={tab.mode}
                  ref={(el) => {
                    tabRefs.current[tab.mode] = el;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => handleModeChange(tab.mode)}
                  onKeyDown={handleTabKeyDown}
                  className={`rounded-xl px-4 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgba(52,211,153,0.5)] ${
                    selected
                      ? 'bg-emerald-500/15 text-emerald-200 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.35)]'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {mode !== 'reset_password' && (
            <button
              type="button"
              onClick={handleGoogle}
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-sm font-medium text-neutral-200 transition-all hover:border-emerald-500/30 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <GoogleIcon />
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
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 transition-colors focus-within:border-emerald-400/40 focus-within:shadow-[0_0_0_1px_rgba(52,211,153,0.25)]">
                <Mail className="h-4 w-4 text-neutral-500" />
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
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
                <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 transition-colors focus-within:border-emerald-400/40 focus-within:shadow-[0_0_0_1px_rgba(52,211,153,0.25)]">
                  <KeyRound className="h-4 w-4 text-neutral-500" />
                  <input
                    id="auth-password"
                    type="password"
                    autoComplete={mode === 'sign_up' ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
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
                <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 transition-colors focus-within:border-emerald-400/40 focus-within:shadow-[0_0_0_1px_rgba(52,211,153,0.25)]">
                  <UserPlus className="h-4 w-4 text-neutral-500" />
                  <input
                    id="auth-confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="w-full bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
                    placeholder="Repeat your password"
                    disabled={isSubmitting}
                  />
                </div>
              </div>
            )}

            {mode === 'sign_up' && (
              <div className="space-y-3">
                <Checkbox
                  checked={agreedToTerms}
                  onChange={(checked) => {
                    setAgreedToTerms(checked);
                    if (checked) setAcceptanceError(null);
                  }}
                  error={acceptanceError}
                  disabled={isSubmitting}
                  label={
                    <>
                      I agree to the{' '}
                      <button
                        type="button"
                        onClick={() => setOpenLegalDoc('terms')}
                        className="text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
                      >
                        Terms &amp; End User Licence Agreement
                      </button>{' '}
                      and acknowledge the{' '}
                      <button
                        type="button"
                        onClick={() => setOpenLegalDoc('privacy_policy')}
                        className="text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
                      >
                        Privacy &amp; Data Notice
                      </button>
                      .
                    </>
                  }
                />
                <p className="text-xs leading-relaxed text-neutral-500">
                  Accounts are for adults. Children can use Kissago under a parent, guardian or authorised
                  educator.
                </p>
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
              aria-busy={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-4 py-3.5 text-sm font-semibold text-neutral-950 shadow-[0_10px_40px_rgba(52,211,153,0.2)] transition-colors hover:bg-emerald-200 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(52,211,153,0.5)] active:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400 disabled:shadow-none"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isSubmitting ? 'Please wait...' : submitLabel}
            </button>

            {mode === 'sign_in' && (
              <p className="text-center text-xs leading-relaxed text-neutral-500">
                By continuing, you agree to the current{' '}
                <button
                  type="button"
                  onClick={() => setOpenLegalDoc('terms')}
                  className="text-neutral-400 underline underline-offset-2 hover:text-emerald-300"
                >
                  Terms &amp; EULA
                </button>{' '}
                and acknowledge the{' '}
                <button
                  type="button"
                  onClick={() => setOpenLegalDoc('privacy_policy')}
                  className="text-neutral-400 underline underline-offset-2 hover:text-emerald-300"
                >
                  Privacy Notice
                </button>
                .
              </p>
            )}
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
      </Modal>

      <LegalDocumentModal
        isOpen={openLegalDoc !== null}
        onClose={() => setOpenLegalDoc(null)}
        pageKey={openLegalDoc ?? 'terms'}
        onAgree={
          mode === 'sign_up'
            ? () => {
                setAgreedToTerms(true);
                setAcceptanceError(null);
                setOpenLegalDoc(null);
              }
            : undefined
        }
      />
    </>
  );
}
