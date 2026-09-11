import AdminPageHeader from '@/components/admin/AdminPageHeader';
import PersonaSpend from '@/components/admin/agentic/PersonaSpend';
import { getPersonaSpendReport } from '@/lib/agentic/persona-spend';

export const dynamic = 'force-dynamic';

// Read-only report of what each persona has cost. Reached only through
// app/admin/layout.tsx's verifyAdmin() gate, like every other page under /admin.
//
// There is deliberately no server action behind this page: it only reads, and a page
// that reads on the server needs no separately-invocable endpoint that would then need
// a gate of its own.
export default async function AgenticSpendPage() {
  const { report, unavailable } = await getPersonaSpendReport();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <AdminPageHeader
        title="Persona spend"
        description="What each persona has cost, traced through the stories it wrote. Narration and images are the charges that land here; a reviewer finishing a draft is never charged for it."
      />
      <PersonaSpend report={report} unavailable={unavailable} />
    </div>
  );
}
