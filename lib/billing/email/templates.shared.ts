/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §4 Unit C1): the billing email copy. Pure and
 * isomorphic -- no network, no server-only import -- so the templates can be unit-tested directly and
 * (later) previewed client-side without pulling in Resend or Supabase. One function per
 * `billing_notification_jobs.kind` value (migration 135's CHECK), each returning the full
 * `{subject, html, text}` a caller hands straight to `sendBillingEmail`.
 *
 * `appUrl` is a plain input rather than read from `process.env` here, on purpose: a pure module reads
 * nothing from the environment, so the same render is reproducible in a test and identical whether the
 * caller resolved APP_URL, NEXT_PUBLIC_APP_URL or VERCEL_URL (lib/billing/notifications/runner.ts's
 * baseUrl() does that resolution, mirroring lib/media/image-job-runner.ts's).
 *
 * Every string that came from data -- a plan name, a document number, a pack name -- is HTML-escaped
 * before it reaches the html field. Fixed copy (headings, button labels) is written directly; nothing
 * here ever needs to be escaped twice.
 *
 * `formatInr` always shows two decimal places ("₹531.00"), unlike wallet-tax.shared.ts's
 * `formatCurrencyMinor`, which drops the fraction on a whole rupee -- the plan's own copy examples
 * ("Payment received — ₹531.00") show paise unconditionally, and a receipt is a legal-adjacent
 * document where consistent formatting matters more than shortening a round number.
 */

import { formatIstDate } from '@/lib/billing/documents/document-view.shared';
import { LEGAL_ENTITY_NAME, LEGAL_FULL_ADDRESS } from '@/lib/legal/business-config';

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Always two decimal places, always the ₹ symbol -- see the file header for why this differs from
 * wallet-tax.shared.ts's conditional formatter. */
export function formatInr(amountMinor: number): string {
  const amount = Number.isFinite(amountMinor) ? amountMinor / 100 : 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

interface ShellInput {
  appUrl: string;
  /** Plain text, already escaped by the caller if it carries data. May include a handful of inline
   * tags (`<strong>`, `<br/>`) the caller builds itself from already-escaped pieces. */
  heading: string;
  bodyHtml: string;
  buttonLabel: string;
  buttonUrl: string;
}

/** One heading, one short body, one button, a footer naming the seller -- the shared shape every kind
 * below fills in. Table-based layout and inline styles only: this is read inside email clients, not a
 * browser. */
function renderHtml(input: ShellInput): string {
  const mark = `${input.appUrl}/brand/checkout-mark`;
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:24px 32px 0 32px;text-align:center;">
                <img src="${mark}" width="40" height="40" alt="Kissago" style="display:inline-block;border:0;" />
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 0 32px;">
                <h1 style="font-size:20px;line-height:28px;margin:0 0 12px 0;color:#111827;">${input.heading}</h1>
                <div style="font-size:14px;line-height:22px;color:#3f3f46;">${input.bodyHtml}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px 32px;">
                <a href="${input.buttonUrl}" style="display:inline-block;background-color:#059669;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;">${input.buttonLabel}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 24px 32px;border-top:1px solid #e4e4e7;font-size:12px;line-height:18px;color:#71717a;">
                <p style="margin:0 0 4px 0;">You get this because you bought from ${escapeHtml(LEGAL_ENTITY_NAME)} (Kissago).</p>
                <p style="margin:0;">${escapeHtml(LEGAL_FULL_ADDRESS)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

interface ShellTextInput {
  heading: string;
  bodyLines: string[];
  buttonLabel: string;
  buttonUrl: string;
}

function renderText(input: ShellTextInput): string {
  return [
    input.heading,
    '',
    ...input.bodyLines,
    '',
    `${input.buttonLabel}: ${input.buttonUrl}`,
    '',
    'You get this because you bought from Kissago.',
    LEGAL_FULL_ADDRESS,
  ].join('\n');
}

function billingUrl(appUrl: string): string {
  return `${appUrl}/account/billing`;
}

// --- payment_receipt -------------------------------------------------------------------------------

export interface PaymentReceiptEmailInput {
  appUrl: string;
  /** 'receipt' for a top-up or a subscription's first payment; 'renewal' for a subscription renewal --
   * same body shape, different heading (plan §4: "renewal: the same, 'Your <Plan> plan renewed'"). */
  variant: 'receipt' | 'renewal';
  /** "120 Coins" or "Kissago Pro plan" -- whatever the line item builder (Unit A3) named it. */
  itemLabel: string;
  /** Required only for the renewal heading; ignored for 'receipt'. */
  planName?: string | null;
  grossMinor: number;
  /** False when billing_document_issuing_enabled was off at issue time -- the receipt still sends,
   * just without the "invoice attached" line or an attachment (plan §6). */
  hasInvoice: boolean;
}

export function buildPaymentReceiptEmail(input: PaymentReceiptEmailInput): EmailContent {
  const amount = formatInr(input.grossMinor);
  const itemLabel = escapeHtml(input.itemLabel);
  const heading = input.variant === 'renewal'
    ? `Your ${escapeHtml(input.planName ?? 'Kissago')} plan renewed`
    : `Payment received — ${amount}`;
  const invoiceHtml = input.hasInvoice ? ' The invoice is attached to this email.' : '';
  const invoiceText = input.hasInvoice ? ' The invoice is attached to this email.' : '';

  return {
    subject: heading,
    html: renderHtml({
      appUrl: input.appUrl,
      heading,
      bodyHtml: `<p style="margin:0 0 12px 0;">Your payment of <strong>${amount}</strong> for <strong>${itemLabel}</strong> was received.${invoiceHtml}</p>`,
      buttonLabel: 'View billing',
      buttonUrl: billingUrl(input.appUrl),
    }),
    text: renderText({
      heading,
      bodyLines: [`Your payment of ${amount} for ${input.itemLabel} was received.${invoiceText}`],
      buttonLabel: 'View billing',
      buttonUrl: billingUrl(input.appUrl),
    }),
  };
}

// --- refund_processed -------------------------------------------------------------------------------

export interface RefundProcessedEmailInput {
  appUrl: string;
  grossMinor: number;
  /** False when the payment was never invoiced (plan §2: "a credit note needs an issued original
   * invoice") -- the refund still emails, just with no credit note attached. */
  hasCreditNote: boolean;
}

export function buildRefundProcessedEmail(input: RefundProcessedEmailInput): EmailContent {
  const amount = formatInr(input.grossMinor);
  const heading = `Refund of ${amount} processed`;
  const creditNoteHtml = input.hasCreditNote ? ' The credit note is attached to this email.' : '';
  const creditNoteText = input.hasCreditNote ? ' The credit note is attached to this email.' : '';

  return {
    subject: heading,
    html: renderHtml({
      appUrl: input.appUrl,
      heading,
      bodyHtml: `<p style="margin:0;">Banks take 5-7 working days to show it in your account.${creditNoteHtml}</p>`,
      buttonLabel: 'View billing',
      buttonUrl: billingUrl(input.appUrl),
    }),
    text: renderText({
      heading,
      bodyLines: [`Banks take 5-7 working days to show it in your account.${creditNoteText}`],
      buttonLabel: 'View billing',
      buttonUrl: billingUrl(input.appUrl),
    }),
  };
}

// --- subscription_payment_failed --------------------------------------------------------------------

export interface SubscriptionPaymentFailedEmailInput {
  appUrl: string;
  planName: string;
  /** ISO timestamp -- when access actually ends if every retry fails. */
  graceEndsAt: string;
  /** Razorpay's own subscription short_url, when known -- takes the reader straight to update their
   * payment method there instead of Kissago's own billing page. */
  shortUrl?: string | null;
}

export function buildSubscriptionPaymentFailedEmail(input: SubscriptionPaymentFailedEmailInput): EmailContent {
  const planName = escapeHtml(input.planName);
  const heading = `We couldn't renew your ${planName} plan`;
  const graceDate = formatIstDate(input.graceEndsAt);
  const buttonUrl = input.shortUrl?.trim() || billingUrl(input.appUrl);

  return {
    subject: heading,
    html: renderHtml({
      appUrl: input.appUrl,
      heading,
      bodyHtml: `<p style="margin:0;">Razorpay will retry the payment automatically. Your access continues until <strong>${graceDate}</strong>.</p>`,
      buttonLabel: 'Update payment',
      buttonUrl,
    }),
    text: renderText({
      heading,
      bodyLines: [`Razorpay will retry the payment automatically. Your access continues until ${graceDate}.`],
      buttonLabel: 'Update payment',
      buttonUrl,
    }),
  };
}

// --- cancel_scheduled --------------------------------------------------------------------------------

export interface CancelScheduledEmailInput {
  appUrl: string;
  /** ISO timestamp -- the current cycle's end, when the subscription actually stops. */
  accessUntil: string;
}

export function buildCancelScheduledEmail(input: CancelScheduledEmailInput): EmailContent {
  const untilDate = formatIstDate(input.accessUntil);
  const heading = `Your plan won't renew — access until ${untilDate}`;

  return {
    subject: heading,
    html: renderHtml({
      appUrl: input.appUrl,
      heading,
      bodyHtml: `<p style="margin:0;">Your subscription is set to cancel and won't renew. You'll keep full access until then.</p>`,
      buttonLabel: 'Manage plan',
      buttonUrl: billingUrl(input.appUrl),
    }),
    text: renderText({
      heading,
      bodyLines: [`Your subscription is set to cancel and won't renew. You'll keep full access until ${untilDate}.`],
      buttonLabel: 'Manage plan',
      buttonUrl: billingUrl(input.appUrl),
    }),
  };
}

// --- subscription_ended ------------------------------------------------------------------------------

export interface SubscriptionEndedEmailInput {
  appUrl: string;
  planName: string;
}

export function buildSubscriptionEndedEmail(input: SubscriptionEndedEmailInput): EmailContent {
  const planName = escapeHtml(input.planName);
  const heading = `Your ${planName} plan has ended`;

  return {
    subject: heading,
    html: renderHtml({
      appUrl: input.appUrl,
      heading,
      bodyHtml: `<p style="margin:0;">Billing has stopped and your plan has ended. You can restart anytime.</p>`,
      buttonLabel: 'Restart',
      buttonUrl: `${input.appUrl}/plans`,
    }),
    text: renderText({
      heading,
      bodyLines: ['Billing has stopped and your plan has ended. You can restart anytime.'],
      buttonLabel: 'Restart',
      buttonUrl: `${input.appUrl}/plans`,
    }),
  };
}

// --- renewal_reminder --------------------------------------------------------------------------------

export interface RenewalReminderEmailInput {
  appUrl: string;
  planName: string;
  /** ISO timestamp -- the upcoming renewal date (the annual sweep fires 6-8 days ahead). */
  renewsAt: string;
  grossMinor: number;
}

export function buildRenewalReminderEmail(input: RenewalReminderEmailInput): EmailContent {
  const planName = escapeHtml(input.planName);
  const renewDate = formatIstDate(input.renewsAt);
  const amount = formatInr(input.grossMinor);
  const heading = `Your ${planName} plan renews on ${renewDate} for ${amount}`;

  return {
    subject: heading,
    html: renderHtml({
      appUrl: input.appUrl,
      heading,
      bodyHtml: `<p style="margin:0;">This is a reminder that your annual plan is about to renew. No action is needed unless you want to make changes.</p>`,
      buttonLabel: 'Manage plan',
      buttonUrl: billingUrl(input.appUrl),
    }),
    text: renderText({
      heading,
      bodyLines: ['This is a reminder that your annual plan is about to renew. No action is needed unless you want to make changes.'],
      buttonLabel: 'Manage plan',
      buttonUrl: billingUrl(input.appUrl),
    }),
  };
}

// --- document_resend ---------------------------------------------------------------------------------

export interface DocumentResendEmailInput {
  appUrl: string;
  documentNumber: string;
}

export function buildDocumentResendEmail(input: DocumentResendEmailInput): EmailContent {
  const documentNumber = escapeHtml(input.documentNumber);
  const heading = `Your document ${documentNumber}`;

  return {
    subject: heading,
    html: renderHtml({
      appUrl: input.appUrl,
      heading,
      bodyHtml: `<p style="margin:0;">The document you requested is attached to this email.</p>`,
      buttonLabel: 'View billing',
      buttonUrl: billingUrl(input.appUrl),
    }),
    text: renderText({
      heading,
      bodyLines: ['The document you requested is attached to this email.'],
      buttonLabel: 'View billing',
      buttonUrl: billingUrl(input.appUrl),
    }),
  };
}
