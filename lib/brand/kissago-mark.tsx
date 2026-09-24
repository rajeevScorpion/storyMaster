/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1, owner 2026-09-24): the favicon's "k"
 * mark, extracted out of app/icon.tsx so a second surface (Razorpay's checkout `image`, at 256px via
 * app/brand/checkout-mark/route.tsx) can render the exact same drawing at a different size. app/icon.tsx
 * must keep rendering identically at 64px -- the font size below is scaled from that file's original
 * 44/64 ratio, so 64px in still yields 44 out.
 */

const FONT_SIZE_RATIO = 44 / 64;

export function renderKissagoMark(px: number) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#000000',
        borderRadius: '50%',
      }}
    >
      <span
        style={{
          fontSize: Math.round(px * FONT_SIZE_RATIO),
          fontWeight: 900,
          color: '#34d399',
          lineHeight: 1,
        }}
      >
        k
      </span>
    </div>
  );
}
