// Server-compatible loading skeleton for admin settings/pricing routes. Shown
// during RSC navigation so switching pages gives instant feedback instead of a
// blank frame. Matches the dark glass visual language.
export default function AdminSectionSkeleton() {
  return (
    <div className="mx-auto max-w-7xl animate-pulse">
      <div className="mb-2 h-7 w-64 rounded-lg bg-white/5" />
      <div className="mb-8 h-4 w-96 max-w-full rounded bg-white/5" />
      <div className="space-y-4">
        <div className="h-40 rounded-2xl border border-white/10 bg-white/5" />
        <div className="h-40 rounded-2xl border border-white/10 bg-white/5" />
        <div className="h-40 rounded-2xl border border-white/10 bg-white/5" />
      </div>
    </div>
  );
}
