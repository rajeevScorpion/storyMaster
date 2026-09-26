import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/billing/billing-profile', async (importOriginal) => {
  // loadBillingProfile/saveBillingProfile are stubbed below; toBillingProfileDTO is left as the real,
  // plain camelCase mapper (see lib/billing/billing-profile.ts) so these tests exercise the exact same
  // mapping app/actions/pricing-runtime.ts relies on, rather than a third hand-copied version of it.
  const actual = await importOriginal<typeof import('@/lib/billing/billing-profile')>();
  return {
    ...actual,
    loadBillingProfile: vi.fn(),
    saveBillingProfile: vi.fn(),
  };
});

// Payments Phase 8 (docs/payments/phase-8-plan.md §8, Unit B): getBillingCountryOptions's own
// dependency, stubbed the same way lib/billing/international.test.ts stubs the flag read one layer
// further down.
vi.mock('@/lib/billing/international', () => ({
  getInternationalCheckoutCountries: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadBillingProfile, saveBillingProfile } from '@/lib/billing/billing-profile';
import { getInternationalCheckoutCountries } from '@/lib/billing/international';
import { getBillingCountryOptions, getMyBillingProfile, saveMyBillingProfile } from './billing-profile';

const createClientMock = vi.mocked(createClient);
const createAdminClientMock = vi.mocked(createAdminClient);
const loadBillingProfileMock = vi.mocked(loadBillingProfile);
const saveBillingProfileMock = vi.mocked(saveBillingProfile);
const internationalCountriesMock = vi.mocked(getInternationalCheckoutCountries);

function signedIn(userId = 'user-1') {
  createClientMock.mockResolvedValue({
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: userId } }, error: null }),
    },
  } as any);
}

function signedOut() {
  createClientMock.mockResolvedValue({
    auth: {
      getUser: () => Promise.resolve({ data: { user: null }, error: { message: 'no session' } }),
    },
  } as any);
}

const dbRow = {
  id: 'profile-1',
  user_id: 'user-1',
  legal_name: 'Jane Doe',
  billing_email: 'jane@example.com',
  phone: null,
  company_name: null,
  gstin: null,
  state_code: '24',
  country_code: 'IN',
  address_line_1: null,
  address_line_2: null,
  city: null,
  postal_code: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  createAdminClientMock.mockReturnValue({} as any);
});

describe('getMyBillingProfile', () => {
  it('requires sign-in', async () => {
    signedOut();
    await expect(getMyBillingProfile()).rejects.toThrow('Please sign in');
    expect(loadBillingProfileMock).not.toHaveBeenCalled();
  });

  it('maps the DB row to camelCase', async () => {
    signedIn();
    loadBillingProfileMock.mockResolvedValueOnce({ status: 'ok', profile: dbRow as any });

    const result = await getMyBillingProfile();

    expect(result).toEqual({
      status: 'ok',
      profile: {
        id: 'profile-1',
        legalName: 'Jane Doe',
        billingEmail: 'jane@example.com',
        phone: null,
        companyName: null,
        gstin: null,
        // Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit B): derived, not stored --
        // 'business' iff gstin is set. dbRow.gstin is null here, so 'personal'.
        profileType: 'personal',
        stateCode: '24',
        countryCode: 'IN',
        region: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        postalCode: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
  });

  it('returns null when no profile exists yet', async () => {
    signedIn();
    loadBillingProfileMock.mockResolvedValueOnce({ status: 'ok', profile: null });

    const result = await getMyBillingProfile();

    expect(result).toEqual({ status: 'ok', profile: null });
  });

  it('passes through unavailable', async () => {
    signedIn();
    loadBillingProfileMock.mockResolvedValueOnce({ status: 'unavailable' });

    const result = await getMyBillingProfile();

    expect(result).toEqual({ status: 'unavailable' });
  });
});

describe('saveMyBillingProfile', () => {
  it('requires sign-in', async () => {
    signedOut();
    await expect(saveMyBillingProfile({ legalName: 'Jane', stateCode: '24' })).rejects.toThrow('Please sign in');
    expect(saveBillingProfileMock).not.toHaveBeenCalled();
  });

  it('maps the saved row back to camelCase', async () => {
    signedIn();
    saveBillingProfileMock.mockResolvedValueOnce({ status: 'ok', profile: dbRow as any });

    const result = await saveMyBillingProfile({ legalName: 'Jane Doe', stateCode: '24' });

    expect(result).toEqual({ status: 'ok', profile: expect.objectContaining({ id: 'profile-1', legalName: 'Jane Doe' }) });
    expect(saveBillingProfileMock).toHaveBeenCalledWith(expect.anything(), 'user-1', { legalName: 'Jane Doe', stateCode: '24' });
  });

  it('passes through an invalid result untouched', async () => {
    signedIn();
    saveBillingProfileMock.mockResolvedValueOnce({ status: 'invalid', message: 'bad state' });

    const result = await saveMyBillingProfile({ legalName: 'Jane Doe', stateCode: '99' });

    expect(result).toEqual({ status: 'invalid', message: 'bad state' });
  });

  it('passes through unavailable', async () => {
    signedIn();
    saveBillingProfileMock.mockResolvedValueOnce({ status: 'unavailable' });

    const result = await saveMyBillingProfile({ legalName: 'Jane Doe', stateCode: '24' });

    expect(result).toEqual({ status: 'unavailable' });
  });
});

describe('getBillingCountryOptions', () => {
  it('is just India while the international-countries flag is off', async () => {
    internationalCountriesMock.mockResolvedValueOnce([]);

    await expect(getBillingCountryOptions()).resolves.toEqual(['IN']);
  });

  it('appends the flag-allowed countries after India', async () => {
    internationalCountriesMock.mockResolvedValueOnce(['US']);

    await expect(getBillingCountryOptions()).resolves.toEqual(['IN', 'US']);
  });

  it('needs no sign-in', async () => {
    signedOut();
    internationalCountriesMock.mockResolvedValueOnce([]);

    await expect(getBillingCountryOptions()).resolves.toEqual(['IN']);
  });
});
