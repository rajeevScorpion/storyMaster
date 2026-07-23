import Link from 'next/link';
import { ChevronLeft, ChevronRight, ShieldAlert } from 'lucide-react';
import { getPricingAuditPage } from '@/app/actions/pricing-admin';
import AdminPageHeader from '@/components/admin/AdminPageHeader';

export const dynamic = 'force-dynamic';

interface PricingAuditPageProps {
  searchParams: Promise<{
    page?: string | string[];
  }>;
}

function parsePageParam(value: string | string[] | undefined): number {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.floor(parsed));
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString();
}

function auditPageHref(page: number) {
  return `/admin/pricing/audit?page=${page}`;
}

export default async function PricingAuditPage({ searchParams }: PricingAuditPageProps) {
  const params = await searchParams;
  const audit = await getPricingAuditPage({
    page: parsePageParam(params.page),
    pageSize: 25,
  });

  const canGoPrevious = audit.page > 1;
  const canGoNext = audit.page < audit.totalPages;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <AdminPageHeader
          title="Recent audit"
          description="Latest pricing changes recorded for traceability."
          actions={
            <>
              {canGoPrevious ? (
                <Link
                  href={auditPageHref(audit.page - 1)}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-neutral-900/60 px-3 py-2 text-sm text-neutral-200 hover:bg-white/10"
                >
                  <ChevronLeft size={14} />
                  Previous
                </Link>
              ) : (
                <span className="inline-flex cursor-default items-center gap-2 rounded-lg border border-white/10 bg-neutral-900/40 px-3 py-2 text-sm text-neutral-600">
                  <ChevronLeft size={14} />
                  Previous
                </span>
              )}

              {canGoNext ? (
                <Link
                  href={auditPageHref(audit.page + 1)}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-neutral-900/60 px-3 py-2 text-sm text-neutral-200 hover:bg-white/10"
                >
                  Next
                  <ChevronRight size={14} />
                </Link>
              ) : (
                <span className="inline-flex cursor-default items-center gap-2 rounded-lg border border-white/10 bg-neutral-900/40 px-3 py-2 text-sm text-neutral-600">
                  Next
                  <ChevronRight size={14} />
                </span>
              )}
            </>
          }
        />
        <p className="mt-2 text-xs uppercase tracking-[0.18em] text-emerald-300/80">
          Showing {audit.entries.length} of {audit.totalCount} entries
        </p>
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="mb-5 flex items-start gap-3">
          <div className="rounded-xl bg-emerald-500/10 p-2.5 text-emerald-300">
            <ShieldAlert size={18} />
          </div>
          <div>
            <h2 className="text-base font-medium text-neutral-100">Page {audit.page} of {audit.totalPages}</h2>
            <p className="mt-1 text-sm text-neutral-400">{audit.pageSize} entries per page</p>
          </div>
        </div>

        <div className="space-y-3">
          {audit.entries.length === 0 ? (
            <p className="text-sm text-neutral-500">No pricing audit entries yet.</p>
          ) : (
            audit.entries.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-neutral-100">{entry.entity_type} / {entry.action_type}</p>
                    <p className="mt-1 text-xs text-neutral-500">Performed at {formatDate(entry.created_at)}</p>
                  </div>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-neutral-400">
                    {entry.entity_id ?? 'runtime'}
                  </span>
                </div>
                {entry.reason && <p className="mt-2 text-xs text-neutral-400">Reason: {entry.reason}</p>}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
