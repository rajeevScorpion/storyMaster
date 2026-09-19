/**
 * The plain `feature_flags` rows an admin needs to reach without SQL.
 *
 * Two separate mechanisms exist for switches in this app, and they are not interchangeable. Pricing
 * runtime settings live in `PRICING_RUNTIME_SETTING_DEFINITIONS` (lib/types/pricing.ts), are edited in
 * the pricing studio, and are audited into `pricing_publish_audit` as `runtime_setting`. Everything
 * else is a bare row in `feature_flags`, read through `getFeatureFlag` — and until this module there
 * was nowhere to flip one but the Supabase dashboard, which is why `billing_reconcile_enabled` has
 * never had a UI.
 *
 * This registry is deliberately a closed list rather than "every row in the table": the setter only
 * accepts a key that appears here, so the panel can never invent a flag key or flip an internal one
 * (`image_batch_scope`, say, whose `value` column carries JSON and whose `enabled` means something
 * else entirely). Adding a flag to the panel is a deliberate act of adding it here, with the wording
 * an admin needs to make the decision.
 *
 * Pure and isomorphic: the client panel and the server action import the same list.
 */

export interface OperationalFlagDefinition {
  key: string;
  label: string;
  /** What the switch governs, in one line. */
  description: string;
  /** What being on actually means, in the app, to a person. */
  enabledHelp: string;
  /** What being off means. Never just "the opposite" — say what stops. */
  disabledHelp: string;
  /**
   * A step that has to happen alongside turning this on, shown only while the flag is off -- i.e.
   * at the moment someone is about to flip it. For work the switch itself cannot do, so it would
   * otherwise be remembered or not.
   */
  beforeEnabling?: string;
  /** The value `getFeatureFlag` falls back to when the row is absent. Every flag here fails closed. */
  defaultEnabled: false;
  group: 'billing';
}

export const OPERATIONAL_FLAG_DEFINITIONS: readonly OperationalFlagDefinition[] = [
  {
    key: 'account_deletion_enabled',
    label: 'Self-serve account deletion',
    description: 'Lets a signed-in person delete their own account from /account/delete.',
    enabledHelp:
      'People can delete their own account. Access ends immediately, private work is removed, published stories stay in the gallery under the same author name, and billing records are kept 8 years with personal details stripped.',
    disabledHelp:
      'The deletion page and its menu entry are hidden, and the action refuses even if called directly. Admins can still delete an account on someone’s behalf.',
    beforeEnabling:
      'Reseed the Terms and /docs managed pages in the same sitting. Both still tell readers that self-serve deletion does not exist, which is true only while this is off. Managed Pages → Reset to seed. Terms is a published, acceptance-requiring document, so treat it as a version change, not a typo fix.',
    defaultEnabled: false,
    group: 'billing',
  },
  {
    key: 'billing_reconcile_enabled',
    label: 'Daily payment reconciliation',
    description: 'The backstop that catches payments the browser and webhook both missed.',
    enabledHelp:
      'The daily cron re-checks recent checkouts against Razorpay and settles anything still unsettled. This is the safety net for coins someone paid for but never received.',
    disabledHelp:
      'Nothing re-checks Razorpay. A payment that neither the browser nor the webhook completed stays unsettled until someone finds it by hand.',
    defaultEnabled: false,
    group: 'billing',
  },
  {
    key: 'billing_document_issuing_enabled',
    label: 'Issue tax documents',
    description: 'Allocates a gapless number and writes a receipt or tax invoice for each payment.',
    enabledHelp:
      'Every recorded payment and refund is issued a numbered document. Numbers come from the database sequence and are gapless by law, so turning this on starts a series that cannot be quietly restarted.',
    disabledHelp:
      'No documents are issued or numbered. Payments are still recorded in full, so documents can be issued later. This is the intended state until the document rendering in Phase 6 exists.',
    defaultEnabled: false,
    group: 'billing',
  },
];

export const OPERATIONAL_FLAG_GROUP_LABELS: Record<OperationalFlagDefinition['group'], string> = {
  billing: 'Billing and accounts',
};

export function findOperationalFlag(key: string): OperationalFlagDefinition | undefined {
  return OPERATIONAL_FLAG_DEFINITIONS.find((flag) => flag.key === key);
}

/** True only for a key this panel is allowed to write. The setter's guard. */
export function isOperationalFlagKey(key: string): boolean {
  return OPERATIONAL_FLAG_DEFINITIONS.some((flag) => flag.key === key);
}
