import { normalizeStoryboardVignetteAmountPercent } from '@/lib/types/storyboard-settings';

export default function StoryboardVignette({
  enabled,
  amountPercent,
}: {
  enabled: boolean;
  amountPercent: number;
}) {
  const amount = normalizeStoryboardVignetteAmountPercent(amountPercent) / 100;
  if (!enabled || amount <= 0) return null;

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 pointer-events-none"
      style={{
        background:
          `radial-gradient(circle at center, rgba(0,0,0,0) 48%, rgba(0,0,0,${0.18 * amount}) 68%, rgba(0,0,0,${0.42 * amount}) 84%, rgba(0,0,0,${0.7 * amount}) 100%)`,
      }}
    />
  );
}
