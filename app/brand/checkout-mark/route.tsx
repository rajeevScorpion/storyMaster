import { ImageResponse } from 'next/og';
import { renderKissagoMark } from '@/lib/brand/kissago-mark';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1, owner 2026-09-24): Razorpay's checkout
 * `image` option -- an absolute URL, so this has to be a real route rather than an inline data URI.
 * Same drawing as app/icon.tsx, at 256px instead of 64px. Long-lived cache: the mark never changes at
 * runtime, and Razorpay itself may cache whatever it fetches once.
 */

const SIZE = 256;

export async function GET() {
  return new ImageResponse(renderKissagoMark(SIZE), {
    width: SIZE,
    height: SIZE,
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
