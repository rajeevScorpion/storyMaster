import { describe, it, expect } from 'vitest';

import {
  billingDetailsFormForCountryChange,
  billingDetailsFormFromProfile,
  buildBillingProfileInput,
  emptyBillingDetailsForm,
  isBusinessProfileType,
  isUsBillingForm,
  resolveBusinessState,
} from './billing-details-form.shared';
import { LEGAL_GSTIN } from '@/lib/legal/business-config';
import type { BillingProfileDTO } from '@/lib/types/pricing';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit D): the pure form logic behind the
 * redesigned billing-details dialog. Exercised directly since the repo has no
 * @testing-library/react or DOM test environment to mount the component itself.
 */

const BASE_PROFILE: BillingProfileDTO = {
  id: 'profile-1',
  legalName: 'Asha Rao',
  billingEmail: 'asha@example.com',
  phone: '+919876543210',
  companyName: null,
  gstin: null,
  profileType: 'personal',
  stateCode: '27',
  countryCode: 'IN',
  region: null,
  addressLine1: null,
  addressLine2: null,
  city: 'Pune',
  postalCode: '411001',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('isBusinessProfileType', () => {
  it('is true only for business -- the Personal/Business toggle gates the Business section on this', () => {
    expect(isBusinessProfileType('business')).toBe(true);
    expect(isBusinessProfileType('personal')).toBe(false);
  });
});

describe('resolveBusinessState', () => {
  it('locks the state to the GSTIN-derived code once the checksum passes', () => {
    expect(resolveBusinessState(LEGAL_GSTIN)).toEqual({ stateCode: '24', stateName: 'Gujarat' });
  });

  it('is lower-case tolerant and trims whitespace', () => {
    expect(resolveBusinessState(`  ${LEGAL_GSTIN.toLowerCase()}  `)).toEqual({
      stateCode: '24',
      stateName: 'Gujarat',
    });
  });

  it('does not lock on a GSTIN with a mistyped checksum character', () => {
    const typo = `${LEGAL_GSTIN.slice(0, 14)}${LEGAL_GSTIN[14] === 'N' ? 'M' : 'N'}`;
    expect(resolveBusinessState(typo)).toEqual({ stateCode: null, stateName: null });
  });

  it('does not lock on an empty or incomplete GSTIN', () => {
    expect(resolveBusinessState('')).toEqual({ stateCode: null, stateName: null });
    expect(resolveBusinessState('24ACLFA8196N1Z')).toEqual({ stateCode: null, stateName: null });
  });
});

describe('billingDetailsFormFromProfile', () => {
  it('returns an empty Personal form with the fallback email when there is no saved profile', () => {
    expect(billingDetailsFormFromProfile(null, 'signed-in@example.com')).toEqual({
      ...emptyBillingDetailsForm(),
      billingEmail: 'signed-in@example.com',
    });
  });

  it('mirrors a saved profile, ignoring the fallback email when the profile already has one', () => {
    const form = billingDetailsFormFromProfile(BASE_PROFILE, 'signed-in@example.com');
    expect(form.billingEmail).toBe('asha@example.com');
    expect(form.legalName).toBe('Asha Rao');
    expect(form.profileType).toBe('personal');
    expect(form.countryCode).toBe('IN');
  });

  it('falls back to the account email when the saved profile has none', () => {
    const form = billingDetailsFormFromProfile({ ...BASE_PROFILE, billingEmail: null }, 'signed-in@example.com');
    expect(form.billingEmail).toBe('signed-in@example.com');
  });

  it('mirrors a saved US profile, including its region', () => {
    const form = billingDetailsFormFromProfile(
      { ...BASE_PROFILE, countryCode: 'US', stateCode: '96', region: 'CA' },
      'signed-in@example.com'
    );
    expect(form.countryCode).toBe('US');
    expect(form.region).toBe('CA');
  });
});

// Payments Phase 8 (docs/payments/phase-8-plan.md §8, Unit B)
describe('isUsBillingForm', () => {
  it('is true only for a foreign country -- US is the only one supported today', () => {
    expect(isUsBillingForm('US')).toBe(true);
    expect(isUsBillingForm('IN')).toBe(false);
    expect(isUsBillingForm('FR')).toBe(false);
  });
});

describe('billingDetailsFormForCountryChange', () => {
  it('is a no-op when the country does not actually change', () => {
    const form = { ...emptyBillingDetailsForm(), stateCode: '24' };
    expect(billingDetailsFormForCountryChange(form, 'IN')).toBe(form);
  });

  it('clears stateCode/region, forces Personal and clears business fields when moving to a foreign country', () => {
    const form = {
      ...emptyBillingDetailsForm(),
      stateCode: '24',
      profileType: 'business' as const,
      companyName: 'Aavriti Design Studio',
      gstin: LEGAL_GSTIN,
    };

    const next = billingDetailsFormForCountryChange(form, 'US');

    expect(next.countryCode).toBe('US');
    expect(next.stateCode).toBe('');
    expect(next.region).toBe('');
    expect(next.profileType).toBe('personal');
    expect(next.companyName).toBe('');
    expect(next.gstin).toBe('');
  });

  it('clears region (and leaves Personal alone) when moving back to India', () => {
    const form = { ...emptyBillingDetailsForm(), countryCode: 'US', region: 'CA' };

    const next = billingDetailsFormForCountryChange(form, 'IN');

    expect(next.countryCode).toBe('IN');
    expect(next.region).toBe('');
    expect(next.profileType).toBe('personal');
  });
});

describe('buildBillingProfileInput', () => {
  it('sends companyName and gstin as null under Personal, even with stale Business values in state', () => {
    const form = {
      ...emptyBillingDetailsForm(),
      profileType: 'personal' as const,
      legalName: 'Asha Rao',
      billingEmail: 'asha@example.com',
      phone: '9876543210',
      stateCode: '27',
      city: 'Pune',
      postalCode: '411001',
      // Left over from a Business session the user switched away from without clearing.
      companyName: 'Old Co Pvt Ltd',
      gstin: LEGAL_GSTIN,
    };

    const input = buildBillingProfileInput(form);
    expect(input.companyName).toBeNull();
    expect(input.gstin).toBeNull();
    expect(input.profileType).toBe('personal');
    expect(input.stateCode).toBe('27');
  });

  it('derives the stateCode from a valid GSTIN under Business, and trims/upper-cases the GSTIN', () => {
    const form = {
      ...emptyBillingDetailsForm(),
      profileType: 'business' as const,
      legalName: 'Asha Rao',
      billingEmail: 'asha@example.com',
      phone: '9876543210',
      companyName: 'Aavriti Design Studio',
      gstin: `  ${LEGAL_GSTIN.toLowerCase()}  `,
      city: 'Ahmedabad',
      postalCode: '380001',
      addressLine1: '221B Baker Street',
    };

    const input = buildBillingProfileInput(form);
    expect(input.companyName).toBe('Aavriti Design Studio');
    expect(input.gstin).toBe(LEGAL_GSTIN);
    expect(input.stateCode).toBe('24');
    expect(input.profileType).toBe('business');
  });

  it('sends an empty stateCode under Business while the GSTIN has not resolved yet', () => {
    const form = {
      ...emptyBillingDetailsForm(),
      profileType: 'business' as const,
      gstin: '24ACLFA8196N1Z',
    };

    expect(buildBillingProfileInput(form).stateCode).toBe('');
  });

  it('sends null for optional address lines and phone when left blank', () => {
    const input = buildBillingProfileInput(emptyBillingDetailsForm());
    expect(input.billingEmail).toBeNull();
    expect(input.phone).toBeNull();
    expect(input.addressLine1).toBeNull();
    expect(input.addressLine2).toBeNull();
    expect(input.city).toBeNull();
    expect(input.postalCode).toBeNull();
  });

  it('sends region (trimmed/upper-cased), forces Personal and nulls company/gstin for a US form -- even if profileType or stateCode still carried a stale Business value', () => {
    const form = {
      ...emptyBillingDetailsForm(),
      countryCode: 'US',
      profileType: 'business' as const,
      legalName: 'Asha Rao',
      billingEmail: 'asha@example.com',
      phone: '4155550100',
      stateCode: '24',
      region: ' ca ',
      companyName: 'Old Co Pvt Ltd',
      gstin: LEGAL_GSTIN,
      city: 'San Francisco',
      postalCode: '94103',
    };

    const input = buildBillingProfileInput(form);
    expect(input.countryCode).toBe('US');
    expect(input.profileType).toBe('personal');
    expect(input.companyName).toBeNull();
    expect(input.gstin).toBeNull();
    expect(input.region).toBe('CA');
    expect(input.stateCode).toBe('24'); // ignored server-side for a foreign profile (Unit B)
  });

  it('sends region null for an Indian form', () => {
    const input = buildBillingProfileInput({ ...emptyBillingDetailsForm(), region: 'CA' });
    expect(input.region).toBeNull();
  });
});
