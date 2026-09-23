import { describe, it, expect } from 'vitest';

import {
  gstinCheckDigit,
  isBillingProfileComplete,
  isValidEmail,
  isValidGstinWithChecksum,
  isValidPin,
  normalizeIndianPhone,
  pinStateHint,
  stateCodeFromGstin,
  validateBillingProfile,
} from './billing-profile.shared';
import { LEGAL_GSTIN } from '@/lib/legal/business-config';
import type { BillingProfileDTO, BillingProfileInput } from '@/lib/types/pricing';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit B): exercises the one validation
 * authority both the billing dialog (Unit D) and the server (lib/billing/billing-profile.ts) import.
 */

describe('normalizeIndianPhone', () => {
  it('accepts a bare 10-digit mobile number', () => {
    expect(normalizeIndianPhone('9876543210')).toBe('+919876543210');
  });

  it('accepts a leading 0 (11 digits total)', () => {
    expect(normalizeIndianPhone('09876543210')).toBe('+919876543210');
  });

  it('accepts a leading 91 (12 digits total)', () => {
    expect(normalizeIndianPhone('919876543210')).toBe('+919876543210');
  });

  it('accepts a leading +91', () => {
    expect(normalizeIndianPhone('+919876543210')).toBe('+919876543210');
  });

  it('strips spaces, dashes and parentheses', () => {
    expect(normalizeIndianPhone('+91 98765-43210')).toBe('+919876543210');
    expect(normalizeIndianPhone('(0987) 654-3210')).toBe('+919876543210');
  });

  it('rejects a number not starting with 6-9', () => {
    expect(normalizeIndianPhone('5876543210')).toBeNull();
  });

  it('rejects the wrong digit count', () => {
    expect(normalizeIndianPhone('987654321')).toBeNull();
    expect(normalizeIndianPhone('98765432100')).toBeNull();
  });

  it('rejects a non-+91 country code', () => {
    expect(normalizeIndianPhone('+19876543210')).toBeNull();
  });

  it('rejects null, undefined and empty input', () => {
    expect(normalizeIndianPhone(null)).toBeNull();
    expect(normalizeIndianPhone(undefined)).toBeNull();
    expect(normalizeIndianPhone('')).toBeNull();
  });
});

describe('isValidPin', () => {
  it('accepts a 6-digit PIN starting 1-9', () => {
    expect(isValidPin('382016')).toBe(true);
  });

  it('rejects a PIN starting with 0', () => {
    expect(isValidPin('082016')).toBe(false);
  });

  it('rejects the wrong length', () => {
    expect(isValidPin('38201')).toBe(false);
    expect(isValidPin('3820166')).toBe(false);
  });

  it('rejects null, undefined and empty input', () => {
    expect(isValidPin(null)).toBe(false);
    expect(isValidPin(undefined)).toBe(false);
    expect(isValidPin('')).toBe(false);
  });
});

describe('isValidEmail', () => {
  it('accepts a plain address', () => {
    expect(isValidEmail('jane@example.com')).toBe(true);
  });

  it('rejects no @, or more than one', () => {
    expect(isValidEmail('jane.example.com')).toBe(false);
    expect(isValidEmail('jane@ex@ample.com')).toBe(false);
  });

  it('rejects an empty local part', () => {
    expect(isValidEmail('@example.com')).toBe(false);
  });

  it('rejects a domain with no dot, or a dot at either end', () => {
    expect(isValidEmail('jane@example')).toBe(false);
    expect(isValidEmail('jane@.com')).toBe(false);
    expect(isValidEmail('jane@example.')).toBe(false);
  });

  it('rejects whitespace', () => {
    expect(isValidEmail('jane doe@example.com')).toBe(false);
  });

  it('rejects null, undefined and empty input', () => {
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
});

describe('gstinCheckDigit / isValidGstinWithChecksum', () => {
  it('computes the correct check digit for LEGAL_GSTIN', () => {
    expect(LEGAL_GSTIN).toBe('24ACLFA8196N1ZN');
    expect(gstinCheckDigit(LEGAL_GSTIN.slice(0, 14))).toBe(LEGAL_GSTIN[14]);
  });

  it('accepts LEGAL_GSTIN', () => {
    expect(isValidGstinWithChecksum(LEGAL_GSTIN)).toBe(true);
  });

  it('accepts a second known-good GSTIN', () => {
    expect(isValidGstinWithChecksum('27AAPFU0939F1ZV')).toBe(true);
  });

  it('rejects a one-character typo in the checksum digit', () => {
    expect(isValidGstinWithChecksum('27AAPFU0939F1ZX')).toBe(false);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(isValidGstinWithChecksum(` ${LEGAL_GSTIN.toLowerCase()} `)).toBe(true);
  });

  it('rejects a GSTIN that fails the shape regex before checksum is even considered', () => {
    expect(isValidGstinWithChecksum('not-a-gstin')).toBe(false);
  });

  it('rejects null, undefined and empty input', () => {
    expect(isValidGstinWithChecksum(null)).toBe(false);
    expect(isValidGstinWithChecksum(undefined)).toBe(false);
    expect(isValidGstinWithChecksum('')).toBe(false);
  });
});

describe('stateCodeFromGstin', () => {
  it('returns the state code for a current GSTIN', () => {
    expect(stateCodeFromGstin(LEGAL_GSTIN)).toBe('24');
    expect(stateCodeFromGstin('27AAPFU0939F1ZV')).toBe('27');
  });

  it('returns null for a retired state code (25, Daman and Diu)', () => {
    expect(stateCodeFromGstin('25ACLFA8196N1ZN')).toBeNull();
  });

  it('returns null for a retired state code (28, undivided Andhra Pradesh)', () => {
    expect(stateCodeFromGstin('28ACLFA8196N1ZN')).toBeNull();
  });

  it('returns null for an unrecognised code (99)', () => {
    expect(stateCodeFromGstin('99ACLFA8196N1ZN')).toBeNull();
  });

  it('returns null for null, undefined and empty input', () => {
    expect(stateCodeFromGstin(null)).toBeNull();
    expect(stateCodeFromGstin(undefined)).toBeNull();
    expect(stateCodeFromGstin('')).toBeNull();
  });
});

describe('pinStateHint', () => {
  it('always returns unknown -- the prefix table is deliberately not shipped', () => {
    expect(pinStateHint('382016', '24')).toBe('unknown');
    expect(pinStateHint(null, null)).toBe('unknown');
    expect(pinStateHint('000000', '99')).toBe('unknown');
  });
});

describe('validateBillingProfile', () => {
  function personal(overrides: Partial<BillingProfileInput> = {}): BillingProfileInput {
    return {
      legalName: 'Jane Doe',
      billingEmail: 'jane@example.com',
      phone: '9876543210',
      stateCode: '24',
      city: 'Gandhinagar',
      postalCode: '382016',
      profileType: 'personal',
      ...overrides,
    };
  }

  function business(overrides: Partial<BillingProfileInput> = {}): BillingProfileInput {
    return {
      legalName: 'Jane Doe',
      billingEmail: 'jane@example.com',
      phone: '9876543210',
      stateCode: '24',
      city: 'Gandhinagar',
      postalCode: '382016',
      addressLine1: 'B601, Kunj Heights',
      companyName: 'Aavriti Design Studio',
      gstin: LEGAL_GSTIN,
      profileType: 'business',
      ...overrides,
    };
  }

  it('accepts a complete personal profile', () => {
    expect(validateBillingProfile(personal())).toEqual([]);
  });

  it('accepts a complete business profile', () => {
    expect(validateBillingProfile(business())).toEqual([]);
  });

  it('treats an old client with no profileType as business iff a GSTIN is present', () => {
    const businessInput = business();
    delete businessInput.profileType;
    expect(validateBillingProfile(businessInput)).toEqual([]);

    const personalInput = personal();
    delete personalInput.profileType;
    expect(validateBillingProfile(personalInput)).toEqual([]);
  });

  it('requires legalName, billingEmail, phone, city and postalCode for a personal profile', () => {
    expect(validateBillingProfile(personal({ legalName: '' })).map((e) => e.field)).toContain('legalName');
    expect(validateBillingProfile(personal({ billingEmail: '' })).map((e) => e.field)).toContain('billingEmail');
    expect(validateBillingProfile(personal({ phone: '' })).map((e) => e.field)).toContain('phone');
    expect(validateBillingProfile(personal({ city: '' })).map((e) => e.field)).toContain('city');
    expect(validateBillingProfile(personal({ postalCode: '' })).map((e) => e.field)).toContain('postalCode');
  });

  it('rejects an invalid email for personal', () => {
    const errors = validateBillingProfile(personal({ billingEmail: 'not-an-email' }));
    expect(errors).toEqual([{ field: 'billingEmail', message: expect.any(String) }]);
  });

  it('rejects a phone that does not normalise for personal', () => {
    const errors = validateBillingProfile(personal({ phone: '12345' }));
    expect(errors).toEqual([{ field: 'phone', message: expect.any(String) }]);
  });

  it('rejects an invalid PIN for personal', () => {
    const errors = validateBillingProfile(personal({ postalCode: '012345' }));
    expect(errors).toEqual([{ field: 'postalCode', message: expect.any(String) }]);
  });

  it('rejects an invalid or retired state code for personal', () => {
    expect(validateBillingProfile(personal({ stateCode: '99' })).map((e) => e.field)).toEqual(['stateCode']);
    expect(validateBillingProfile(personal({ stateCode: '25' })).map((e) => e.field)).toEqual(['stateCode']);
  });

  it('does not require addressLine1/2 for personal', () => {
    expect(validateBillingProfile(personal({ addressLine1: null, addressLine2: null }))).toEqual([]);
  });

  it('rejects a personal profile carrying a GSTIN', () => {
    const errors = validateBillingProfile(personal({ gstin: LEGAL_GSTIN }));
    expect(errors).toEqual([{ field: 'gstin', message: 'Switch to Business to add a GSTIN.' }]);
  });

  it('rejects a personal profile carrying a company name', () => {
    const errors = validateBillingProfile(personal({ companyName: 'Aavriti Design Studio' }));
    expect(errors).toEqual([{ field: 'companyName', message: 'Switch to Business to add a GSTIN.' }]);
  });

  it('requires addressLine1 and companyName for a business profile', () => {
    expect(validateBillingProfile(business({ addressLine1: null })).map((e) => e.field)).toContain('addressLine1');
    expect(validateBillingProfile(business({ companyName: '' })).map((e) => e.field)).toContain('companyName');
  });

  it('requires a GSTIN for a business profile', () => {
    const errors = validateBillingProfile(business({ gstin: null }));
    expect(errors).toEqual([{ field: 'gstin', message: 'GSTIN is required for a business profile.' }]);
  });

  it('rejects a business GSTIN that fails its checksum', () => {
    const errors = validateBillingProfile(business({ gstin: '27AAPFU0939F1ZX' }));
    expect(errors).toEqual([{ field: 'gstin', message: expect.stringMatching(/does not look right/) }]);
  });

  it('rejects a business GSTIN whose state code is retired', () => {
    // 25 is a shape-valid but retired state code; the checksum is computed to make it pass GSTIN_REGEX
    // and isValidGstinWithChecksum so only the state-code check below fires.
    const first14 = `25${LEGAL_GSTIN.slice(2, 14)}`;
    const retiredGstin = first14 + gstinCheckDigit(first14);
    const errors = validateBillingProfile(business({ gstin: retiredGstin }));
    expect(errors).toEqual([
      { field: 'gstin', message: "This GSTIN's state code isn't a current one. Please contact support." },
    ]);
  });

  it('does not error when the client-sent stateCode disagrees with the GSTIN-derived one', () => {
    // LEGAL_GSTIN is state 24 (Gujarat); the client sent a different, otherwise-valid state code.
    // The server derives and overrides the state for business profiles, so this must not be an error.
    expect(validateBillingProfile(business({ stateCode: '27' }))).toEqual([]);
  });
});

describe('isBillingProfileComplete', () => {
  function dto(overrides: Partial<BillingProfileDTO> = {}): BillingProfileDTO {
    return {
      id: 'profile-1',
      legalName: 'Jane Doe',
      billingEmail: 'jane@example.com',
      phone: '+919876543210',
      companyName: null,
      gstin: null,
      profileType: 'personal',
      stateCode: '24',
      countryCode: 'IN',
      addressLine1: null,
      addressLine2: null,
      city: 'Gandhinagar',
      postalCode: '382016',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('is false for null', () => {
    expect(isBillingProfileComplete(null)).toBe(false);
  });

  it('is true for a complete personal profile', () => {
    expect(isBillingProfileComplete(dto())).toBe(true);
  });

  it('is false for a profile saved under the old rules (missing email, phone, city, PIN)', () => {
    expect(
      isBillingProfileComplete(dto({ billingEmail: null, phone: null, city: null, postalCode: null }))
    ).toBe(false);
  });

  it('is true for a complete business profile', () => {
    expect(
      isBillingProfileComplete(
        dto({
          profileType: 'business',
          companyName: 'Aavriti Design Studio',
          gstin: LEGAL_GSTIN,
          addressLine1: 'B601, Kunj Heights',
        })
      )
    ).toBe(true);
  });

  it('is false for a business profile missing its address line 1', () => {
    expect(
      isBillingProfileComplete(
        dto({ profileType: 'business', companyName: 'Aavriti Design Studio', gstin: LEGAL_GSTIN })
      )
    ).toBe(false);
  });
});
