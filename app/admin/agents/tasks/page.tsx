import AdminPageHeader from '@/components/admin/AdminPageHeader';
import TaskPool from '@/components/admin/agentic/TaskPool';
import { getCatalogueCoverage, getTaskPoolStatus, listAgentTasksAction } from '@/app/actions/agentic-supervisor';
import { getPersonaCatalogueStatus, listPersonas } from '@/app/actions/agentic-personas';

export const dynamic = 'force-dynamic';

export default async function AgenticTasksPage() {
  const [taskStatus, personaStatus] = await Promise.all([getTaskPoolStatus(), getPersonaCatalogueStatus()]);

  const [initialCoverage, initialTasks, personas] = await Promise.all([
    getCatalogueCoverage(),
    taskStatus.schemaApplied ? listAgentTasksAction() : Promise.resolve([]),
    personaStatus.schemaApplied ? listPersonas() : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <AdminPageHeader
        title="Task pool"
        description="Catalogue coverage gaps and the commissioning queue for autonomous story creators. Nothing here writes anything until the Editorial Supervisor flag is on."
      />
      <TaskPool
        initialCoverage={initialCoverage}
        initialTasks={initialTasks}
        personas={personas}
        taskSchemaApplied={taskStatus.schemaApplied}
        personaSchemaApplied={personaStatus.schemaApplied}
      />
    </div>
  );
}
