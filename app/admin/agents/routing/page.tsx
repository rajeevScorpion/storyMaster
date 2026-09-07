import Link from 'next/link';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { AGENT_TASK_KEYS, AGENT_TASK_ROLES, type AgentTaskKey, type AgentTaskRole } from '@/lib/agentic/routing.shared';
import { TASK_DEFINITIONS } from '@/lib/ai/model-config.shared';
import { getModelConfig } from '@/lib/ai/model-config';

export const dynamic = 'force-dynamic';

const ROLE_LABELS: Record<AgentTaskRole, string> = {
  economy: 'Economy',
  standard: 'Standard',
  creative: 'Creative',
};

const ROLE_STYLES: Record<AgentTaskRole, string> = {
  economy: 'border-neutral-500/25 bg-neutral-500/10 text-neutral-300',
  standard: 'border-indigo-500/25 bg-indigo-500/10 text-indigo-300',
  creative: 'border-purple-500/25 bg-purple-500/10 text-purple-300',
};

function taskLabel(taskKey: AgentTaskKey): string {
  return TASK_DEFINITIONS.find((task) => task.key === taskKey)?.label ?? taskKey;
}

/**
 * Read-only reference, not an editor. AGENT_TASK_ROLES is documentation-as-data
 * (see lib/agentic/routing.shared.ts's header) -- it never decides which model
 * runs, so this page never writes anything. The "resolved model" column calls
 * getModelConfig() per task, which already fails closed to DEFAULT_MODELS on
 * any model_config read error, so this page degrades to the code defaults
 * exactly like every other agentic surface rather than 500ing.
 */
export default async function AgenticRoutingPage() {
  const resolved = await Promise.all(
    AGENT_TASK_KEYS.map(async (taskKey) => ({
      taskKey,
      role: AGENT_TASK_ROLES[taskKey],
      ...(await getModelConfig(taskKey)),
    }))
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <AdminPageHeader
        title="Model routing"
        description="Read-only reference: which model each agentic task resolves to by default, and the precedence that decides it."
      />

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-neutral-300">
        <p>
          Precedence, highest first: a persona&apos;s own <code className="text-neutral-100">model_overrides</code> for
          that task &rarr; the <code className="text-neutral-100">model_config</code> row shown below &rarr; the
          code-level default in <code className="text-neutral-100">DEFAULT_MODELS</code>.
        </p>
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
        <div className="border-b border-white/10 p-4">
          <h2 className="text-sm font-semibold text-neutral-100">Agentic task keys</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Role tier is documentation only, for admin legibility -- it never changes which model actually runs.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.12em] text-neutral-600">
                <th className="px-4 py-3 font-medium">Task</th>
                <th className="px-4 py-3 font-medium">Role tier</th>
                <th className="px-4 py-3 font-medium">Resolved model</th>
                <th className="px-4 py-3 font-medium">Temperature</th>
              </tr>
            </thead>
            <tbody>
              {resolved.map((row) => (
                <tr key={row.taskKey} className="border-b border-white/5">
                  <td className="px-4 py-4">
                    <p className="text-neutral-100">{taskLabel(row.taskKey)}</p>
                    <p className="font-mono text-xs text-neutral-600">{row.taskKey}</p>
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${ROLE_STYLES[row.role]}`}
                    >
                      {ROLE_LABELS[row.role]}
                    </span>
                  </td>
                  <td className="px-4 py-4 font-mono text-neutral-300">{row.model}</td>
                  <td className="px-4 py-4 text-neutral-400">{row.temperature ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-5">
        <p className="text-sm font-medium text-amber-200">
          These five tasks are not editable in the Story Playground.
        </p>
        <p className="mt-2 text-sm text-neutral-300">
          The playground&apos;s task list is filtered to tasks whose prompt comes from an admin-editable
          template. All five agentic tasks build their prompts in code instead, so they are deliberately
          excluded from that registry &mdash; and excluded from its model editor along with it.
        </p>
        <p className="mt-2 text-sm text-neutral-300">
          Until a dedicated editor exists, the only way to change the model for one of these tasks is a
          persona&apos;s own <code className="text-neutral-100">model_overrides</code>, set per persona in
          the Personas catalogue. Everything else falls back to the compiled defaults shown above.
        </p>
        <Link
          href="/admin/agents/personas"
          className="mt-3 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-200 transition-colors hover:bg-neutral-700"
        >
          Open the persona catalogue
        </Link>
      </section>
    </div>
  );
}
