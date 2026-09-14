import AdminPageHeader from '@/components/admin/AdminPageHeader';
import PersonaCatalogue from '@/components/admin/agentic/PersonaCatalogue';
import { getPersonaCatalogueStatus, listPersonas } from '@/app/actions/agentic-personas';
import { getNarrationVoiceSettings } from '@/lib/ai/narration-voice-settings';
import { DEFAULT_FEMALE_NARRATION_VOICES, DEFAULT_MALE_NARRATION_VOICES } from '@/lib/ai/narration-voices';
import type { PersonaVoiceLists } from '@/lib/agentic/persona-voice.shared';

export const dynamic = 'force-dynamic';

/**
 * The two voice lists the persona editor's narration-voice dropdown offers
 * (Phase 8, Unit 8b) -- exactly the voices the consumer "advanced settings"
 * picker exposes, so an admin can never type a voice the product doesn't
 * offer. This fails SOFT, not closed: getNarrationVoiceSettings reads several
 * feature flags, and this page is the admin's only way to edit a persona at
 * all, so a flag-read hiccup must degrade to the curated defaults
 * (DEFAULT_MALE_NARRATION_VOICES / DEFAULT_FEMALE_NARRATION_VOICES) rather
 * than 500 the whole page.
 */
async function getPersonaVoiceLists(): Promise<PersonaVoiceLists> {
  try {
    const settings = await getNarrationVoiceSettings();
    return { maleVoiceList: settings.maleVoiceList, femaleVoiceList: settings.femaleVoiceList };
  } catch {
    return {
      maleVoiceList: [...DEFAULT_MALE_NARRATION_VOICES],
      femaleVoiceList: [...DEFAULT_FEMALE_NARRATION_VOICES],
    };
  }
}

export default async function AgenticPersonasPage() {
  const { schemaApplied } = await getPersonaCatalogueStatus();
  const [initialPersonas, voiceLists] = await Promise.all([
    schemaApplied ? listPersonas() : Promise.resolve([]),
    getPersonaVoiceLists(),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <AdminPageHeader
        title="Personas"
        description="The persona library: creative identity, permissions, and lifecycle status for autonomous story creators. Nothing here generates a story yet."
      />
      <PersonaCatalogue initialPersonas={initialPersonas} schemaApplied={schemaApplied} voiceLists={voiceLists} />
    </div>
  );
}
