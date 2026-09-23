'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2, Receipt, X } from 'lucide-react';
import FilterDropdown, { type FilterDropdownOption } from '@/components/ui/FilterDropdown';
import { saveMyBillingProfile } from '@/app/actions/billing-profile';
import { INDIA_GST_STATE_CODES, isValidGstin } from '@/lib/billing/india-states.shared';
import type { BillingProfileDTO, BillingProfileInput } from '@/lib/types/pricing';

/**
 * Payments Phase 2, Unit B2a (docs/payments/phase-2-unit-b2-plan.md §3): the wallet's billing
 * details form. Opened either from the wallet's "Billing details" row or automatically when
 * checkout needs a declared state and none exists yet -- WalletPage remembers the checkout the
 * user asked for and continues it from onSaved, so nobody has to click twice.
 */

const INPUT_CLASS =
  'w-full rounded-xl border border-white/10 bg-neutral-900/70 px-3 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-emerald-400/40 focus:outline-none focus:ring-1 focus:ring-emerald-400/40 disabled:opacity-60';
const LABEL_CLASS = 'text-xs font-sans uppercase tracking-wider text-neutral-500';

// No leading placeholder option: an unfilled `stateCode` (`''`) matches no real option, so
// FilterDropdown's own `placeholder` prop shows "Select a state" (muted) instead of silently
// displaying the first real option's label -- that fallback would make an empty, unvalidated
// selection look already filled in. See Payments Phase 5 (docs/payments/phase-5-plan.md §5,
// Unit C).
const STATE_OPTIONS: FilterDropdownOption[] = INDIA_GST_STATE_CODES.map((entry) => ({
  value: entry.code,
  label: entry.name,
}));

export interface BillingDetailsDialogProps {
  open: boolean;
  profile: BillingProfileDTO | null;
  onClose: () => void;
  onSaved: (profile: BillingProfileDTO) => void;
}

export default function BillingDetailsDialog({ open, profile, onClose, onSaved }: BillingDetailsDialogProps) {
  const [legalName, setLegalName] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [gstin, setGstin] = useState('');
  const [gstinError, setGstinError] = useState<string | null>(null);
  const [billingEmail, setBillingEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUnavailable, setIsUnavailable] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLegalName(profile?.legalName ?? '');
    setStateCode(profile?.stateCode ?? '');
    setCompanyName(profile?.companyName ?? '');
    setGstin(profile?.gstin ?? '');
    setGstinError(null);
    setBillingEmail(profile?.billingEmail ?? '');
    setPhone(profile?.phone ?? '');
    setAddressLine1(profile?.addressLine1 ?? '');
    setAddressLine2(profile?.addressLine2 ?? '');
    setCity(profile?.city ?? '');
    setPostalCode(profile?.postalCode ?? '');
    setErrorMessage(null);
    setIsUnavailable(false);
  }, [open, profile]);

  const handleGstinBlur = () => {
    const trimmed = gstin.trim();
    if (!trimmed) {
      setGstinError(null);
      return;
    }
    setGstinError(
      isValidGstin(trimmed.toUpperCase())
        ? null
        : 'That GSTIN does not look right. It should be 15 characters, e.g. 24ACLFA8196N1ZN.'
    );
  };

  const canSubmit = legalName.trim().length > 0 && stateCode.length > 0 && !gstinError && !saving;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setErrorMessage(null);

    try {
      const input: BillingProfileInput = {
        legalName: legalName.trim(),
        stateCode,
        companyName: companyName.trim() || null,
        gstin: gstin.trim() || null,
        billingEmail: billingEmail.trim() || null,
        phone: phone.trim() || null,
        addressLine1: addressLine1.trim() || null,
        addressLine2: addressLine2.trim() || null,
        city: city.trim() || null,
        postalCode: postalCode.trim() || null,
      };

      const result = await saveMyBillingProfile(input);

      if (result.status === 'ok') {
        onSaved(result.profile);
        return;
      }
      if (result.status === 'invalid') {
        setErrorMessage(result.message);
        return;
      }
      setIsUnavailable(true);
      setErrorMessage("Billing details aren't available yet.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save billing details.');
    } finally {
      setSaving(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) onClose();
          }}
        >
          <motion.section
            role="dialog"
            aria-label="Billing details"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-white/10 bg-neutral-950/95 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-center gap-3 border-b border-white/5 p-5">
              <Receipt className="h-5 w-5 shrink-0 text-emerald-300" />
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-serif text-neutral-100">Billing details</h2>
                <p className="mt-0.5 text-xs text-neutral-500">
                  Your state is the GST place of supply and is required before payment.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-full p-2 text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-200 disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {isUnavailable ? (
              <div className="flex-1 p-5">
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  Billing details aren&apos;t available yet. Please try again later.
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto p-5">
                {errorMessage && (
                  <p className="text-xs leading-snug text-rose-300">{errorMessage}</p>
                )}

                <div className="space-y-1.5">
                  <p className={LABEL_CLASS}>Legal name</p>
                  <input
                    value={legalName}
                    onChange={(event) => setLegalName(event.target.value)}
                    disabled={saving}
                    placeholder="As it appears on your GST registration, if any"
                    className={INPUT_CLASS}
                    aria-label="Legal name"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <p className={LABEL_CLASS}>State</p>
                  <FilterDropdown
                    value={stateCode}
                    options={STATE_OPTIONS}
                    onChange={setStateCode}
                    fullWidth
                    size="form"
                    mode="inline"
                    ariaLabel="Billing state"
                    placeholder="Select a state"
                    searchable
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <p className={LABEL_CLASS}>Company name (optional)</p>
                    <input
                      value={companyName}
                      onChange={(event) => setCompanyName(event.target.value)}
                      disabled={saving}
                      className={INPUT_CLASS}
                      aria-label="Company name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <p className={LABEL_CLASS}>GSTIN (optional)</p>
                    <input
                      value={gstin}
                      onChange={(event) => {
                        setGstin(event.target.value);
                        if (gstinError) setGstinError(null);
                      }}
                      onBlur={handleGstinBlur}
                      disabled={saving}
                      placeholder="24ACLFA8196N1ZN"
                      className={INPUT_CLASS}
                      aria-label="GSTIN"
                      aria-invalid={Boolean(gstinError)}
                    />
                    {gstinError && <p className="text-[11px] text-rose-300">{gstinError}</p>}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <p className={LABEL_CLASS}>Billing email (optional)</p>
                    <input
                      type="email"
                      value={billingEmail}
                      onChange={(event) => setBillingEmail(event.target.value)}
                      disabled={saving}
                      className={INPUT_CLASS}
                      aria-label="Billing email"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <p className={LABEL_CLASS}>Phone (optional)</p>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      disabled={saving}
                      className={INPUT_CLASS}
                      aria-label="Phone"
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <p className={LABEL_CLASS}>Address line 1 (optional)</p>
                    <input
                      value={addressLine1}
                      onChange={(event) => setAddressLine1(event.target.value)}
                      disabled={saving}
                      className={INPUT_CLASS}
                      aria-label="Address line 1"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <p className={LABEL_CLASS}>Address line 2 (optional)</p>
                    <input
                      value={addressLine2}
                      onChange={(event) => setAddressLine2(event.target.value)}
                      disabled={saving}
                      className={INPUT_CLASS}
                      aria-label="Address line 2"
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <p className={LABEL_CLASS}>City (optional)</p>
                    <input
                      value={city}
                      onChange={(event) => setCity(event.target.value)}
                      disabled={saving}
                      className={INPUT_CLASS}
                      aria-label="City"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <p className={LABEL_CLASS}>Postal code (optional)</p>
                    <input
                      value={postalCode}
                      onChange={(event) => setPostalCode(event.target.value)}
                      disabled={saving}
                      className={INPUT_CLASS}
                      aria-label="Postal code"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-white/5 pt-4">
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
                    disabled={!canSubmit}
                    className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400 px-5 py-2 text-xs font-semibold text-neutral-950 transition-colors hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Save billing details
                  </button>
                </div>
              </form>
            )}
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
