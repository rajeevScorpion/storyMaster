import { describe, it, expect } from 'vitest';
import { redactRazorpayPayload } from './razorpay-redact.shared';

describe('redactRazorpayPayload', () => {
  it('redacts PII keys nested at any depth', () => {
    const input = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_123',
            email: 'user@example.com',
            contact: '+911234567890',
            vpa: 'user@upi',
            card: { last4: '1234' },
            bank_account: { account_number: '000111222' },
            wallet: 'paytm',
            notes: {
              address: '221B Baker Street',
              user_id: 'user-1',
            },
          },
        },
      },
    };

    const result = redactRazorpayPayload(input) as any;

    expect(result.payload.payment.entity.email).toBe('[redacted]');
    expect(result.payload.payment.entity.contact).toBe('[redacted]');
    expect(result.payload.payment.entity.vpa).toBe('[redacted]');
    expect(result.payload.payment.entity.card).toBe('[redacted]');
    expect(result.payload.payment.entity.bank_account).toBe('[redacted]');
    expect(result.payload.payment.entity.wallet).toBe('[redacted]');
    expect(result.payload.payment.entity.notes.address).toBe('[redacted]');
  });

  it('keeps ids and other non-PII fields untouched', () => {
    const input = {
      id: 'pay_123',
      order_id: 'order_456',
      status: 'captured',
      amount: 1000,
      notes: { user_id: 'user-1', plan_version_id: 'plan-1' },
    };

    const result = redactRazorpayPayload(input);

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });

  it('redacts entries inside arrays', () => {
    const input = {
      items: [
        { id: 'pay_1', email: 'a@example.com' },
        { id: 'pay_2', email: 'b@example.com' },
      ],
    };

    const result = redactRazorpayPayload(input);

    expect(result.items[0].email).toBe('[redacted]');
    expect(result.items[1].email).toBe('[redacted]');
    expect(result.items[0].id).toBe('pay_1');
  });

  it('passes through primitives and null unchanged', () => {
    expect(redactRazorpayPayload(null)).toBeNull();
    expect(redactRazorpayPayload(42)).toBe(42);
    expect(redactRazorpayPayload('plain string')).toBe('plain string');
  });
});
