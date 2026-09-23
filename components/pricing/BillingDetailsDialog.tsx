'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Loader2, Lock, Receipt, X } from 'lucide-react';

import Modal from '@/components/ui/Modal';
import DialogGlow from '@/components/ui/DialogGlow';
import FilterDropdown, { type FilterDropdownOption } from '@/components/ui/FilterDropdown';
import { useAuth } from '@/lib/hooks/useAuth';
import { saveMyBillingProfile } from '@/app/actions/billing-profile';
import { INDIA_GST_STATE_CODES, indiaStateName } from '@/lib/billing/india-states.shared';
import { pinStateHint, validateBillingProfile } from '@/lib/billing/billing-profile.shared';
import {
  billingDetailsFormFromProfile,
  buildBillingProfileInput,
  isBusinessProfileType,
  resolveBusinessState,
  type BillingDetailsFormState,
  type BillingProfileType,
} from '@/components/pricing/billing-details-form.shared';
import type { BillingProfileDTO, BillingProfileInput } from '@/lib/types/pricing';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit D): the billing-details dialog,
 * rewritten on the shared Modal + DialogGlow so it gets the same focus trap, focus return, Escape
 * handling and reduced-motion behaviour as the sign-in dialog (defect 7, plan §2). The old dialog
 * was a hand-rolled portal with one legal-name field and eight fields all marked "(optional)"; this
 * replaces it with the owner's Personal/Business toggle and the required-field set from
 * phase-5-owner-requirements.md §1c (decision P1). Props are unchanged other than the new optional
 * `context`, so WalletPage (and Unit F's /account/billing) use it without modification.
 */

const LABEL_CLASS = 'text-xs font-sans uppercase tracking-wider text-neutral-500';
const INPUT_CLASS =
  'w-full rounded-xl border border-white/10 bg-neutral-900/70 px-3 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-emerald-400/40 focus:outline-none focus:ring-1 focus:ring-emerald-400/40 disabled:cursor-not-allowed disabled:opacity-60';
const ERROR_CLASS = 'text-[11px] leading-snug text-rose-300';
const HINT_CLASS = 'text-[11px] leading-snug text-amber-300';
const SECTION_CLASS = 'space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4';

// No leading placeholder option: an unfilled `stateCode` (`''`) matches no real option, so
// FilterDropdown's own `placeholder` prop shows "Select a state" (muted) instead of silently
// displaying the first real option's label. See Payments Phase 5 (docs/payments/phase-5-plan.md
// §5, Unit C).
const STATE_OPTIONS: FilterDropdownOption[] = INDIA_GST_STATE_CODES.map((entry) => ({
  value: entry.code,
  label: entry.name,
}));

const PROFILE_TYPE_TABS: { value: BillingProfileType; label: string }[] = [
  { value: 'personal', label: 'Personal' },
  { value: 'business', label: 'Business' },
];

export interface BillingDetailsDialogProps {
  open: boolean;
  profile: BillingProfileDTO | null;
  onClose: () => void;
  onSaved: (profile: BillingProfileDTO) => void;
  /** 'checkout' (blocking a purchase) changes the submit label and hides the "future invoices"
   * line; 'manage' (opened from a settings/wallet row) is the default. */
  context?: 'checkout' | 'manage';
}

export default function BillingDetailsDialog({
  open,
  profile,
  onClose,
  onSaved,
  context = 'manage',
}: BillingDetailsDialogProps) {
  const { user } = useAuth();
  const prefersReducedMotion = useReducedMotion();
  const baseId = useId();

  const [form, setForm] = useState<BillingDetailsFormState>(() =>
    billingDetailsFormFromProfile(profile, user?.email)
  );
  const [touched, setTouched] = useState<ReadonlySet<keyof BillingProfileInput>>(new Set());
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const tabRefs = useRef<Record<BillingProfileType, HTMLButtonElement | null>>({ personal: null, business: null });

  // The form resets from `profile` (and the signed-in user's email, as a fallback) every time the
  // dialog opens -- not on every profile/user change, so a background refresh while it's already
  // open never clobbers what the customer is mid-typing.
  useEffect(() => {
    if (!open) return;
    setForm(billingDetailsFormFromProfile(profile, user?.email));
    setTouched(new Set());
    setSubmitAttempted(false);
    setServerError(null);
    setIsUnavailable(false);
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isBusiness = isBusinessProfileType(form.profileType);
  const businessState = useMemo(() => resolveBusinessState(form.gstin), [form.gstin]);
  const effectiveStateCode = isBusiness ? businessState.stateCode : form.stateCode || null;

  const currentInput = useMemo(() => buildBillingProfileInput(form), [form]);
  const fieldErrors = useMemo(() => validateBillingProfile(currentInput), [currentInput]);
  const errorsByField = useMemo(() => {
    const map = new Map<string, string>();
    for (const error of fieldErrors) if (!map.has(error.field)) map.set(error.field, error.message);
    return map;
  }, [fieldErrors]);

  // Optional, never blocking (Unit B): pinStateHint ships returning 'unknown' for every input today,
  // so this renders nothing yet -- wired up so a future prefix table lights up with no dialog change.
  const pinHint = pinStateHint(form.postalCode, effectiveStateCode);

  const errorFor = (field: keyof BillingProfileInput): string | undefined =>
    touched.has(field) || submitAttempted ? errorsByField.get(field) : undefined;

  const updateField = <K extends keyof BillingDetailsFormState>(key: K, value: BillingDetailsFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const markTouched = (field: keyof BillingProfileInput) => {
    setTouched((current) => (current.has(field) ? current : new Set([...current, field])));
  };

  const handleProfileTypeChange = (nextType: BillingProfileType) => {
    setForm((current) => ({
      ...current,
      profileType: nextType,
      // Switching Business -> Personal clears the business-only fields (Unit B): otherwise a stale
      // company name or GSTIN sits in state, hidden, until the user reopens Business and finds it
      // still there.
      ...(nextType === 'personal' ? { companyName: '', gstin: '' } : {}),
    }));
    if (nextType === 'personal') {
      setTouched((current) => {
        if (!current.has('companyName') && !current.has('gstin')) return current;
        const next = new Set(current);
        next.delete('companyName');
        next.delete('gstin');
        return next;
      });
    }
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const currentIndex = PROFILE_TYPE_TABS.findIndex((tab) => tab.value === form.profileType);
    const nextIndex =
      event.key === 'ArrowRight'
        ? (currentIndex + 1) % PROFILE_TYPE_TABS.length
        : (currentIndex - 1 + PROFILE_TYPE_TABS.length) % PROFILE_TYPE_TABS.length;
    const nextTab = PROFILE_TYPE_TABS[nextIndex];
    handleProfileTypeChange(nextTab.value);
    tabRefs.current[nextTab.value]?.focus();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitAttempted(true);
    setServerError(null);
    if (fieldErrors.length > 0 || saving) return;

    setSaving(true);
    try {
      const result = await saveMyBillingProfile(currentInput);
      if (result.status === 'ok') {
        onSaved(result.profile);
        return;
      }
      if (result.status === 'invalid') {
        setServerError(result.message);
        return;
      }
      setIsUnavailable(true);
      setServerError("Billing details aren't available yet.");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Failed to save billing details.');
    } finally {
      setSaving(false);
    }
  };

  const submitLabel = context === 'checkout' ? 'Save and continue to payment' : 'Save';
  const fieldId = (name: string) => `${baseId}-${name}`;
  const errorId = (name: string) => `${fieldId(name)}-error`;
  const describedBy = (field: keyof BillingProfileInput) => (errorFor(field) ? errorId(field) : undefined);

  return (
    <Modal isOpen={open} onClose={onClose} ariaLabel="Billing details" showCloseButton={false} maxWidthClassName="max-w-lg">
      <DialogGlow />
      <div className="relative space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Receipt className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
            <div>
              <h2 className="text-lg font-serif text-neutral-100">Billing details</h2>
              <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">
                {context === 'checkout'
                  ? 'Your state is the GST place of supply and is required before payment.'
                  : 'Used to work out tax and, later, your invoices.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-neutral-400 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-neutral-100 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          role="tablist"
          aria-label="Personal or business"
          className="inline-flex rounded-2xl border border-white/10 bg-white/5 p-1"
        >
          {PROFILE_TYPE_TABS.map((tab) => {
            const selected = form.profileType === tab.value;
            return (
              <button
                key={tab.value}
                ref={(el) => {
                  tabRefs.current[tab.value] = el;
                }}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => handleProfileTypeChange(tab.value)}
                onKeyDown={handleTabKeyDown}
                disabled={saving}
                className={`rounded-xl px-4 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgba(52,211,153,0.5)] disabled:cursor-not-allowed disabled:opacity-60 ${
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

        {isUnavailable ? (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            Billing details aren&apos;t available yet. Please try again later.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <section className={SECTION_CLASS}>
              <p className={LABEL_CLASS}>You</p>
              <div className="space-y-1.5">
                <label className={LABEL_CLASS} htmlFor={fieldId('legalName')}>
                  Full name
                </label>
                <input
                  id={fieldId('legalName')}
                  value={form.legalName}
                  onChange={(event) => updateField('legalName', event.target.value)}
                  onBlur={() => markTouched('legalName')}
                  disabled={saving}
                  className={INPUT_CLASS}
                  aria-invalid={Boolean(errorFor('legalName'))}
                  aria-describedby={describedBy('legalName')}
                />
                {errorFor('legalName') && (
                  <p id={errorId('legalName')} className={ERROR_CLASS}>
                    {errorFor('legalName')}
                  </p>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className={LABEL_CLASS} htmlFor={fieldId('billingEmail')}>
                    Billing email
                  </label>
                  <input
                    id={fieldId('billingEmail')}
                    type="email"
                    value={form.billingEmail}
                    onChange={(event) => updateField('billingEmail', event.target.value)}
                    onBlur={() => markTouched('billingEmail')}
                    disabled={saving}
                    className={INPUT_CLASS}
                    aria-invalid={Boolean(errorFor('billingEmail'))}
                    aria-describedby={describedBy('billingEmail')}
                  />
                  {errorFor('billingEmail') && (
                    <p id={errorId('billingEmail')} className={ERROR_CLASS}>
                      {errorFor('billingEmail')}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className={LABEL_CLASS} htmlFor={fieldId('phone')}>
                    Phone
                  </label>
                  <input
                    id={fieldId('phone')}
                    type="tel"
                    value={form.phone}
                    onChange={(event) => updateField('phone', event.target.value)}
                    onBlur={() => markTouched('phone')}
                    disabled={saving}
                    placeholder="98765 43210"
                    className={INPUT_CLASS}
                    aria-invalid={Boolean(errorFor('phone'))}
                    aria-describedby={describedBy('phone')}
                  />
                  {errorFor('phone') && (
                    <p id={errorId('phone')} className={ERROR_CLASS}>
                      {errorFor('phone')}
                    </p>
                  )}
                </div>
              </div>
            </section>

            <AnimatePresence initial={false}>
              {isBusiness && (
                <motion.section
                  key="business"
                  initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
                  exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className={`${SECTION_CLASS} overflow-hidden`}
                >
                  <p className={LABEL_CLASS}>Business</p>
                  <div className="space-y-1.5">
                    <label className={LABEL_CLASS} htmlFor={fieldId('companyName')}>
                      Company legal name
                    </label>
                    <input
                      id={fieldId('companyName')}
                      value={form.companyName}
                      onChange={(event) => updateField('companyName', event.target.value)}
                      onBlur={() => markTouched('companyName')}
                      disabled={saving}
                      className={INPUT_CLASS}
                      aria-invalid={Boolean(errorFor('companyName'))}
                      aria-describedby={describedBy('companyName')}
                    />
                    {errorFor('companyName') && (
                      <p id={errorId('companyName')} className={ERROR_CLASS}>
                        {errorFor('companyName')}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className={LABEL_CLASS} htmlFor={fieldId('gstin')}>
                      GSTIN
                    </label>
                    <input
                      id={fieldId('gstin')}
                      value={form.gstin}
                      onChange={(event) => updateField('gstin', event.target.value.toUpperCase())}
                      onBlur={() => markTouched('gstin')}
                      disabled={saving}
                      placeholder="24ACLFA8196N1ZN"
                      className={INPUT_CLASS}
                      aria-invalid={Boolean(errorFor('gstin'))}
                      aria-describedby={describedBy('gstin')}
                    />
                    {errorFor('gstin') && (
                      <p id={errorId('gstin')} className={ERROR_CLASS}>
                        {errorFor('gstin')}
                      </p>
                    )}
                  </div>
                </motion.section>
              )}
            </AnimatePresence>

            <section className={SECTION_CLASS}>
              <p className={LABEL_CLASS}>Address</p>

              <div className="space-y-1.5">
                <p className={LABEL_CLASS}>State</p>
                {isBusiness ? (
                  <>
                    <div className="flex min-h-12 items-center gap-2 rounded-2xl border border-white/10 bg-neutral-900/40 px-4 py-3 text-sm text-neutral-300">
                      <Lock className="h-3.5 w-3.5 shrink-0 text-neutral-500" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">
                        {businessState.stateName ?? 'Add a valid GSTIN to set your state'}
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-500">From your GSTIN</p>
                  </>
                ) : (
                  <FilterDropdown
                    value={form.stateCode}
                    options={STATE_OPTIONS}
                    onChange={(value) => {
                      updateField('stateCode', value);
                      markTouched('stateCode');
                    }}
                    fullWidth
                    size="form"
                    mode="inline"
                    ariaLabel="Billing state"
                    placeholder="Select a state"
                    searchable
                  />
                )}
                {errorFor('stateCode') && <p className={ERROR_CLASS}>{errorFor('stateCode')}</p>}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className={LABEL_CLASS} htmlFor={fieldId('city')}>
                    City
                  </label>
                  <input
                    id={fieldId('city')}
                    value={form.city}
                    onChange={(event) => updateField('city', event.target.value)}
                    onBlur={() => markTouched('city')}
                    disabled={saving}
                    className={INPUT_CLASS}
                    aria-invalid={Boolean(errorFor('city'))}
                    aria-describedby={describedBy('city')}
                  />
                  {errorFor('city') && (
                    <p id={errorId('city')} className={ERROR_CLASS}>
                      {errorFor('city')}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className={LABEL_CLASS} htmlFor={fieldId('postalCode')}>
                    PIN code
                  </label>
                  <input
                    id={fieldId('postalCode')}
                    value={form.postalCode}
                    onChange={(event) => updateField('postalCode', event.target.value)}
                    onBlur={() => markTouched('postalCode')}
                    disabled={saving}
                    inputMode="numeric"
                    className={INPUT_CLASS}
                    aria-invalid={Boolean(errorFor('postalCode'))}
                    aria-describedby={describedBy('postalCode')}
                  />
                  {errorFor('postalCode') && (
                    <p id={errorId('postalCode')} className={ERROR_CLASS}>
                      {errorFor('postalCode')}
                    </p>
                  )}
                  {!errorFor('postalCode') && pinHint === 'mismatch' && (
                    <p className={HINT_CLASS}>
                      This PIN doesn&apos;t look like it&apos;s in{' '}
                      {(effectiveStateCode && indiaStateName(effectiveStateCode)) ?? 'the selected state'}.
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className={LABEL_CLASS} htmlFor={fieldId('addressLine1')}>
                  Address line 1{!isBusiness ? ' (optional)' : ''}
                </label>
                <input
                  id={fieldId('addressLine1')}
                  value={form.addressLine1}
                  onChange={(event) => updateField('addressLine1', event.target.value)}
                  onBlur={() => markTouched('addressLine1')}
                  disabled={saving}
                  className={INPUT_CLASS}
                  aria-invalid={Boolean(errorFor('addressLine1'))}
                  aria-describedby={describedBy('addressLine1')}
                />
                {errorFor('addressLine1') && (
                  <p id={errorId('addressLine1')} className={ERROR_CLASS}>
                    {errorFor('addressLine1')}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className={LABEL_CLASS} htmlFor={fieldId('addressLine2')}>
                  Address line 2 (optional)
                </label>
                <input
                  id={fieldId('addressLine2')}
                  value={form.addressLine2}
                  onChange={(event) => updateField('addressLine2', event.target.value)}
                  disabled={saving}
                  className={INPUT_CLASS}
                />
              </div>
            </section>

            {serverError && (
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {serverError}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-4">
              {context === 'manage' ? (
                <p className="text-xs text-neutral-500">Changes apply to future invoices</p>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  className="rounded-full border border-white/10 px-4 py-2 text-xs font-medium text-neutral-300 transition-colors hover:border-white/20 hover:text-white disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400 px-5 py-2 text-xs font-semibold text-neutral-950 transition-colors hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {submitLabel}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
