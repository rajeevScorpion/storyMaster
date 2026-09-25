import { describe, it, expect } from 'vitest';

import {
  OPERATIONAL_FLAG_DEFINITIONS,
  OPERATIONAL_FLAG_GROUP_LABELS,
  findOperationalFlag,
  isOperationalFlagKey,
} from './operational-flags.shared';

describe('operational flag registry', () => {
  it('only admits keys it defines -- the setter\'s guard against writing an arbitrary flag', () => {
    expect(isOperationalFlagKey('account_deletion_enabled')).toBe(true);
    expect(isOperationalFlagKey('billing_reconcile_enabled')).toBe(true);
    expect(isOperationalFlagKey('billing_document_issuing_enabled')).toBe(true);

    expect(isOperationalFlagKey('pricing_checkout_enabled')).toBe(false); // a pricing runtime setting
    expect(isOperationalFlagKey('image_batch_scope')).toBe(false); // carries JSON in `value`
    expect(isOperationalFlagKey('')).toBe(false);
    expect(isOperationalFlagKey('anything_else')).toBe(false);
  });

  it('every flag fails closed, so an absent row can never read as on', () => {
    for (const flag of OPERATIONAL_FLAG_DEFINITIONS) {
      expect(flag.defaultEnabled, `default for ${flag.key}`).toBe(false);
    }
  });

  it('gives every flag the wording an admin needs to decide, and distinct on/off text', () => {
    for (const flag of OPERATIONAL_FLAG_DEFINITIONS) {
      expect(flag.label.length, `label for ${flag.key}`).toBeGreaterThan(0);
      expect(flag.description.length, `description for ${flag.key}`).toBeGreaterThan(0);
      expect(flag.enabledHelp.length, `enabledHelp for ${flag.key}`).toBeGreaterThan(0);
      expect(flag.disabledHelp.length, `disabledHelp for ${flag.key}`).toBeGreaterThan(0);
      // "off is just the opposite" is what makes these panels useless -- the two must differ.
      expect(flag.enabledHelp, `help text for ${flag.key}`).not.toBe(flag.disabledHelp);
    }
  });

  it("tells whoever flips the deletion flag to reseed the pages that contradict it", () => {
    // The Terms and /docs seeds say self-serve deletion does not exist, which is true only while
    // this flag is off. The live managed_pages rows are not updated by deploying -- someone has to
    // reset them to seed -- so the reminder has to live where the decision is made.
    const deletion = findOperationalFlag('account_deletion_enabled');
    expect(deletion?.beforeEnabling).toMatch(/reseed/i);
    expect(deletion?.beforeEnabling).toMatch(/terms/i);
  });

  it('never carries an empty beforeEnabling -- absent means "nothing to do", not "unwritten"', () => {
    for (const flag of OPERATIONAL_FLAG_DEFINITIONS) {
      if (flag.beforeEnabling !== undefined) {
        expect(flag.beforeEnabling.length, `beforeEnabling for ${flag.key}`).toBeGreaterThan(0);
      }
    }
  });

  it('never repeats a key', () => {
    const keys = OPERATIONAL_FLAG_DEFINITIONS.map((flag) => flag.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('labels every group it uses', () => {
    for (const flag of OPERATIONAL_FLAG_DEFINITIONS) {
      expect(OPERATIONAL_FLAG_GROUP_LABELS[flag.group], `group label for ${flag.key}`).toBeTruthy();
    }
  });

  it('finds a flag by key and nothing by an unknown one', () => {
    expect(findOperationalFlag('billing_reconcile_enabled')?.label).toBe('Daily payment reconciliation');
    expect(findOperationalFlag('nope')).toBeUndefined();
  });

  it('matches the flag keys the code actually reads', () => {
    // These strings are duplicated in app/actions/account.ts, app/actions/admin-billing-actions.ts,
    // lib/billing/razorpay-reconcile.ts and lib/billing/ledger.ts. A rename there with no rename here
    // would leave the panel silently toggling a row nothing reads.
    expect(OPERATIONAL_FLAG_DEFINITIONS.map((flag) => flag.key).sort()).toEqual([
      'account_deletion_enabled',
      'billing_admin_actions_enabled',
      'billing_checkout_allowlist',
      'billing_document_issuing_enabled',
      'billing_emails_enabled',
      'billing_reconcile_enabled',
    ]);
  });
});
