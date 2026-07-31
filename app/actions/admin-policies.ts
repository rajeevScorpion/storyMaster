'use server';

import { revalidatePath } from 'next/cache';
import {
  FREE_WELCOME_GRANT_POLICY_KEY,
  normalizeFreeWelcomeGrantPolicyUpdate,
  type AdminOperationalPolicy,
  type AdminOperationalPolicyAuditItem,
  type OperationalPoliciesAdminState,
  type UpdateFreeWelcomeGrantPolicyInput,
} from '@/lib/admin/operational-policies.shared';
import { createAdminClient, verifyAdmin } from '@/lib/supabase/admin';

interface OperationalPolicyRow {
  policy_key: string;
  name: string;
  category: string;
  description: string;
  enabled: boolean;
  config_json: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

interface OperationalPolicyAuditRow {
  id: number | string;
  policy_key: string;
  policy_version: number;
  actor_user_id: string | null;
  action_type: AdminOperationalPolicyAuditItem['actionType'];
  reason: string;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown>;
  created_at: string;
}

export async function getOperationalPoliciesAdminState(): Promise<OperationalPoliciesAdminState> {
  await verifyAdmin();
  return loadOperationalPoliciesAdminState();
}

export async function updateFreeWelcomeGrantPolicy(
  input: UpdateFreeWelcomeGrantPolicyInput
): Promise<OperationalPoliciesAdminState> {
  const { user } = await verifyAdmin();
  const normalized = normalizeFreeWelcomeGrantPolicyUpdate(input);
  const supabase = createAdminClient();

  const result = await supabase.rpc('admin_update_operational_policy', {
    p_policy_key: FREE_WELCOME_GRANT_POLICY_KEY,
    p_enabled: normalized.enabled,
    p_config_json: normalized.config,
    p_reason: normalized.reason,
    p_actor_user_id: user.id,
  });

  if (result.error) {
    throw new Error(`Failed to update the free welcome policy: ${result.error.message}`);
  }

  revalidatePath('/admin/policies');
  return loadOperationalPoliciesAdminState();
}

async function loadOperationalPoliciesAdminState(): Promise<OperationalPoliciesAdminState> {
  const supabase = createAdminClient();
  const [policiesResult, auditResult] = await Promise.all([
    supabase
      .from('operational_policies')
      .select('*')
      .order('category', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('operational_policy_audit_events')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(50),
  ]);

  if (policiesResult.error) {
    throw new Error(`Failed to load operational policies: ${policiesResult.error.message}`);
  }
  if (auditResult.error) {
    throw new Error(`Failed to load policy history: ${auditResult.error.message}`);
  }

  return {
    policies: ((policiesResult.data ?? []) as OperationalPolicyRow[]).map(mapPolicy),
    auditItems: ((auditResult.data ?? []) as OperationalPolicyAuditRow[]).map(mapAuditItem),
  };
}

function mapPolicy(row: OperationalPolicyRow): AdminOperationalPolicy {
  return {
    policyKey: row.policy_key,
    name: row.name,
    category: row.category,
    description: row.description,
    enabled: row.enabled,
    config: row.config_json ?? {},
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function mapAuditItem(row: OperationalPolicyAuditRow): AdminOperationalPolicyAuditItem {
  return {
    id: String(row.id),
    policyKey: row.policy_key,
    policyVersion: row.policy_version,
    actorUserId: row.actor_user_id,
    actionType: row.action_type,
    reason: row.reason,
    before: row.before_json,
    after: row.after_json,
    createdAt: row.created_at,
  };
}
