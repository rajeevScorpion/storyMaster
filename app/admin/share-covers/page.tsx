import Link from 'next/link';

import { getStorylineShareCoverDiagnostics } from '@/app/actions/storyline-covers';

type ShareCoverDiagnosticsPageProps = {
  searchParams: Promise<{ id?: string }>;
};

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-1 text-xs ${
      ok ? 'bg-emerald-500/15 text-emerald-200' : 'bg-rose-500/15 text-rose-200'
    }`}>
      {label}: {ok ? 'yes' : 'no'}
    </span>
  );
}

function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-xl border border-white/10 bg-neutral-950/50 p-3">
      <p className="text-xs uppercase tracking-[0.18em] text-neutral-500">{label}</p>
      <p className="mt-2 break-all text-sm text-neutral-200">{value == null || value === '' ? 'n/a' : String(value)}</p>
    </div>
  );
}

export default async function ShareCoverDiagnosticsPage({ searchParams }: ShareCoverDiagnosticsPageProps) {
  const params = await searchParams;
  const id = params.id?.trim() || '';
  const diagnostics = id ? await getStorylineShareCoverDiagnostics(id) : null;

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-serif">Share Cover Diagnostics</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Inspect crawler-safe cover state, raw metadata, and public image accessibility for a published storyline.
        </p>
      </div>

      <form className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 sm:flex-row">
        <input
          name="id"
          defaultValue={id}
          placeholder="Published storyline id"
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-neutral-950 px-4 py-3 text-sm text-neutral-100 outline-none focus:border-emerald-400/60"
        />
        <button className="rounded-xl border border-emerald-500/30 bg-emerald-500/20 px-5 py-3 text-sm text-emerald-200 transition-colors hover:bg-emerald-500/30">
          Inspect
        </button>
      </form>

      {diagnostics && (
        <>
          <section className="grid gap-3 md:grid-cols-4">
            <StatusPill ok={diagnostics.bucket.usableForCrawlerAssets} label="Bucket public" />
            <StatusPill ok={diagnostics.urlChecks.isAbsolute} label="Absolute URL" />
            <StatusPill ok={diagnostics.urlChecks.isCrawlerSafe} label="Crawler safe" />
            <StatusPill ok={!diagnostics.urlChecks.hasSignedToken} label="No signed token" />
          </section>

          {diagnostics.bucket.details.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
              {diagnostics.bucket.details.join(' ')}
            </div>
          )}

          <section className="grid gap-3 md:grid-cols-2">
            <Field label="Share URL" value={diagnostics.shareUrl} />
            <Field label="Resolved image URL" value={diagnostics.resolved.url} />
            <Field label="Source" value={diagnostics.resolved.source} />
            <Field label="Status" value={diagnostics.resolved.status} />
            <Field label="Dimensions" value={`${diagnostics.resolved.width}x${diagnostics.resolved.height}`} />
            <Field label="MIME type" value={diagnostics.resolved.mimeType} />
            <Field label="HTTP status" value={diagnostics.imageProbe.status} />
            <Field label="Content type / length" value={`${diagnostics.imageProbe.contentType ?? 'n/a'} / ${diagnostics.imageProbe.contentLength ?? 'n/a'}`} />
            <Field label="Raw HTML og:image" value={diagnostics.metadata.ogImage} />
            <Field label="Raw HTML twitter:image" value={diagnostics.metadata.twitterImage} />
            <Field label="Last updated" value={diagnostics.storyline?.share_cover_updated_at} />
            <Field label="YouTube thumbnail" value={diagnostics.storyline?.youtube_thumbnail_url} />
            <Field label="Reel thumbnail" value={diagnostics.storyline?.reel_thumbnail_url} />
          </section>

          <section className="flex flex-wrap gap-3">
            {diagnostics.shareUrl && (
              <Link href={diagnostics.shareUrl} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-neutral-200 hover:bg-white/10">
                Open share page
              </Link>
            )}
            <Link href={diagnostics.resolved.url} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-neutral-200 hover:bg-white/10">
              Open image
            </Link>
            {diagnostics.debuggerLinks.facebook && (
              <Link href={diagnostics.debuggerLinks.facebook} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-neutral-200 hover:bg-white/10">
                Facebook debugger
              </Link>
            )}
            {diagnostics.debuggerLinks.twitter && (
              <Link href={diagnostics.debuggerLinks.twitter} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-neutral-200 hover:bg-white/10">
                X card validator
              </Link>
            )}
            {diagnostics.debuggerLinks.linkedin && (
              <Link href={diagnostics.debuggerLinks.linkedin} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-neutral-200 hover:bg-white/10">
                LinkedIn inspector
              </Link>
            )}
          </section>

          {diagnostics.imageProbe.error && (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">
              Image probe failed: {diagnostics.imageProbe.error}
            </div>
          )}
          {diagnostics.metadata.error && (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">
              Raw metadata check: {diagnostics.metadata.error}
            </div>
          )}
        </>
      )}
    </div>
  );
}
