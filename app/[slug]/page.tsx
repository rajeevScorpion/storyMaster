import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import ManagedFooter from '@/components/layout/ManagedFooter';
import KissagoLogo from '@/components/ui/KissagoLogo';
import { formatManagedPageDate, ManagedPageContent } from '@/lib/managed-pages/render';
import { getAllowedManagedPageBySlug } from '@/lib/managed-pages/service';

export const dynamic = 'force-dynamic';

interface ManagedPageRouteProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ManagedPageRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const page = await getAllowedManagedPageBySlug(slug);

  if (!page) {
    return {
      title: 'Page not found - Kissago',
      robots: { index: false, follow: false },
    };
  }

  const canIndex = page.accessLevel === 'public';

  return {
    title: `${page.title} - Kissago`,
    description: page.excerpt ?? undefined,
    robots: {
      index: canIndex,
      follow: canIndex,
    },
    openGraph: canIndex
      ? {
          title: page.title,
          description: page.excerpt ?? 'Kissago managed page',
          type: 'article',
        }
      : undefined,
  };
}

export default async function ManagedPageRoute({ params }: ManagedPageRouteProps) {
  const { slug } = await params;
  const page = await getAllowedManagedPageBySlug(slug);

  if (!page) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col px-5 py-6 sm:px-8">
        <header className="flex items-center justify-between">
          <KissagoLogo fixed={false} />
        </header>

        <article className="py-14 sm:py-20">
          <p className="text-sm uppercase tracking-[0.2em] text-emerald-300/80">
            {page.pageType.replaceAll('_', ' ')}
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-normal text-white sm:text-5xl">
            {page.title}
          </h1>
          {page.excerpt ? (
            <p className="mt-5 max-w-3xl text-lg leading-8 text-neutral-300">{page.excerpt}</p>
          ) : null}
          <p className="mt-5 text-sm text-neutral-500">Last updated {formatManagedPageDate(page.updatedAt)}</p>

          <div className="mt-12 border-t border-white/10 pt-10">
            <ManagedPageContent content={page.content} pageType={page.pageType} />
          </div>
        </article>
      </div>
      <ManagedFooter />
    </main>
  );
}
