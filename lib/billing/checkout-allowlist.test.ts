import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/ai/model-config', () => ({
  getFeatureFlag: vi.fn(),
  getFeatureFlagValue: vi.fn(),
}));

import { getFeatureFlag, getFeatureFlagValue } from '@/lib/ai/model-config';
import { isCheckoutOpenForUser } from './checkout-allowlist';

const getFeatureFlagMock = vi.mocked(getFeatureFlag);
const getFeatureFlagValueMock = vi.mocked(getFeatureFlagValue);

/**
 * Payments Phase 7 (docs/payments/phase-7-plan.md §8, Unit B2, decision R3): the named-account
 * rollout, isolated from prepareRazorpayCheckoutInternal's own tests (pricing-checkout.test.ts) so
 * every combination of flag state / listedness / sign-in state is pinned once, directly.
 */
describe('isCheckoutOpenForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is open when the flag row is missing entirely (getFeatureFlag falls back to false)', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(false);

    await expect(isCheckoutOpenForUser('user-1')).resolves.toBe(true);
    expect(getFeatureFlagValueMock).not.toHaveBeenCalled();
  });

  it('is open when the flag is explicitly off', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(false);

    await expect(isCheckoutOpenForUser('user-1')).resolves.toBe(true);
    expect(getFeatureFlagValueMock).not.toHaveBeenCalled();
  });

  it('is open for a listed user when the flag is on', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    getFeatureFlagValueMock.mockResolvedValueOnce('user-1,user-2');

    await expect(isCheckoutOpenForUser('user-1')).resolves.toBe(true);
  });

  it('matches case-insensitively against the stored list', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    getFeatureFlagValueMock.mockResolvedValueOnce('User-1');

    await expect(isCheckoutOpenForUser('user-1')).resolves.toBe(true);
  });

  it('is closed for an unlisted user when the flag is on', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    getFeatureFlagValueMock.mockResolvedValueOnce('user-2,user-3');

    await expect(isCheckoutOpenForUser('user-1')).resolves.toBe(false);
  });

  it('is closed for a signed-out visitor when the flag is on, without reading the list', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);

    await expect(isCheckoutOpenForUser(null)).resolves.toBe(false);
    expect(getFeatureFlagValueMock).not.toHaveBeenCalled();
  });

  it('is closed when the flag is on and the value is empty (migration 137 seed, before names are added)', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    getFeatureFlagValueMock.mockResolvedValueOnce('');

    await expect(isCheckoutOpenForUser('user-1')).resolves.toBe(false);
  });

  it('is closed when the flag is on and the value read fails (getFeatureFlagValue returns null)', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    getFeatureFlagValueMock.mockResolvedValueOnce(null);

    await expect(isCheckoutOpenForUser('user-1')).resolves.toBe(false);
  });
});
