import { NextResponse } from 'next/server';
import { prepareRazorpayCheckoutInternal } from '@/app/actions/pricing-checkout';
import { CheckoutRefusalError } from '@/lib/billing/checkout-guard.shared';
import { createCheckoutTimer } from '@/lib/billing/checkout-timing.shared';
import { resolveActiveViewerProfile } from '@/lib/viewer-profile';
import type { PrepareRazorpayCheckoutInput, PricingMarketKey } from '@/lib/types/pricing';

interface PrepareCheckoutRequestBody {
  input: PrepareRazorpayCheckoutInput;
  pricingMarketKey?: PricingMarketKey | null;
  adultAttested?: boolean;
}

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1, defect 9): the old handler returned
 * `err.message` verbatim for every status, 500 included, so a Razorpay API error thrown by
 * createRazorpayOrder/createRazorpaySubscription reached the customer as raw provider text. Now only a
 * `CheckoutRefusalError` -- the one error type prepareRazorpayCheckoutInternal uses for a
 * customer-facing refusal -- may set the response body; anything else is this generic sentence, with
 * the real error kept in the server log only.
 */
const GENERIC_PREPARE_ERROR = "We couldn't start checkout. Please try again in a moment.";

export async function POST(request: Request) {
  let body: PrepareCheckoutRequestBody | null = null;
  const timer = createCheckoutTimer();

  try {
    body = (await request.json()) as PrepareCheckoutRequestBody;

    // Owner decision P6: the kids/attestation gate itself lives inside prepareRazorpayCheckoutInternal
    // (defect 8), not here -- this route only resolves the two inputs it needs from cookies/the
    // request body and hands them down. A missing adultAttested counts as false.
    const { audienceMode } = await resolveActiveViewerProfile();

    const checkout = await prepareRazorpayCheckoutInternal(body.input, {
      pricingMarketKey: body.pricingMarketKey ?? null,
      adultAttested: body.adultAttested ?? false,
      audienceMode,
      timer,
    });

    console.info('[checkout-timing]', {
      kind: checkout.kind,
      reused: checkout.reused,
      internalOrderId: checkout.internalOrderId,
      steps: timer.entries(),
    });

    const response = NextResponse.json({
      ok: true,
      checkout,
    });
    response.headers.set('Server-Timing', timer.toServerTiming());
    return response;
  } catch (err: any) {
    if (err instanceof CheckoutRefusalError) {
      console.error('[razorpay.prepare]', {
        code: err.code,
        message: err.message,
        input: body?.input ?? null,
        pricingMarketKey: body?.pricingMarketKey ?? null,
      });

      return NextResponse.json({ ok: false, error: err.message }, { status: err.httpStatus });
    }

    console.error('[razorpay.prepare]', {
      message: err?.message ?? 'Unknown error',
      stack: err?.stack ?? null,
      input: body?.input ?? null,
      pricingMarketKey: body?.pricingMarketKey ?? null,
    });

    return NextResponse.json({ ok: false, error: GENERIC_PREPARE_ERROR }, { status: 500 });
  }
}
