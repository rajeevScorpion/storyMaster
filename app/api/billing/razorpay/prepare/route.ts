import { NextResponse } from 'next/server';
import { prepareRazorpayCheckoutInternal } from '@/app/actions/pricing-checkout';
import type { PrepareRazorpayCheckoutInput, PricingMarketKey } from '@/lib/types/pricing';

interface PrepareCheckoutRequestBody {
  input: PrepareRazorpayCheckoutInput;
  pricingMarketKey?: PricingMarketKey | null;
}

export async function POST(request: Request) {
  let body: PrepareCheckoutRequestBody | null = null;

  try {
    body = (await request.json()) as PrepareCheckoutRequestBody;

    const checkout = await prepareRazorpayCheckoutInternal(body.input, {
      pricingMarketKey: body.pricingMarketKey ?? null,
    });

    return NextResponse.json({
      ok: true,
      checkout,
    });
  } catch (err: any) {
    const message = err?.message || 'Failed to prepare Razorpay checkout';
    const lower = String(message).toLowerCase();
    const status =
      lower.includes('please sign in') ? 401 :
      lower.includes('not available yet') || lower.includes('not purchasable') || lower.includes('does not belong') ? 400 :
      lower.includes('already have a razorpay subscription') ? 409 :
      500;

    console.error('[razorpay.prepare]', {
      message,
      stack: err?.stack ?? null,
      input: body?.input ?? null,
      pricingMarketKey: body?.pricingMarketKey ?? null,
    });

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status }
    );
  }
}
