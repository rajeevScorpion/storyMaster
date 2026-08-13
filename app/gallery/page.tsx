import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * The gallery moved to `/` when discovery became the front door. This keeps
 * every link that still says `/gallery` working — shared search URLs, the end
 * of a storyline, older sessions' history entries.
 *
 * Deliberately a temporary (307) redirect rather than a permanent one: browsers
 * cache a 308 indefinitely, which would make this move very hard to walk back.
 * Promote it to `permanentRedirect` once the new IA has settled.
 *
 * The query string is carried across so `/gallery?q=moon` still lands on those
 * results — search state lives entirely in the URL.
 */
export default async function GalleryRedirectRoute({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') params.set(key, value);
    else if (Array.isArray(value) && value.length > 0) params.set(key, value[0]);
  }

  const query = params.toString();
  redirect(query ? `/?${query}` : '/');
}
