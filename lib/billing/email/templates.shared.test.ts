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

  it('uses the renewal heading, escaping the plan name only in the html', () => {
    const result = buildPaymentReceiptEmail({
      appUrl: APP_URL,
      variant: 'renewal',
      itemLabel: 'Kissago Pro plan',
      planName: XSS_NAME,
      grossMinor: 19900,
      hasInvoice: true,
    });
    // subject/text are plain text (a mail client's subject line, a text/plain body) -- escaping them
    // would corrupt the name a reader actually sees, so they carry it raw.
    expect(result.subject).toBe(`Your ${XSS_NAME} plan renewed`);
    expect(result.text).toContain(`Your ${XSS_NAME} plan renewed`);
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

  it('escapes an untrusted plan name in the html only, keeping the subject raw', () => {
    const result = buildSubscriptionPaymentFailedEmail({
      appUrl: APP_URL,
      planName: XSS_NAME,
      graceEndsAt: '2026-10-05T00:00:00.000Z',
    });
    expect(result.subject).toBe(`We couldn't renew your ${XSS_NAME} plan`);
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
  it('links Restart to /plans, escaping the plan name in the html only', () => {
    const result = buildSubscriptionEndedEmail({ appUrl: APP_URL, planName: XSS_NAME });
    expect(result.subject).toBe(`Your ${XSS_NAME} plan has ended`);
    expect(result.text).toContain(`Your ${XSS_NAME} plan has ended`);
    expect(result.html).toContain(XSS_ESCAPED);
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

  it('escapes an untrusted plan name in the html only, keeping the subject raw', () => {
    const result = buildRenewalReminderEmail({
      appUrl: APP_URL,
      planName: XSS_NAME,
      renewsAt: '2026-12-25T00:00:00.000Z',
      grossMinor: 199900,
    });
    expect(result.subject).toBe(`Your ${XSS_NAME} plan renews on 25 Dec 2026 for ₹1,999.00`);
    expect(result.html).toContain(XSS_ESCAPED);
    expect(result.html).not.toContain('<script>alert(1)</script>');
  });
});

describe('buildDocumentResendEmail', () => {
  it('names the document, escaping it in the html only', () => {
    const result = buildDocumentResendEmail({ appUrl: APP_URL, documentNumber: XSS_NAME });
    expect(result.subject).toBe(`Your document ${XSS_NAME}`);
    expect(result.text).toContain(`Your document ${XSS_NAME}`);
    expect(result.html).toContain(XSS_ESCAPED);
    expect(result.html).not.toContain('<script>alert(1)</script>');
  });
});

describe('Payments Phase 6 C2 template fix -- subject/text are never escaped', () => {
  // The defect: every builder used to reuse the SAME (escaped) heading string for subject, html and
  // text, so a name with "&" arrived in a mail client's subject line as "&amp;" -- readable nowhere
  // outside a browser. This is a cross-cutting regression test for every kind whose heading carries
  // untrusted data, distinct from the per-kind escaping tests above (which check the html side).
  const AMPERSAND_NAME = 'Bed & Breakfast';

  it('buildPaymentReceiptEmail (renewal)', () => {
    const result = buildPaymentReceiptEmail({
      appUrl: APP_URL, variant: 'renewal', itemLabel: 'x', planName: AMPERSAND_NAME, grossMinor: 100, hasInvoice: false,
    });
    expect(result.subject).not.toContain('&amp;');
    expect(result.text).not.toContain('&amp;');
    expect(result.html).toContain('&amp;');
  });

  it('buildSubscriptionPaymentFailedEmail', () => {
    const result = buildSubscriptionPaymentFailedEmail({
      appUrl: APP_URL, planName: AMPERSAND_NAME, graceEndsAt: '2026-10-05T00:00:00.000Z',
    });
    expect(result.subject).not.toContain('&amp;');
    expect(result.text).not.toContain('&amp;');
    expect(result.html).toContain('&amp;');
  });

  it('buildSubscriptionEndedEmail', () => {
    const result = buildSubscriptionEndedEmail({ appUrl: APP_URL, planName: AMPERSAND_NAME });
    expect(result.subject).not.toContain('&amp;');
    expect(result.text).not.toContain('&amp;');
    expect(result.html).toContain('&amp;');
  });

  it('buildRenewalReminderEmail', () => {
    const result = buildRenewalReminderEmail({
      appUrl: APP_URL, planName: AMPERSAND_NAME, renewsAt: '2026-12-25T00:00:00.000Z', grossMinor: 100,
    });
    expect(result.subject).not.toContain('&amp;');
    expect(result.text).not.toContain('&amp;');
    expect(result.html).toContain('&amp;');
  });

  it('buildDocumentResendEmail', () => {
    const result = buildDocumentResendEmail({ appUrl: APP_URL, documentNumber: AMPERSAND_NAME });
    expect(result.subject).not.toContain('&amp;');
    expect(result.text).not.toContain('&amp;');
    expect(result.html).toContain('&amp;');
  });
});
