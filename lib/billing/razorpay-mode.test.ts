import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getRazorpayMode, RazorpayConfigError } from './razorpay';

const ORIGINAL_ENV = { ...process.env };

function setKeys(keyId: string | undefined, keySecret: string | undefined = 'secret') {
  if (keyId === undefined) {
    delete process.env.RAZORPAY_KEY_ID;
  } else {
    process.env.RAZORPAY_KEY_ID = keyId;
  }

  if (keySecret === undefined) {
    delete process.env.RAZORPAY_KEY_SECRET;
  } else {
    process.env.RAZORPAY_KEY_SECRET = keySecret;
  }
}

describe('getRazorpayMode', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('reads test mode from an rzp_test_ key', () => {
    setKeys('rzp_test_abc123');
    expect(getRazorpayMode()).toBe('test');
  });

  it('reads live mode from an rzp_live_ key', () => {
    setKeys('rzp_live_abc123');
    expect(getRazorpayMode()).toBe('live');
  });

  it('throws a RazorpayConfigError with reason unknown_key_prefix for an unrecognized prefix', () => {
    setKeys('rzp_sandbox_abc123');

    expect(() => getRazorpayMode()).toThrow(RazorpayConfigError);
    try {
      getRazorpayMode();
      expect.unreachable('expected getRazorpayMode to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RazorpayConfigError);
      expect((err as RazorpayConfigError).reason).toBe('unknown_key_prefix');
    }
  });

  it('throws a RazorpayConfigError with reason missing_keys when the key ID is absent', () => {
    setKeys(undefined);

    try {
      getRazorpayMode();
      expect.unreachable('expected getRazorpayMode to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RazorpayConfigError);
      expect((err as RazorpayConfigError).reason).toBe('missing_keys');
    }
  });
});
