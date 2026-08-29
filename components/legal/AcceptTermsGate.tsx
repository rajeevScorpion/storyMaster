'use client';

import { useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

import { recordLegalAcceptanceAction } from '@/app/actions/legal';
import Checkbox from '@/components/ui/Checkbox';
import LegalDocumentModal from '@/components/legal/LegalDocumentModal';
import { startNavigationProgress } from '@/lib/navigation/progress';
import type { LegalAcceptanceSurface } from '@/lib/legal/consent';

const DOC_COPY: Record<string, { label: string; verb: 'agree to' | 'acknowledge' }> = {
  terms: { label: 'Terms & End User Licence Agreement', verb: 'agree to' },
  privacy_policy: { label: 'Privacy & Data Notice', verb: 'acknowledge' },
};

function docLabel(pageKey: string): { label: string; verb: 'agree to' | 'acknowledge' } {
  return DOC_COPY[pageKey] ?? { label: pageKey.replaceAll('_', ' '), verb: 'agree to' };
}

interface AcceptTermsGateProps {
  /** page_key values still needing acceptance -- typically ['terms', 'privacy_policy']. */
  documentKeys: string[];
  isReconsent: boolean;
  next: string;
}

/**
 * The single interception point for both the post-OAuth onboarding gate and
 * material-version re-consent -- reached only via proxy.ts's redirect or the
 * OAuth callback, never linked to directly. No countdown, no skip, no
 * pre-checked box, no dismissal: the page has no "close" affordance at all,
 * matching the pack's explicit prohibition on dark patterns here.
 */
export default function AcceptTermsGate({ documentKeys, isReconsent, next }: AcceptTermsGateProps) {
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openDoc, setOpenDoc] = useState<string | null>(null);

  const sentence: ReactNode = documentKeys.map((key, index) => {
    const { label, verb } = docLabel(key);
    const isLast = index === documentKeys.length - 1;
    const isFirst = index === 0;
    return (
      <span key={key}>
        {!isFirst ? (isLast ? ' and ' : ', ') : null}
        {verb}{' '}
        <button
          type="button"
          onClick={() => setOpenDoc(key)}
          className="text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
        >
          {label}
        </button>
      </span>
    );
  });

  const handleAgree = async () => {
    if (!checked) {
      setError('Please agree before continuing.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const surface: LegalAcceptanceSurface = isReconsent ? 'reconsent_modal' : 'oauth_onboarding';
    const result = await recordLegalAcceptanceAction({ documentKeys, surface });

    if (result.error) {
      setError(result.error);
      setIsSubmitting(false);
      return;
    }

    startNavigationProgress();
    window.location.href = next;
  };

  return (
    <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-neutral-900/70 p-8 shadow-2xl backdrop-blur-xl">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.18em] text-emerald-300">
          {isReconsent ? 'Updated policy' : 'One last step'}
        </p>
        <h1 className="text-3xl font-serif text-neutral-100">
          {isReconsent ? 'We updated our Terms' : 'Before you continue'}
        </h1>
        <p className="text-sm leading-relaxed text-neutral-400">
          {isReconsent
            ? "We've made changes that affect how Kissago is used. Please review the updated terms before continuing."
            : 'Before we create your Kissago profile, please review and accept the terms that govern your account.'}
        </p>
      </div>

      <div className="mt-6 space-y-4">
        <Checkbox
          checked={checked}
          onChange={(value) => {
            setChecked(value);
            if (value) setError(null);
          }}
          error={error}
          disabled={isSubmitting}
          label={<>I {sentence}.</>}
        />

        <button
          type="button"
          onClick={handleAgree}
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-4 py-3.5 text-sm font-semibold text-neutral-950 shadow-[0_10px_40px_rgba(52,211,153,0.2)] transition-colors hover:bg-emerald-200 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(52,211,153,0.5)] active:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400 disabled:shadow-none"
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isSubmitting ? 'Please wait...' : 'Agree & continue'}
        </button>
      </div>

      <LegalDocumentModal isOpen={openDoc !== null} onClose={() => setOpenDoc(null)} pageKey={openDoc ?? 'terms'} />
    </div>
  );
}
