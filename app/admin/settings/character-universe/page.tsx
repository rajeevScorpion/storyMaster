import CharacterUniverseSettingsPanel from '@/components/admin/CharacterUniverseSettingsPanel';
import AdminPageHeader from '@/components/admin/AdminPageHeader';

export const dynamic = 'force-dynamic';

export default function CharacterUniverseSettingsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <AdminPageHeader
        title="Characters & episodes"
        description="Character library, save-to-library, character mixing into new stories, episodic branching, series story bible, and episode journal."
      />
      <CharacterUniverseSettingsPanel />
    </div>
  );
}
