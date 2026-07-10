import CharacterUniverseSettingsPanel from '@/components/admin/CharacterUniverseSettingsPanel';

export const dynamic = 'force-dynamic';

export default function CharacterUniverseSettingsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-serif text-neutral-100">Characters &amp; episodes</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Character library, save-to-library, character mixing into new stories, episodic branching, series story
          bible, and episode journal.
        </p>
      </div>
      <CharacterUniverseSettingsPanel />
    </div>
  );
}
