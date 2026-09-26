import { describe, it, expect } from 'vitest';

import {
  canCloseCheckoutSheet,
  nextCheckoutSheetState,
  type CheckoutSheetEvent,
  type CheckoutSheetState,
} from './checkout-sheet.shared';

const ALL_STATES: CheckoutSheetState[] = [
  'quoting',
  'summary',
  'needs_details',
  'quote_error',
  'opening',
  'window',
  'verifying',
  'checking',
  'success',
  'confirming',
  'still_confirming',
  'failed',
];

const ALL_EVENTS: CheckoutSheetEvent[] = [
  'quote_ok',
  'quote_needs_details',
  'quote_error',
  'continue',
  'window_opened',
  'prepare_failed',
  'verifying',
  'checking',
  'success',
  'confirming',
  'still_confirming',
  'failed',
  'dismissed',
  'retry',
];

describe('nextCheckoutSheetState — the documented path', () => {
  it('walks quoting -> summary -> opening -> window -> verifying -> success', () => {
    let state: CheckoutSheetState = 'quoting';
    state = nextCheckoutSheetState(state, 'quote_ok');
    expect(state).toBe('summary');
    state = nextCheckoutSheetState(state, 'continue');
    expect(state).toBe('opening');
    state = nextCheckoutSheetState(state, 'window_opened');
    expect(state).toBe('window');
    state = nextCheckoutSheetState(state, 'verifying');
    expect(state).toBe('verifying');
    state = nextCheckoutSheetState(state, 'success');
    expect(state).toBe('success');
  });

  it('walks window -> checking -> confirming -> still_confirming', () => {
    let state: CheckoutSheetState = 'window';
    state = nextCheckoutSheetState(state, 'checking');
    expect(state).toBe('checking');
    state = nextCheckoutSheetState(state, 'confirming');
    expect(state).toBe('confirming');
    state = nextCheckoutSheetState(state, 'still_confirming');
    expect(state).toBe('still_confirming');
  });

  it('lets confirming resolve straight to success once the poll finds it paid', () => {
    expect(nextCheckoutSheetState('confirming', 'success')).toBe('success');
  });

  it('returns to summary on a prepare rejection, keeping the checkbox state to the caller', () => {
    expect(nextCheckoutSheetState('opening', 'prepare_failed')).toBe('summary');
  });

  it("returns to summary when Razorpay's open() throws after the window phase fired", () => {
    expect(nextCheckoutSheetState('window', 'prepare_failed')).toBe('summary');
  });

  it('returns to summary on a plain dismissal from checking', () => {
    expect(nextCheckoutSheetState('checking', 'dismissed')).toBe('summary');
  });

  it('returns to summary from failed on retry', () => {
    expect(nextCheckoutSheetState('failed', 'retry')).toBe('summary');
  });

  it.each(['needs_details', 'quote_error'] as const)('quoting reaches %s on its matching event', (target) => {
    const event = target === 'needs_details' ? 'quote_needs_details' : 'quote_error';
    expect(nextCheckoutSheetState('quoting', event)).toBe(target);
  });
});

describe('nextCheckoutSheetState — no path reaches failed from confirming or still_confirming', () => {
  it.each(['confirming', 'still_confirming'] as const)('every event from %s either stays or goes to a non-failed state', (state) => {
    for (const event of ALL_EVENTS) {
      expect(nextCheckoutSheetState(state, event)).not.toBe('failed');
    }
  });
});

describe('nextCheckoutSheetState — unmatched events are no-ops', () => {
  it('ignores every event that does not apply to the current state', () => {
    for (const state of ALL_STATES) {
      // 'quote_ok' only applies to 'quoting' -- every other state should be unaffected by it.
      if (state !== 'quoting') {
        expect(nextCheckoutSheetState(state, 'quote_ok')).toBe(state);
      }
    }
  });
});

describe('canCloseCheckoutSheet', () => {
  it('is false only while the Razorpay window is live or a verify/dismiss check is running', () => {
    for (const state of ALL_STATES) {
      const shouldBeClosable = state !== 'opening' && state !== 'verifying' && state !== 'checking';
      expect(canCloseCheckoutSheet(state)).toBe(shouldBeClosable);
    }
  });
});
