import { getPublicStorylines } from '@/app/actions/gallery';
import SignedOutScreen from '@/components/auth/SignedOutScreen';

export const dynamic = 'force-dynamic';

export default async function SignedOutPage() {
  const storylines = await getPublicStorylines(20);

  // Pick a random cover image from public storylines
  const withCovers = storylines.filter((s) => s.cover_image_url);
  const randomCover =
    withCovers.length > 0
      ? // eslint-disable-next-line react-hooks/purity -- per-request randomization is intentional for variety on the signed-out landing
        withCovers[Math.floor(Math.random() * withCovers.length)].cover_image_url
      : null;

  return <SignedOutScreen coverImageUrl={randomCover} />;
}
