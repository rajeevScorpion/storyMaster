import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/actions/pricing-checkout', () => ({
  prepareRazorpayCheckoutInternal: vi.fn(),
}));

vi.mock('@/lib/viewer-profile', () => ({
  resolveActiveViewerProfile: vi.fn(),
}));

import { prepareRazorpayCheckoutInternal } from '@/app/actions/pricing-checkout';
import { resolveActiveViewerProfile } from '@/lib/viewer-profile';
import { CheckoutRefusalError } from '@/lib/billing/checkout-guard.shared';
import { POST } from './route';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1): modelled on
 * app/api/billing/razorpay/verify/route.test.ts -- mocks every module the route directly imports
 * (prepareRazorpayCheckoutInternal and resolveActiveViewerProfile) so the route's own wiring (which
 * inputs it forwards, how it maps errors to a status and a customer-visible message, the
 * Server-Timing header) is exercised without needing the whole checkout pipeline's database mocks.
 * The gate itself (kids/attestation) is unit-tested directly against the real
 * prepareRazorpayCheckoutInternal in app/actions/pricing-checkout.test.ts and against the pure
 * assertCheckoutAllowed in lib/billing/checkout-guard.shared.test.ts.
 */

const prepareRazorpayCheckoutInternalMock = vi.mocked(prepareRazorpayCheckoutInternal);
const resolveActiveViewerProfileMock = vi.mocked(resolveActiveViewerProfile);

function fakeViewerProfile(audienceMode: 'all' | 'kids') {
  return {
    id: null,
    displayName: 'Default',
    avatarEmoji: null,
    audienceMode,
    ageBand: null,
    isImplicitDefault: true,
  } as any;
}

function fakeCheckout(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'topup',
    keyId: 'rzp_test_key',
    internalOrderId: 'order-1',
    razorpayOrderId: 'order_rzp_1',
    amountMinor: 500,
    currencyCode: 'INR',
    displayName: 'Kissago',
    description: 'Small pack',
    userName: 'Jane Doe',
    userEmail: 'jane@example.com',
    userPhone: '+919876543210',
    reused: false,
    ...overrides,
  };
}

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/billing/razorpay/prepare', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveActiveViewerProfileMock.mockResolvedValue(fakeViewerProfile('all'));
});

describe('POST /api/billing/razorpay/prepare — kids and attestation', () => {
  it('refuses with the kids profile message when the active viewer profile is kids', async () => {
    resolveActiveViewerProfileMock.mockResolvedValue(fakeViewerProfile('kids'));
    prepareRazorpayCheckoutInternalMock.mockRejectedValueOnce(
      new CheckoutRefusalError('Switch to an adult profile to buy.', 'kids_profile', 403)
    );

    const response = await POST(
      postRequest({ input: { kind: 'topup', topupPackId: 'pack-1' }, adultAttested: true })
    );

    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.error).toBe('Switch to an adult profile to buy.');
    expect(prepareRazorpayCheckoutInternalMock).toHaveBeenCalledWith(
      { kind: 'topup', topupPackId: 'pack-1' },
      expect.objectContaining({ audienceMode: 'kids' })
    );
  });

  it('treats a missing adultAttested as false and surfaces the not_attested refusal', async () => {
    prepareRazorpayCheckoutInternalMock.mockRejectedValueOnce(
      new CheckoutRefusalError("Please confirm you're 18 or older and the one paying.", 'not_attested', 403)
    );

    const response = await POST(postRequest({ input: { kind: 'topup', topupPackId: 'pack-1' } }));

    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.error).toBe("Please confirm you're 18 or older and the one paying.");
    expect(prepareRazorpayCheckoutInternalMock).toHaveBeenCalledWith(
      { kind: 'topup', topupPackId: 'pack-1' },
      expect.objectContaining({ adultAttested: false })
    );
  });
});

describe('POST /api/billing/razorpay/prepare — error mapping', () => {
  it('returns a CheckoutRefusalError\'s own status and message', async () => {
    prepareRazorpayCheckoutInternalMock.mockRejectedValueOnce(
      new CheckoutRefusalError('Please sign in before starting checkout', 'sign_in_required', 401)
    );

    const response = await POST(
      postRequest({ input: { kind: 'topup', topupPackId: 'pack-1' }, adultAttested: true })
    );

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe('Please sign in before starting checkout');
  });

  it('never leaks an arbitrary/provider error message -- always the generic 500 sentence', async () => {
    prepareRazorpayCheckoutInternalMock.mockRejectedValueOnce(
      new Error('Razorpay: BAD_REQUEST_ERROR : Plan ID is invalid')
    );

    const response = await POST(
      postRequest({ input: { kind: 'topup', topupPackId: 'pack-1' }, adultAttested: true })
    );

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('BAD_REQUEST_ERROR');
    expect(text).not.toContain('Plan ID is invalid');
    expect(text).toContain("couldn't start checkout");
  });
});

describe('POST /api/billing/razorpay/prepare — success', () => {
  it('sets a Server-Timing header and returns the prepared checkout', async () => {
    prepareRazorpayCheckoutInternalMock.mockResolvedValueOnce(fakeCheckout() as any);

    const response = await POST(
      postRequest({ input: { kind: 'topup', topupPackId: 'pack-1' }, adultAttested: true })
    );

    expect(response.status).toBe(200);
    // The timer records no marks here because prepareRazorpayCheckoutInternal is mocked -- this only
    // asserts the route always sets the header, not what it contains once real steps run.
    expect(response.headers.get('Server-Timing')).not.toBeNull();
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.checkout).toMatchObject({ internalOrderId: 'order-1' });
  });
});
