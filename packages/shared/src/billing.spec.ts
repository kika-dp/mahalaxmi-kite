import {
  BillingError,
  bundleAvailability,
  calculateBill,
  computeInvoiceBalance,
  formatDocumentNumber,
  isLowStock,
  returnLineValue,
} from './billing';
import { DiscountType, PaymentStatus } from './enums';

describe('calculateBill', () => {
  it('matches the specification example (₹550 − ₹50 = ₹500)', () => {
    const r = calculateBill({
      lines: [
        { unitPricePaise: 2000, quantity: 10 },
        { unitPricePaise: 10000, quantity: 2 },
        { unitPricePaise: 15000, quantity: 1 },
      ],
      billDiscount: { type: DiscountType.FIXED, value: 5000 },
    });
    expect(r.grossSubtotalPaise).toBe(55000);
    expect(r.billDiscountPaise).toBe(5000);
    expect(r.totalPaise).toBe(50000);
    expect(r.lines.reduce((s, l) => s + l.lineTotalPaise, 0)).toBe(50000);
    expect(r.lines.reduce((s, l) => s + l.billDiscountAllocPaise, 0)).toBe(5000);
  });

  it('applies a fixed bill discount (₹1,500 − ₹200 = ₹1,300)', () => {
    const r = calculateBill({
      lines: [{ unitPricePaise: 150000, quantity: 1 }],
      billDiscount: { type: DiscountType.FIXED, value: 20000 },
    });
    expect(r.totalPaise).toBe(130000);
    expect(r.discountTotalPaise).toBe(20000);
  });

  it('applies a percentage bill discount (₹1,500 − 10% = ₹1,350)', () => {
    const r = calculateBill({
      lines: [{ unitPricePaise: 150000, quantity: 1 }],
      billDiscount: { type: DiscountType.PERCENT, value: 1000 },
    });
    expect(r.billDiscountPaise).toBe(15000);
    expect(r.totalPaise).toBe(135000);
    expect(r.discountBpsOfGross).toBe(1000);
  });

  it('applies line discounts before the bill discount', () => {
    const r = calculateBill({
      lines: [
        { unitPricePaise: 1000, quantity: 10, discount: { type: DiscountType.FIXED, value: 1000 } },
        { unitPricePaise: 5000, quantity: 2, discount: { type: DiscountType.PERCENT, value: 1000 } },
      ],
      billDiscount: { type: DiscountType.PERCENT, value: 1000 },
    });
    // line1: 10000 − 1000 = 9000 ; line2: 10000 − 1000 = 9000 ; eligible 18000 ; bill 10% = 1800
    expect(r.lineDiscountTotalPaise).toBe(2000);
    expect(r.eligibleSubtotalPaise).toBe(18000);
    expect(r.billDiscountPaise).toBe(1800);
    expect(r.totalPaise).toBe(16200);
    expect(r.discountTotalPaise).toBe(3800);
  });

  it('rounds percentage half-up to whole paise', () => {
    // 333 × 15% = 49.95 → 50
    const r = calculateBill({
      lines: [{ unitPricePaise: 333, quantity: 1 }],
      billDiscount: { type: DiscountType.PERCENT, value: 1500 },
    });
    expect(r.billDiscountPaise).toBe(50);
    expect(r.totalPaise).toBe(283);
  });

  it('allocates bill discount exactly across lines with remainders', () => {
    const r = calculateBill({
      lines: [
        { unitPricePaise: 100, quantity: 1 },
        { unitPricePaise: 100, quantity: 1 },
        { unitPricePaise: 100, quantity: 1 },
      ],
      billDiscount: { type: DiscountType.FIXED, value: 100 },
    });
    const allocs = r.lines.map((l) => l.billDiscountAllocPaise);
    expect(allocs.reduce((a, b) => a + b, 0)).toBe(100);
    expect(allocs).toEqual([34, 33, 33]);
    expect(r.lines.map((l) => l.lineTotalPaise).reduce((a, b) => a + b, 0)).toBe(r.totalPaise);
  });

  it('supports 100% discount → zero total', () => {
    const r = calculateBill({
      lines: [{ unitPricePaise: 5000, quantity: 3 }],
      billDiscount: { type: DiscountType.PERCENT, value: 10000 },
    });
    expect(r.totalPaise).toBe(0);
  });

  it('rejects a bill discount greater than the eligible amount', () => {
    expect(() =>
      calculateBill({
        lines: [{ unitPricePaise: 1000, quantity: 1 }],
        billDiscount: { type: DiscountType.FIXED, value: 1001 },
      }),
    ).toThrow(BillingError);
  });

  it('rejects a line discount greater than the line amount', () => {
    expect(() =>
      calculateBill({
        lines: [{ unitPricePaise: 1000, quantity: 1, discount: { type: DiscountType.FIXED, value: 2000 } }],
      }),
    ).toThrow(/exceeds/);
  });

  it('rejects percentages over 100%', () => {
    expect(() =>
      calculateBill({
        lines: [{ unitPricePaise: 1000, quantity: 1 }],
        billDiscount: { type: DiscountType.PERCENT, value: 10001 },
      }),
    ).toThrow(BillingError);
  });

  it('rejects invalid quantities and negative discounts', () => {
    expect(() => calculateBill({ lines: [{ unitPricePaise: 10, quantity: 0 }] })).toThrow();
    expect(() => calculateBill({ lines: [{ unitPricePaise: 10, quantity: 1.5 }] })).toThrow();
    expect(() =>
      calculateBill({
        lines: [{ unitPricePaise: 10, quantity: 1 }],
        billDiscount: { type: DiscountType.FIXED, value: -5 },
      }),
    ).toThrow();
  });

  it('computes exclusive tax on the discounted amount when enabled', () => {
    const r = calculateBill({
      lines: [
        { unitPricePaise: 10000, quantity: 1 },
        { unitPricePaise: 5000, quantity: 1 },
      ],
      billDiscount: { type: DiscountType.FIXED, value: 1000 },
      taxRateBps: 1200,
    });
    expect(r.taxableAmountPaise).toBe(14000);
    expect(r.taxPaise).toBe(1680);
    expect(r.totalPaise).toBe(15680);
    expect(r.lines.reduce((s, l) => s + l.taxAllocPaise, 0)).toBe(1680);
    expect(r.lines.reduce((s, l) => s + l.lineTotalPaise, 0)).toBe(15680);
  });

  it('computes zero tax by default', () => {
    const r = calculateBill({ lines: [{ unitPricePaise: 999, quantity: 3 }] });
    expect(r.taxPaise).toBe(0);
    expect(r.totalPaise).toBe(2997);
  });

  it('treats zero-value discounts as NONE', () => {
    const r = calculateBill({
      lines: [{ unitPricePaise: 999, quantity: 1, discount: { type: DiscountType.FIXED, value: 0 } }],
      billDiscount: { type: DiscountType.PERCENT, value: 0 },
    });
    expect(r.billDiscountType).toBe(DiscountType.NONE);
    expect(r.lines[0].lineDiscountType).toBe(DiscountType.NONE);
  });

  it('flags discount percentage of gross conservatively (ceil)', () => {
    const r = calculateBill({
      lines: [{ unitPricePaise: 300, quantity: 1 }],
      billDiscount: { type: DiscountType.FIXED, value: 31 },
    });
    // 31/300 = 10.33% → 1034 bps (ceil)
    expect(r.discountBpsOfGross).toBe(1034);
  });
});

describe('computeInvoiceBalance', () => {
  const base = { totalPaise: 100000, returnedAmountPaise: 0, amountPaidPaise: 0, amountRefundedPaise: 0 };

  it('unpaid', () => {
    expect(computeInvoiceBalance(base)).toMatchObject({
      outstandingPaise: 100000,
      paymentStatus: PaymentStatus.UNPAID,
    });
  });
  it('partially paid', () => {
    expect(computeInvoiceBalance({ ...base, amountPaidPaise: 60000 })).toMatchObject({
      outstandingPaise: 40000,
      paymentStatus: PaymentStatus.PARTIALLY_PAID,
    });
  });
  it('paid', () => {
    expect(computeInvoiceBalance({ ...base, amountPaidPaise: 100000 })).toMatchObject({
      outstandingPaise: 0,
      creditDuePaise: 0,
      paymentStatus: PaymentStatus.PAID,
    });
  });
  it('zero-total invoice is paid', () => {
    expect(computeInvoiceBalance({ ...base, totalPaise: 0 }).paymentStatus).toBe(PaymentStatus.PAID);
  });
  it('return after full payment creates credit due', () => {
    const b = computeInvoiceBalance({ ...base, amountPaidPaise: 100000, returnedAmountPaise: 30000 });
    expect(b.creditDuePaise).toBe(30000);
    expect(b.outstandingPaise).toBe(0);
    expect(b.paymentStatus).toBe(PaymentStatus.PAID);
  });
  it('return on partially paid reduces outstanding', () => {
    const b = computeInvoiceBalance({ ...base, amountPaidPaise: 50000, returnedAmountPaise: 30000 });
    expect(b.outstandingPaise).toBe(20000);
    expect(b.paymentStatus).toBe(PaymentStatus.PARTIALLY_PAID);
  });
  it('full return + full refund → refunded', () => {
    const b = computeInvoiceBalance({
      totalPaise: 100000,
      returnedAmountPaise: 100000,
      amountPaidPaise: 100000,
      amountRefundedPaise: 100000,
    });
    expect(b.paymentStatus).toBe(PaymentStatus.REFUNDED);
    expect(b.creditDuePaise).toBe(0);
  });
  it('refund of a mistaken payment returns to unpaid', () => {
    const b = computeInvoiceBalance({ ...base, amountPaidPaise: 100000, amountRefundedPaise: 100000 });
    expect(b.paymentStatus).toBe(PaymentStatus.UNPAID);
    expect(b.outstandingPaise).toBe(100000);
  });
});

describe('returnLineValue', () => {
  it('prorates and uses remainder for the final unit', () => {
    const p = { lineTotalPaise: 1000, soldQuantity: 3 };
    const v1 = returnLineValue({ ...p, alreadyReturnedQuantity: 0, alreadyReturnedValuePaise: 0, quantity: 1 });
    const v2 = returnLineValue({ ...p, alreadyReturnedQuantity: 1, alreadyReturnedValuePaise: v1, quantity: 1 });
    const v3 = returnLineValue({ ...p, alreadyReturnedQuantity: 2, alreadyReturnedValuePaise: v1 + v2, quantity: 1 });
    expect([v1, v2, v3]).toEqual([333, 333, 334]);
    expect(v1 + v2 + v3).toBe(1000);
  });
  it('rejects over-return', () => {
    expect(() =>
      returnLineValue({ lineTotalPaise: 100, soldQuantity: 1, alreadyReturnedQuantity: 1, alreadyReturnedValuePaise: 100, quantity: 1 }),
    ).toThrow();
  });
});

describe('helpers', () => {
  it('bundle availability is the minimum component ratio', () => {
    expect(bundleAvailability([{ quantity: 10, available: 145 }, { quantity: 1, available: 25 }])).toBe(14);
    expect(bundleAvailability([{ quantity: 10, available: 9 }])).toBe(0);
    expect(bundleAvailability([])).toBe(0);
  });
  it('low stock includes the threshold and zero', () => {
    expect(isLowStock(10, 10)).toBe(true);
    expect(isLowStock(0, 10)).toBe(true);
    expect(isLowStock(11, 10)).toBe(false);
  });
  it('formats document numbers', () => {
    expect(formatDocumentNumber('KITE', '2026', 1)).toBe('KITE-2026-000001');
    expect(formatDocumentNumber('KITE', '2026', 1234567)).toBe('KITE-2026-1234567');
  });
});
