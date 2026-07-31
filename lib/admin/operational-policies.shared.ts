export const FREE_WELCOME_GRANT_POLICY_KEY = 'free_welcome_grant' as const;

export interface FreeWelcomeGrantConfig {
  coinAmount: number;
  grantMode: 'once_per_account';
  expiresAfterDays: number | null;
}

export interface AdminOperationalPolicy {
  policyKey: string;
  name: string;
  category: string;
  description: string;
  enabled: boolean;
  config: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

export interface AdminOperationalPolicyAuditItem {
  id: string;
  policyKey: string;
  policyVersion: number;
  actorUserId: string | null;
  actionType: 'policy_created' | 'policy_updated';
  reason: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  createdAt: string;
}

export interface OperationalPoliciesAdminState {
  policies: AdminOperationalPolicy[];
  auditItems: AdminOperationalPolicyAuditItem[];
}

export interface UpdateFreeWelcomeGrantPolicyInput {
  enabled: boolean;
  coinAmount: number;
  expiresAfterDays: number | null;
  reason: string;
}

export interface NormalizedFreeWelcomeGrantPolicyUpdate {
  enabled: boolean;
  config: FreeWelcomeGrantConfig;
  reason: string;
}

export function normalizeFreeWelcomeGrantPolicyUpdate(
  input: UpdateFreeWelcomeGrantPolicyInput
): NormalizedFreeWelcomeGrantPolicyUpdate {
  const coinAmount = Number(input.coinAmount);
  if (!Number.isFinite(coinAmount) || coinAmount <= 0 || coinAmount > 10_000) {
    throw new Error('Welcome coins must be between 0.01 and 10,000');
  }

  if (Math.round(coinAmount * 100) !== coinAmount * 100) {
    throw new Error('Welcome coins can have at most two decimal places');
  }

  const expiresAfterDays = input.expiresAfterDays === null
    ? null
    : Number(input.expiresAfterDays);

  if (
    expiresAfterDays !== null &&
    (!Number.isInteger(expiresAfterDays) || expiresAfterDays < 1 || expiresAfterDays > 3650)
  ) {
    throw new Error('Expiry must be blank or a whole number from 1 to 3,650 days');
  }

  const reason = input.reason.trim();
  if (reason.length < 4) {
    throw new Error('Add a short reason for this policy change');
  }

  return {
    enabled: Boolean(input.enabled),
    config: {
      coinAmount,
      grantMode: 'once_per_account',
      expiresAfterDays,
    },
    reason,
  };
}

export function readFreeWelcomeGrantConfig(
  config: Record<string, unknown>
): FreeWelcomeGrantConfig {
  const coinAmount = Number(config.coinAmount);
  const expiryValue = config.expiresAfterDays;
  const expiresAfterDays = expiryValue === null || expiryValue === undefined
    ? null
    : Number(expiryValue);

  if (
    !Number.isFinite(coinAmount) ||
    coinAmount <= 0 ||
    config.grantMode !== 'once_per_account' ||
    (
      expiresAfterDays !== null &&
      (!Number.isInteger(expiresAfterDays) || expiresAfterDays < 1)
    )
  ) {
    throw new Error('The stored free welcome grant policy is invalid');
  }

  return {
    coinAmount,
    grantMode: 'once_per_account',
    expiresAfterDays,
  };
}
