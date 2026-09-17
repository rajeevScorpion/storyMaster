import { NextResponse } from 'next/server';
import { verifyRazorpayOrderSignature, verifyRazorpaySubscriptionSignature } from '@/lib/billing/razorpay';
import {
  nextSubscriptionCheckoutOrderStatus,
  settleTopupOrder,
  syncSubscriptionFromProvider,
} from '@/lib/billing/razorpay-sync';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { DbBillingOrder, DbPricingPlanVersion } from '@/lib/types/database';

type VerifyRequestBody =
  | {
      kind: 'subscription';
      internalOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
      razorpaySubscriptionId: string;
    }
  | {
      kind: 'topup';
      internalOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
      razorpayOrderId: string;
    };

const GENERIC_VERIFY_ERROR =
  "We couldn't confirm this payment yet. If you were charged, it will be applied automatically.";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as VerifyRequestBody;
    const admin = createAdminClient();

    const orderResult = await admin
      .from('billing_orders')
      .select('*')
      .eq('id', body.internalOrderId)
      .eq('user_id', user.id)
      .eq('provider', 'razorpay')
      .maybeSingle();

    throwIfQueryFailed(orderResult.error, 'Failed to load billing order');

    const billingOrder = (orderResult.data ?? null) as DbBillingOrder | null;
    if (!billingOrder) {
      return NextResponse.json({ error: 'Billing order not found' }, { status: 404 });
    }

    if (body.kind === 'subscription') {
      if (billingOrder.order_type !== 'subscription_checkout' || !billingOrder.provider_checkout_session_id) {
        return NextResponse.json({ error: 'Subscription checkout record is invalid' }, { status: 400 });
      }

      if (
        body.razorpaySubscriptionId &&
        body.razorpaySubscriptionId !== billingOrder.provider_checkout_session_id
      ) {
        return NextResponse.json({ error: 'Subscription does not match this checkout' }, { status: 400 });
      }

      const signatureValid = verifyRazorpaySubscriptionSignature({
        subscriptionId: billingOrder.provider_checkout_session_id,
        paymentId: body.razorpayPaymentId,
        signature: body.razorpaySignature,
      });

      if (!signatureValid) {
        return NextResponse.json({ error: 'Invalid Razorpay subscription signature' }, { status: 400 });
      }

      const planVersion = await loadPlanVersion(admin, billingOrder.plan_version_id);
      const syncResult = await syncSubscriptionFromProvider({
        supabase: admin,
        userId: user.id,
        planVersion,
        providerSubscriptionId: billingOrder.provider_checkout_session_id,
        checkoutOrder: billingOrder,
        source: 'verify',
        rawPayload: {
          kind: 'subscription_verify',
          paymentId: body.razorpayPaymentId,
        },
      });

      const updateResult = await admin
        .from('billing_orders')
        .update({
          provider_payment_id: billingOrder.provider_payment_id ?? body.razorpayPaymentId,
          status: nextSubscriptionCheckoutOrderStatus(billingOrder.status, syncResult.status),
          updated_at: new Date().toISOString(),
        })
        .eq('id', billingOrder.id);

      throwIfQueryFailed(updateResult.error, 'Failed to update subscription billing order');

      const message =
        syncResult.grantedCoins > 0
          ? `Your plan is active and ${syncResult.grantedCoins.toLocaleString()} coins were added.`
          : syncResult.firstChargeConfirmed
            ? 'Your plan is active.'
            : "Payment received. We're confirming it with your bank — your plan and coins will appear shortly.";

      return NextResponse.json({
        ok: true,
        grantedCoins: syncResult.grantedCoins,
        message,
      });
    }

    if (billingOrder.order_type !== 'topup_checkout' || !billingOrder.provider_order_id) {
      return NextResponse.json({ error: 'Top-up checkout record is invalid' }, { status: 400 });
    }

    const signatureValid = verifyRazorpayOrderSignature({
      orderId: billingOrder.provider_order_id,
      paymentId: body.razorpayPaymentId,
      signature: body.razorpaySignature,
    });

    if (!signatureValid) {
      return NextResponse.json({ error: 'Invalid Razorpay payment signature' }, { status: 400 });
    }

    const settleResult = await settleTopupOrder({
      supabase: admin,
      billingOrderId: billingOrder.id,
      paymentIdHint: body.razorpayPaymentId,
      source: 'verify',
    });

    if (settleResult.state === 'refunded') {
      return NextResponse.json({ error: 'This payment was refunded.' }, { status: 409 });
    }

    if (settleResult.state === 'failed') {
      return NextResponse.json({ error: 'This payment could not be completed.' }, { status: 402 });
    }

    const message =
      settleResult.state === 'pending'
        ? "Payment received. We're confirming it — coins will appear shortly."
        : settleResult.grantedCoins > 0
          ? `${settleResult.grantedCoins.toLocaleString()} coins were added to your wallet.`
          : 'This top-up has already been applied to your wallet.';

    return NextResponse.json({
      ok: true,
      grantedCoins: settleResult.grantedCoins,
      message,
    });
  } catch (err: any) {
    console.error('[razorpay.verify]', { message: err?.message ?? 'Unknown error' });
    return NextResponse.json({ error: GENERIC_VERIFY_ERROR }, { status: 500 });
  }
}

async function loadPlanVersion(
  supabase: ReturnType<typeof createAdminClient>,
  planVersionId: string | null
): Promise<DbPricingPlanVersion> {
  if (!planVersionId) {
    throw new Error('Billing order is missing a plan version');
  }

  const result = await supabase
    .from('pricing_plan_versions')
    .select('*')
    .eq('id', planVersionId)
    .maybeSingle();

  throwIfQueryFailed(result.error, 'Failed to load plan version');

  const version = (result.data ?? null) as DbPricingPlanVersion | null;
  if (!version) {
    throw new Error('Plan version not found');
  }

  return version;
}

function throwIfQueryFailed(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}
