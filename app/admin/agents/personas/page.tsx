import AdminPageHeader from '@/components/admin/AdminPageHeader';
import PersonaCatalogue from '@/components/admin/agentic/PersonaCatalogue';
import { getPersonaCatalogueStatus, listPersonas } from '@/app/actions/agentic-personas';

export const dynamic = 'force-dynamic';

export default async function AgenticPersonasPage() {
  const { schemaApplied } = await getPersonaCatalogueStatus();
  const initialPersonas = schemaApplied ? await listPersonas() : [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <AdminPageHeader
        title="Personas"
        description="The persona library: creative identity, permissions, and lifecycle status for autonomous story creators. Nothing here generates a story yet."
      />
      <PersonaCatalogue initialPersonas={initialPersonas} schemaApplied={schemaApplied} />
    </div>
  );
}
