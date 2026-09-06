'use client';

import { useTransition, useState } from 'react';
import { AlertTriangle, Bot } from 'lucide-react';
import AdminToggle from '@/components/admin/AdminToggle';
import {
  setAgenticCreatorEnabled,
  setAgenticSchedulerEnabled,
  setAgenticSupervisorEnabled,
  setAgenticReviewerWorkflowEnabled,
  setAgenticBillingBypassEnabled,
  setAgenticImageGenerationEnabled,
} from '@/app/actions/agentic-admin';
import type { AgenticFlags } from '@/lib/agentic/flags';

type FlagKey = keyof AgenticFlags;

const FLAG_ACTIONS: Record<FlagKey, (enabled: boolean) => Promise<void>> = {
  creatorEnabled: setAgenticCreatorEnabled,
  schedulerEnabled: setAgenticSchedulerEnabled,
  supervisorEnabled: setAgenticSupervisorEnabled,
  reviewerWorkflowEnabled: setAgenticReviewerWorkflowEnabled,
  billingBypassEnabled: setAgenticBillingBypassEnabled,
  imageGenerationEnabled: setAgenticImageGenerationEnabled,
};

interface FlagRowConfig {
  key: FlagKey;
  label: string;
  description: string;
}

const MASTER_FLAG: FlagRowConfig = {
  key: 'creatorEnabled',
  label: 'Agentic Creator System',
  description:
    'Master kill switch. Off means no /admin/agents worker drain, no supervisor tick, and no agent generation of any kind — regardless of the flags below.',
};

const SUBORDINATE_FLAGS: FlagRowConfig[] = [
  {
    key: 'schedulerEnabled',
    label: 'Scheduler',
    description: 'Lets the existing daily /api/batch/reconcile cron drain the agent task queue.',
  },
  {
    key: 'supervisorEnabled',
    label: 'Editorial supervisor',
    description: 'Lets the Editorial Supervisor commission new tasks into the pool.',
  },
  {
    key: 'reviewerWorkflowEnabled',
    label: 'Reviewer workflow',
    description: 'Turns on /admin/authors and the human review queue.',
  },
  {
    key: 'billingBypassEnabled',
    label: 'Billing bypass',
    description:
      'Lets the agentic system user skip the coin reservation. Cost telemetry is still written to ai_cost_events either way.',
  },
  {
    key: 'imageGenerationEnabled',
    label: 'Image generation',
    description: "Global gate above each persona's own image permission. Both must be on before a persona can generate images.",
  },
];

function FlagToggleRow({
  config,
  checked,
  disabled,
  saving,
  onToggle,
}: {
  config: FlagRowConfig;
  checked: boolean;
  disabled: boolean;
  saving: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-neutral-900/60 p-4">
      <div>
        <p className="text-sm font-medium text-neutral-100">{config.label}</p>
        <p className="mt-0.5 text-xs text-neutral-400">{config.description}</p>
      </div>
      <span className="ml-6">
        <AdminToggle checked={checked} onToggle={onToggle} disabled={disabled || saving} ariaLabel={config.label} />
      </span>
    </div>
  );
}

export default function AgenticOverview({ initialFlags }: { initialFlags: AgenticFlags }) {
  const [flags, setFlags] = useState<AgenticFlags>(initialFlags);
  const [pendingKey, setPendingKey] = useState<FlagKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleToggle(key: FlagKey) {
    const nextValue = !flags[key];
    const previousFlags = flags;

    setError(null);
    setPendingKey(key);
    setFlags((current) => ({ ...current, [key]: nextValue }));

    startTransition(async () => {
      try {
        await FLAG_ACTIONS[key](nextValue);
      } catch (toggleError) {
        setFlags(previousFlags);
        setError(toggleError instanceof Error ? toggleError.message : `Failed to update ${key}.`);
      } finally {
        setPendingKey(null);
      }
    });
  }

  return (
    <div className="space-y-6">
      {!flags.creatorEnabled && (
        <div className="flex gap-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-5">
          <Bot size={22} className="mt-0.5 shrink-0 text-emerald-300" />
          <div className="space-y-1 text-sm text-neutral-200">
            <p className="font-medium text-emerald-200">The Agentic Creator System is currently off.</p>
            <p className="text-neutral-300">
              No personas run, no work is scheduled, and no story generation happens. Kissago behaves exactly as it
              does today. It is safe to flip the switch below — nothing is scheduled yet, so turning it on by itself
              triggers no work.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          <AlertTriangle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
        <div className="border-b border-white/10 p-5">
          <h2 className="text-sm font-semibold text-neutral-100">Master switch</h2>
          <p className="mt-1 text-xs text-neutral-400">Everything else on this page is inert while this is off.</p>
        </div>
        <div className="p-5">
          <FlagToggleRow
            config={MASTER_FLAG}
            checked={flags.creatorEnabled}
            disabled={false}
            saving={pendingKey === MASTER_FLAG.key}
            onToggle={() => handleToggle(MASTER_FLAG.key)}
          />
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
        <div className="border-b border-white/10 p-5">
          <h2 className="text-sm font-semibold text-neutral-100">Subordinate gates</h2>
          <p className="mt-1 text-xs text-neutral-400">
            Disabled while the master switch is off, so flipping one here can never be a confusing no-op.
          </p>
        </div>
        <div className="space-y-3 p-5">
          {SUBORDINATE_FLAGS.map((config) => (
            <FlagToggleRow
              key={config.key}
              config={config}
              checked={flags[config.key]}
              disabled={!flags.creatorEnabled}
              saving={pendingKey === config.key}
              onToggle={() => handleToggle(config.key)}
            />
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="text-sm font-semibold text-neutral-100">Not yet implemented</h2>
        <p className="mt-1 text-xs text-neutral-400">
          This page is a shell. Flipping these flags only changes what later phases will read — nothing below exists
          yet:
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-neutral-400">
          <li>Persona catalogue, creative identity, and permission resolution (Phase 2)</li>
          <li>Story memory and pre/post-generation novelty checks (Phase 3)</li>
          <li>Editorial supervisor and the task pool (Phase 4)</li>
          <li>Execution orchestrator — claim, retry, resume — schedules and model routing (Phase 5)</li>
          <li>Seed authoring, canonical beat assembly, and actual story generation (Phase 6)</li>
          <li>Evaluation of generated stories (Phase 7), optional narration (Phase 8)</li>
          <li>Human review queue at /admin/authors (Phase 9)</li>
          <li>Image permission (Phase 10), provenance and editorial labels (Phase 11)</li>
        </ul>
      </section>
    </div>
  );
}
