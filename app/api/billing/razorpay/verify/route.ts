import { NextResponse } from 'next/server';
import { fetchRazorpaySubscription, verifyRazorpayOrderSignature, verifyRazorpaySubscriptionSignature } from '@/lib/billing/razorpay';
import { grantTopupIfMissing, syncRazorpaySubscriptionState } from '@/lib/billing/razorpay-sync';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { DbBillingOrder, DbPricingPlanVersion, DbPricingTopupPack } from '@/lib/types/database';

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

      const signatureValid = verifyRazorpaySubscriptionSignature({
        subscriptionId: billingOrder.provider_checkout_session_id,
        paymentId: body.razorpayPaymentId,
        signature: body.razorpaySignature,
      });

      if (!signatureValid) {
        return NextResponse.json({ error: 'Invalid Razorpay subscription signature' }, { status: 400 });
      }

      const planVersion = await loadPlanVersion(admin, billingOrder.plan_version_id);
      const subscription = await fetchRazorpaySubscription(body.razorpaySubscriptionId);
      const syncResult = await syncRazorpaySubscriptionState({
        supabase: admin,
        userId: user.id,
        pricingMarketKey: planVersion.pricing_market_key,
        countryCode: planVersion.pricing_market_key === 'IN' ? 'IN' : null,
        planVersion,
        subscription,
        rawPayload: {
          kind: 'subscription_verify',
          checkoutResponse: body,
          subscription,
        },
      });

      const updateResult = await admin
        .from('billing_orders')
        .update({
          provider_payment_id: body.razorpayPaymentId,
          status: subscription.status,
          raw_provider_payload_json: {
            ...(billingOrder.raw_provider_payload_json ?? {}),
            verification: body,
            latestSubscription: subscription,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', billingOrder.id);

      throwIfQueryFailed(updateResult.error, 'Failed to update subscription billing order');

      return NextResponse.json({
        ok: true,
        grantedCoins: syncResult.grantedCoins,
        message:
          syncResult.grantedCoins > 0
            ? `Your plan is active and ${syncResult.grantedCoins.toLocaleString()} coins were added.`
            : 'Your plan is active. Coins will appear as soon as the current cycle grant is confirmed.',
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

    const topupPack = await loadTopupPack(admin, billingOrder.topup_pack_id);
    const grantedCoins = await grantTopupIfMissing({
      supabase: admin,
      billingOrder,
      topupPack,
      paymentId: body.razorpayPaymentId,
      rawPayload: body,
    });

    const updateResult = await admin
      .from('billing_orders')
      .update({
        provider_payment_id: body.razorpayPaymentId,
        status: 'paid',
        raw_provider_payload_json: {
          ...(billingOrder.raw_provider_payload_json ?? {}),
          verification: body,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', billingOrder.id);

    throwIfQueryFailed(updateResult.error, 'Failed to update top-up billing order');

    return NextResponse.json({
      ok: true,
      grantedCoins,
      message:
        grantedCoins > 0
          ? `${grantedCoins.toLocaleString()} coins were added to your wallet.`
          : 'This top-up has already been applied to your wallet.',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to verify Razorpay checkout' }, { status: 500 });
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

async function loadTopupPack(
  supabase: ReturnType<typeof createAdminClient>,
  topupPackId: string | null
): Promise<DbPricingTopupPack> {
  if (!topupPackId) {
    throw new Error('Billing order is missing a top-up pack');
  }

  const result = await supabase
    .from('pricing_topup_packs')
    .select('*')
    .eq('id', topupPackId)
    .maybeSingle();

  throwIfQueryFailed(result.error, 'Failed to load top-up pack');

  const topup = (result.data ?? null) as DbPricingTopupPack | null;
  if (!topup) {
    throw new Error('Top-up pack not found');
  }

  return topup;
}

function throwIfQueryFailed(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}
