import { describe, it, expect } from 'vitest';
import {
  buildCancelScheduledEmail,
  buildDocumentResendEmail,
  buildPaymentReceiptEmail,
  buildRefundProcessedEmail,
  buildRenewalReminderEmail,
  buildSubscriptionEndedEmail,
  buildSubscriptionPaymentFailedEmail,
  formatInr,
} from './templates.shared';

const APP_URL = 'https://kissago.cc';
const XSS_NAME = '<script>alert(1)</script>&"\'';
const XSS_ESCAPED = '&lt;script&gt;alert(1)&lt;/script&gt;&amp;&quot;&#39;';

describe('formatInr', () => {
  it('always shows two decimal places, even on a whole rupee', () => {
    expect(formatInr(53100)).toBe('₹531.00');
    expect(formatInr(100)).toBe('₹1.00');
  });

  it('shows paise for a non-round amount', () => {
    expect(formatInr(53182)).toBe('₹531.82');
  });

  it('never throws on a non-finite amount', () => {
    expect(formatInr(Number.NaN)).toBe('₹0.00');
  });
});

describe('buildPaymentReceiptEmail', () => {
  it('renders the receipt variant with the amount and item label', () => {
    const result = buildPaymentReceiptEmail({
      appUrl: APP_URL,
      variant: 'receipt',
      itemLabel: '120 Coins',
      grossMinor: 53100,
      hasInvoice: true,
    });
    expect(result.subject).toBe('Payment received — ₹531.00');
    expect(result.html).toContain('₹531.00');
    expect(result.html).toContain('120 Coins');
    expect(result.html).toContain('The invoice is attached to this email.');
    expect(result.html).toContain(`${APP_URL}/account/billing`);
    expect(result.html).toContain(`${APP_URL}/brand/checkout-mark`);
    expect(result.text).toContain('₹531.00');
    expect(result.text).toContain(`${APP_URL}/account/billing`);
  });

  it('omits the invoice line when the document was not issued', () => {
    const result = buildPaymentReceiptEmail({
      appUrl: APP_URL,
      variant: 'receipt',
      itemLabel: '120 Coins',
      grossMinor: 53100,
      hasInvoice: false,
    });
    expect(result.html).not.toContain('invoice is attached');
    expect(result.text).not.toContain('invoice is attached');
  });

  it('uses the renewal heading and escapes the plan name', () => {
    const result = buildPaymentReceiptEmail({
      appUrl: APP_URL,
      variant: 'renewal',
      itemLabel: 'Kissago Pro plan',
      planName: XSS_NAME,
      grossMinor: 19900,
      hasInvoice: true,
    });
    expect(result.subject).toBe(`Your ${XSS_ESCAPED} plan renewed`);
    expect(result.html).toContain(XSS_ESCAPED);
    expect(result.html).not.toContain('<script>alert(1)</script>');
  });
});

describe('buildRefundProcessedEmail', () => {
  it('mentions the bank timeline and the amount', () => {
    const result = buildRefundProcessedEmail({ appUrl: APP_URL, grossMinor: 53100, hasCreditNote: false });
    expect(result.subject).toBe('Refund of ₹531.00 processed');
    expect(result.html).toContain('5-7 working days');
    expect(result.html).not.toContain('credit note is attached');
  });

  it('mentions the credit note when one was issued', () => {
    const result = buildRefundProcessedEmail({ appUrl: APP_URL, grossMinor: 53100, hasCreditNote: true });
    expect(result.html).toContain('The credit note is attached to this email.');
    expect(result.text).toContain('The credit note is attached to this email.');
  });
});

describe('buildSubscriptionPaymentFailedEmail', () => {
  it('links the update-payment button to the subscription short_url when known', () => {
    const result = buildSubscriptionPaymentFailedEmail({
      appUrl: APP_URL,
      planName: 'Kissago Pro',
      graceEndsAt: '2026-10-05T00:00:00.000Z',
      shortUrl: 'https://rzp.io/i/abc123',
    });
    expect(result.subject).toBe("We couldn't renew your Kissago Pro plan");
    expect(result.html).toContain('https://rzp.io/i/abc123');
    expect(result.html).not.toContain(`${APP_URL}/account/billing`);
  });

  it('falls back to /account/billing without a short_url', () => {
    const result = buildSubscriptionPaymentFailedEmail({
      appUrl: APP_URL,
      planName: 'Kissago Pro',
      graceEndsAt: '2026-10-05T00:00:00.000Z',
      shortUrl: null,
    });
    expect(result.html).toContain(`${APP_URL}/account/billing`);
  });

  it('escapes an untrusted plan name', () => {
    const result = buildSubscriptionPaymentFailedEmail({
      appUrl: APP_URL,
      planName: XSS_NAME,
      graceEndsAt: '2026-10-05T00:00:00.000Z',
    });
    expect(result.html).toContain(XSS_ESCAPED);
    expect(result.html).not.toContain('<script>alert(1)</script>');
  });
});

describe('buildCancelScheduledEmail', () => {
  it('shows the access-until date in the heading', () => {
    const result = buildCancelScheduledEmail({ appUrl: APP_URL, accessUntil: '2026-11-01T00:00:00.000Z' });
    expect(result.subject).toBe("Your plan won't renew — access until 1 Nov 2026");
    expect(result.html).toContain(`${APP_URL}/account/billing`);
  });
});

describe('buildSubscriptionEndedEmail', () => {
  it('links Restart to /plans and escapes the plan name', () => {
    const result = buildSubscriptionEndedEmail({ appUrl: APP_URL, planName: XSS_NAME });
    expect(result.subject).toBe(`Your ${XSS_ESCAPED} plan has ended`);
    expect(result.html).toContain(`${APP_URL}/plans`);
    expect(result.html).not.toContain('<script>alert(1)</script>');
  });
});

describe('buildRenewalReminderEmail', () => {
  it('shows the plan, date and amount in the heading', () => {
    const result = buildRenewalReminderEmail({
      appUrl: APP_URL,
      planName: 'Kissago Pro',
      renewsAt: '2026-12-25T00:00:00.000Z',
      grossMinor: 199900,
    });
    expect(result.subject).toBe('Your Kissago Pro plan renews on 25 Dec 2026 for ₹1,999.00');
    expect(result.html).toContain(`${APP_URL}/account/billing`);
  });
});

describe('buildDocumentResendEmail', () => {
  it('names the document and escapes it', () => {
    const result = buildDocumentResendEmail({ appUrl: APP_URL, documentNumber: XSS_NAME });
    expect(result.subject).toBe(`Your document ${XSS_ESCAPED}`);
    expect(result.html).toContain(XSS_ESCAPED);
    expect(result.html).not.toContain('<script>alert(1)</script>');
  });
});
