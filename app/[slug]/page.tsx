import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import ManagedFooter from '@/components/layout/ManagedFooter';
import KissagoLogo from '@/components/ui/KissagoLogo';
import { getCachedAllowedManagedPageBySlug } from '@/lib/managed-pages/cache';
import { extractManagedPageHeadings, formatManagedPageDate, ManagedPageContent } from '@/lib/managed-pages/render';

interface ManagedPageRouteProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ManagedPageRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const page = await getCachedAllowedManagedPageBySlug(slug);

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
  const page = await getCachedAllowedManagedPageBySlug(slug);

  if (!page) {
    notFound();
  }

  const isLegal = page.pageType === 'legal';
  const headings = isLegal ? extractManagedPageHeadings(page.content) : [];

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
          <p className="mt-5 text-sm text-neutral-500">
            {page.docVersion ? <>Version {page.docVersion} · </> : null}
            {page.effectiveDate ? <>Effective {formatManagedPageDate(page.effectiveDate)} · </> : null}
            Last updated {formatManagedPageDate(page.updatedAt)}
          </p>

          {isLegal && headings.length > 0 ? (
            <details className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-4 lg:hidden">
              <summary className="cursor-pointer text-sm font-medium text-neutral-200">On this page</summary>
              <nav aria-label="Table of contents" className="mt-3 flex flex-col gap-2">
                {headings.map((heading) => (
                  <a
                    key={heading.id}
                    href={`#${heading.id}`}
                    className={`text-sm text-neutral-400 hover:text-emerald-300 ${heading.level === 3 ? 'pl-4' : ''}`}
                  >
                    {heading.title}
                  </a>
                ))}
              </nav>
            </details>
          ) : null}

          <div className={isLegal && headings.length > 0 ? 'mt-12 lg:grid lg:grid-cols-[1fr_240px] lg:gap-12' : 'mt-12'}>
            <div className="border-t border-white/10 pt-10">
              <ManagedPageContent content={page.content} pageType={page.pageType} />
            </div>

            {isLegal && headings.length > 0 ? (
              <nav
                aria-label="Table of contents"
                className="hidden lg:sticky lg:top-10 lg:block lg:h-fit lg:border-t lg:border-white/10 lg:pt-10"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">On this page</p>
                <ul className="mt-4 space-y-2.5 border-l border-white/10 pl-4">
                  {headings.map((heading) => (
                    <li key={heading.id}>
                      <a
                        href={`#${heading.id}`}
                        className={`block text-sm text-neutral-400 transition-colors hover:text-emerald-300 ${
                          heading.level === 3 ? 'pl-3' : ''
                        }`}
                      >
                        {heading.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
          </div>
        </article>
      </div>
      <ManagedFooter />
    </main>
  );
}
