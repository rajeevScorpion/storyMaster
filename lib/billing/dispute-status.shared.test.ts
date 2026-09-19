import { describe, it, expect } from 'vitest';
import { resolveDisputeOutcome } from './dispute-status.shared';

describe('resolveDisputeOutcome', () => {
  it('reads an opening dispute as open', () => {
    expect(resolveDisputeOutcome('payment.dispute.created', 'open')).toBe('open');
  });

  it('treats a dispute under review as still open — no money has moved', () => {
    expect(resolveDisputeOutcome('payment.dispute.under_review', 'under_review')).toBe('open');
  });

  it('reads a lost dispute as lost, the only outcome that debits the merchant', () => {
    expect(resolveDisputeOutcome('payment.dispute.lost', 'lost')).toBe('lost');
  });

  it('reads a won dispute as won', () => {
    expect(resolveDisputeOutcome('payment.dispute.won', 'won')).toBe('won');
  });

  it('keeps a close distinct from won and lost rather than guessing which it was', () => {
    expect(resolveDisputeOutcome('payment.dispute.closed', 'closed')).toBe('closed');
  });

  it('falls back to the event name when the payload carries no entity status', () => {
    expect(resolveDisputeOutcome('payment.dispute.won')).toBe('won');
    expect(resolveDisputeOutcome('payment.dispute.lost', null)).toBe('lost');
    expect(resolveDisputeOutcome('payment.dispute.closed', undefined)).toBe('closed');
  });

  it('reads the entity status when the event name is the generic created', () => {
    // A created event redelivered after the dispute moved on carries the newer status.
    expect(resolveDisputeOutcome('payment.dispute.created', 'lost')).toBe('lost');
  });

  it('prefers a money outcome over a close, whichever source carries it', () => {
    // Razorpay can close the entity while sending the outcome event.
    expect(resolveDisputeOutcome('payment.dispute.lost', 'closed')).toBe('lost');
    expect(resolveDisputeOutcome('payment.dispute.closed', 'won')).toBe('won');
  });

  it('prefers the entity status when the two sources claim different money outcomes', () => {
    expect(resolveDisputeOutcome('payment.dispute.won', 'lost')).toBe('lost');
  });

  it('never lets a close or an open downgrade a settled outcome', () => {
    expect(resolveDisputeOutcome('payment.dispute.created', 'won')).toBe('won');
    expect(resolveDisputeOutcome('payment.dispute.closed', 'open')).toBe('closed');
  });

  it('is case- and whitespace-insensitive about the entity status', () => {
    expect(resolveDisputeOutcome('payment.dispute.created', ' LOST ')).toBe('lost');
  });

  it('falls back to open for anything it does not recognise, never asserting a settlement', () => {
    expect(resolveDisputeOutcome('payment.dispute.action_required')).toBe('open');
    expect(resolveDisputeOutcome('payment.dispute.something_new', 'brand_new')).toBe('open');
    expect(resolveDisputeOutcome('account.updated')).toBe('open');
    expect(resolveDisputeOutcome('payment.dispute.', '')).toBe('open');
  });
});
