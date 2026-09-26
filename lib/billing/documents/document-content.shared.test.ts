import { describe, it, expect } from 'vitest';
import {
  buildBusinessSnapshot,
  buildCreditNoteLineItems,
  buildInvoiceLineItems,
  formatIstDate,
  formatIstDateRange,
  resolveCustomerSnapshot,
  DEFAULT_SERVICE_SAC,
} from './document-content.shared';

describe('buildBusinessSnapshot', () => {
  it('freezes the seller block from business-config.ts, deriving stateCode from the GSTIN', () => {
    const snapshot = buildBusinessSnapshot();

    expect(snapshot.legalName).toBe('Aavriti Design Studio');
    expect(snapshot.gstin).toBe('24ACLFA8196N1ZN');
    expect(snapshot.stateCode).toBe('24');
    expect(snapshot.state).toBe('Gujarat');
    expect(snapshot.country).toBe('India');
    expect(snapshot.supportEmail).toBeNull();
  });

  it('carries through whatever support email the caller resolves', () => {
    const snapshot = buildBusinessSnapshot('support@kissago.cc');
    expect(snapshot.supportEmail).toBe('support@kissago.cc');
  });
});

describe('formatIstDate', () => {
  it('formats a plain IST-morning timestamp as d MMM yyyy', () => {
    // 2026-09-24T04:00:00Z is 09:30 IST on the same calendar day.
    expect(formatIstDate('2026-09-24T04:00:00.000Z')).toBe('24 Sep 2026');
  });

  it('rolls a late-UTC timestamp forward into the next IST day', () => {
    // 2026-09-24T19:00:00Z + 5:30 = 2026-09-25T00:30 IST.
    expect(formatIstDate('2026-09-24T19:00:00.000Z')).toBe('25 Sep 2026');
  });

  it('returns null for a missing or unparseable input', () => {
    expect(formatIstDate(null)).toBeNull();
    expect(formatIstDate(undefined)).toBeNull();
    expect(formatIstDate('not-a-date')).toBeNull();
  });
});

describe('formatIstDateRange', () => {
  it('joins two valid dates with "to"', () => {
    expect(formatIstDateRange('2026-09-24T04:00:00.000Z', '2026-10-24T04:00:00.000Z')).toBe('24 Sep 2026 to 24 Oct 2026');
  });

  it('is null when either end is missing', () => {
    expect(formatIstDateRange(null, '2026-10-24T04:00:00.000Z')).toBeNull();
    expect(formatIstDateRange('2026-09-24T04:00:00.000Z', null)).toBeNull();
  });
});

describe('buildInvoiceLineItems', () => {
  it('builds a single top-up line with the default SAC', () => {
    const lines = buildInvoiceLineItems({ kind: 'topup', packName: '120 Coins', netMinor: 10000 });

    expect(lines).toEqual([
      { description: '120 Coins — Kissago coins top-up', sac: DEFAULT_SERVICE_SAC, quantity: 1, unit: 'NOS', netMinor: 10000 },
    ]);
  });

  it('uses the caller-supplied SAC over the default when given one', () => {
    const lines = buildInvoiceLineItems({ kind: 'topup', packName: '120 Coins', netMinor: 10000, sac: '999999' });
    expect(lines[0].sac).toBe('999999');
  });

  it('builds a monthly subscription line with the cycle range in IST', () => {
    const lines = buildInvoiceLineItems({
      kind: 'subscription',
      planName: 'Plus',
      billingInterval: 'monthly',
      cycleStart: '2026-09-24T04:00:00.000Z',
      cycleEnd: '2026-10-24T04:00:00.000Z',
      netMinor: 45000,
    });

    expect(lines).toEqual([
      {
        description: 'Kissago Plus plan — monthly subscription, 24 Sep 2026 to 24 Oct 2026',
        sac: DEFAULT_SERVICE_SAC,
        quantity: 1,
        unit: 'NOS',
        netMinor: 45000,
      },
    ]);
  });

  it('builds an annual subscription line and omits the range when the cycle dates are missing', () => {
    const lines = buildInvoiceLineItems({
      kind: 'subscription',
      planName: 'Studio',
      billingInterval: 'annual',
      cycleStart: null,
      cycleEnd: null,
      netMinor: 500000,
    });

    expect(lines[0].description).toBe('Kissago Studio plan — annual subscription');
  });
});

describe('buildCreditNoteLineItems', () => {
  it('mirrors a single-line invoice with the refund net standing in for the original', () => {
    const original = {
      documentNumber: 'TEST-KG/26-27/000001',
      lineItems: [{ description: '120 Coins — Kissago coins top-up', sac: DEFAULT_SERVICE_SAC, quantity: 1, unit: 'NOS', netMinor: 10000 }],
    };

    const lines = buildCreditNoteLineItems(original, { netMinor: 10000 });

    expect(lines).toEqual([
      {
        description: 'Refund against invoice TEST-KG/26-27/000001: 120 Coins — Kissago coins top-up',
        sac: DEFAULT_SERVICE_SAC,
        quantity: 1,
        unit: 'NOS',
        netMinor: 10000,
      },
    ]);
  });

  it('splits a multi-line invoice proportionally and the lines sum to exactly the refund net', () => {
    const original = {
      documentNumber: 'TEST-KG/26-27/000002',
      lineItems: [
        { description: 'Line A', sac: '998439', quantity: 1, unit: 'NOS', netMinor: 300 },
        { description: 'Line B', sac: '998439', quantity: 1, unit: 'NOS', netMinor: 700 },
      ],
    };

    const lines = buildCreditNoteLineItems(original, { netMinor: 333 });

    const total = lines.reduce((sum, line) => sum + line.netMinor, 0);
    expect(total).toBe(333);
    expect(lines[0].netMinor).toBe(Math.round((300 / 1000) * 333));
  });

  it('falls back to a generic line when the original carries no line items at all', () => {
    const lines = buildCreditNoteLineItems({ documentNumber: 'TEST-KG/26-27/000003', lineItems: [] }, { netMinor: 500 });

    expect(lines).toEqual([
      {
        description: 'Refund against invoice TEST-KG/26-27/000003: Kissago charge',
        sac: DEFAULT_SERVICE_SAC,
        quantity: 1,
        unit: 'NOS',
        netMinor: 500,
      },
    ]);
  });
});

describe('resolveCustomerSnapshot', () => {
  it('prefers the payment snapshot when present', () => {
    const paymentSnapshot = { legalName: 'Jane Doe', stateCode: '27' };
    const result = resolveCustomerSnapshot(paymentSnapshot, { legalName: 'Live Profile' }, null);
    expect(result).toBe(paymentSnapshot);
  });

  it('falls back to the live profile when the payment snapshot is absent or empty', () => {
    const liveSnapshot = { legalName: 'Live Profile', stateCode: '24' };
    expect(resolveCustomerSnapshot(null, liveSnapshot, null)).toBe(liveSnapshot);
    expect(resolveCustomerSnapshot({}, liveSnapshot, null)).toBe(liveSnapshot);
  });

  it('falls back to the minimal shape from the tax breakdown place of supply when nothing else is known', () => {
    const result = resolveCustomerSnapshot(null, null, { placeOfSupplyStateCode: '27' } as any);
    expect(result).toEqual({ stateCode: '27', profileType: 'personal' });
  });

  it('uses an empty state code when even the tax breakdown is unavailable', () => {
    const result = resolveCustomerSnapshot(null, null, null);
    expect(result).toEqual({ stateCode: '', profileType: 'personal' });
  });
});
