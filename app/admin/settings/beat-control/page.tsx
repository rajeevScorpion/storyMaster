import BeatControlSettingsPanel from '@/components/admin/BeatControlSettingsPanel';

export const dynamic = 'force-dynamic';

export default function BeatControlSettingsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-serif text-neutral-100">Beat control</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Beat text editing, timeline rewrite protection, image/narration/options regeneration, custom options, and
          image version history.
        </p>
      </div>
      <BeatControlSettingsPanel />
    </div>
  );
}
