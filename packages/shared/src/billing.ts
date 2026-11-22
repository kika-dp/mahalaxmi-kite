/**
 * Centralized billing calculation (specification.md §8.2).
 * Pure, integer-paise arithmetic. The API uses this authoritatively; the mobile app uses it
 * for an instant preview only. Never trust client-computed results on the server.
 */
import { DiscountType, PaymentStatus } from './enums';
import { allocateProportionally, assertPaise, BPS_100_PERCENT, percentOf } from './money';

export interface DiscountInput {
  type: DiscountType;
  /** FIXED → paise; PERCENT → bps (100 = 1%); NONE → ignored */
  value: number;
}

export interface BillLineInput {
  unitPricePaise: number;
  quantity: number;
  discount?: DiscountInput | null;
}

export interface BillInput {
  lines: BillLineInput[];
  billDiscount?: DiscountInput | null;
  /** 0 when tax is disabled. Exclusive tax applied on the post-discount amount. */
  taxRateBps?: number;
}

export interface BillLineResult {
  grossPaise: number;
  lineDiscountType: DiscountType;
  lineDiscountValue: number;
  lineDiscountPaise: number;
  netPaise: number;
  billDiscountAllocPaise: number;
  taxAllocPaise: number;
  lineTotalPaise: number;
}

export interface BillResult {
  lines: BillLineResult[];
  grossSubtotalPaise: number;
  lineDiscountTotalPaise: number;
  eligibleSubtotalPaise: number;
  billDiscountType: DiscountType;
  billDiscountValue: number;
  billDiscountPaise: number;
  discountTotalPaise: number;
  taxableAmountPaise: number;
  taxRateBps: number;
  taxPaise: number;
  totalPaise: number;
  /** discountTotal / grossSubtotal in bps (0 when gross is 0) */
  discountBpsOfGross: number;
}

export class BillingError extends Error {
  constructor(
    public readonly code: 'DISCOUNT_EXCEEDS_AMOUNT' | 'VALIDATION_ERROR',
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

export const MAX_LINE_QUANTITY = 9999;
export const MAX_BILL_LINES = 100;

function normalizeDiscount(d: DiscountInput | null | undefined): DiscountInput {
  if (!d || d.type === DiscountType.NONE) return { type: DiscountType.NONE, value: 0 };
  if (!Number.isSafeInteger(d.value) || d.value < 0) {
    throw new BillingError('VALIDATION_ERROR', 'Discount value must be a non-negative integer');
  }
  if (d.type === DiscountType.PERCENT && d.value > BPS_100_PERCENT) {
    throw new BillingError('DISCOUNT_EXCEEDS_AMOUNT', 'Discount percentage cannot exceed 100%');
  }
  if (d.value === 0) return { type: DiscountType.NONE, value: 0 };
  return { type: d.type, value: d.value };
}

function discountAmount(base: number, d: DiscountInput): number {
  switch (d.type) {
    case DiscountType.FIXED:
      return d.value;
    case DiscountType.PERCENT:
      return percentOf(base, d.value);
    default:
      return 0;
  }
}

export function calculateBill(input: BillInput): BillResult {
  const taxRateBps = input.taxRateBps ?? 0;
  if (!Number.isInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > BPS_100_PERCENT) {
    throw new BillingError('VALIDATION_ERROR', 'Invalid tax rate');
  }
  if (input.lines.length > MAX_BILL_LINES) {
    throw new BillingError('VALIDATION_ERROR', `A bill can have at most ${MAX_BILL_LINES} lines`);
  }

  const partial = input.lines.map((line, index) => {
    assertPaise(line.unitPricePaise, 'unitPricePaise');
    if (line.unitPricePaise < 0) throw new BillingError('VALIDATION_ERROR', 'Negative price');
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_LINE_QUANTITY) {
      throw new BillingError('VALIDATION_ERROR', `Line ${index + 1}: invalid quantity`);
    }
    const grossPaise = line.unitPricePaise * line.quantity;
    const d = normalizeDiscount(line.discount);
    const lineDiscountPaise = discountAmount(grossPaise, d);
    if (lineDiscountPaise > grossPaise) {
      throw new BillingError(
        'DISCOUNT_EXCEEDS_AMOUNT',
        `Line ${index + 1}: discount exceeds line amount`,
        { line: index + 1, grossPaise, lineDiscountPaise },
      );
    }
    return {
      grossPaise,
      lineDiscountType: d.type,
      lineDiscountValue: d.value,
      lineDiscountPaise,
      netPaise: grossPaise - lineDiscountPaise,
    };
  });

  const grossSubtotalPaise = partial.reduce((s, l) => s + l.grossPaise, 0);
  const lineDiscountTotalPaise = partial.reduce((s, l) => s + l.lineDiscountPaise, 0);
  const eligibleSubtotalPaise = grossSubtotalPaise - lineDiscountTotalPaise;

  const bd = normalizeDiscount(input.billDiscount);
  const billDiscountPaise = discountAmount(eligibleSubtotalPaise, bd);
  if (billDiscountPaise > eligibleSubtotalPaise) {
    throw new BillingError('DISCOUNT_EXCEEDS_AMOUNT', 'Bill discount exceeds the bill amount', {
      eligibleSubtotalPaise,
      billDiscountPaise,
    });
  }

  const billAlloc = allocateProportionally(
    billDiscountPaise,
    partial.map((l) => l.netPaise),
  );
  const taxableAmountPaise = eligibleSubtotalPaise - billDiscountPaise;
  const taxPaise = taxRateBps > 0 ? percentOf(taxableAmountPaise, taxRateBps) : 0;
  const taxAlloc = allocateProportionally(
    taxPaise,
    partial.map((l, i) => l.netPaise - billAlloc[i]),
  );

  const lines: BillLineResult[] = partial.map((l, i) => ({
    ...l,
    billDiscountAllocPaise: billAlloc[i],
    taxAllocPaise: taxAlloc[i],
    lineTotalPaise: l.netPaise - billAlloc[i] + taxAlloc[i],
  }));

  const totalPaise = taxableAmountPaise + taxPaise;
  const discountTotalPaise = lineDiscountTotalPaise + billDiscountPaise;

  return {
    lines,
    grossSubtotalPaise,
    lineDiscountTotalPaise,
    eligibleSubtotalPaise,
    billDiscountType: bd.type,
    billDiscountValue: bd.value,
    billDiscountPaise,
    discountTotalPaise,
    taxableAmountPaise,
    taxRateBps,
    taxPaise,
    totalPaise,
    discountBpsOfGross:
      grossSubtotalPaise === 0
        ? 0
        : Math.ceil((discountTotalPaise * BPS_100_PERCENT) / grossSubtotalPaise),
  };
}

export interface InvoiceBalanceInput {
  totalPaise: number;
  returnedAmountPaise: number;
  amountPaidPaise: number;
  amountRefundedPaise: number;
}

export interface InvoiceBalance {
  owedPaise: number;
  netPaidPaise: number;
  outstandingPaise: number;
  creditDuePaise: number;
  paymentStatus: PaymentStatus;
}

/** Derive balance & payment status (specification.md §9). */
export function computeInvoiceBalance(i: InvoiceBalanceInput): InvoiceBalance {
  const owedPaise = i.totalPaise - i.returnedAmountPaise;
  const netPaidPaise = i.amountPaidPaise - i.amountRefundedPaise;
  const outstandingPaise = Math.max(0, owedPaise - netPaidPaise);
  const creditDuePaise = Math.max(0, netPaidPaise - owedPaise);
  let paymentStatus: PaymentStatus;
  if (i.amountRefundedPaise > 0 && netPaidPaise === 0 && owedPaise === 0) {
    paymentStatus = PaymentStatus.REFUNDED;
  } else if (outstandingPaise === 0) {
    paymentStatus = PaymentStatus.PAID;
  } else if (netPaidPaise > 0) {
    paymentStatus = PaymentStatus.PARTIALLY_PAID;
  } else {
    paymentStatus = PaymentStatus.UNPAID;
  }
  return { owedPaise, netPaidPaise, outstandingPaise, creditDuePaise, paymentStatus };
}

/**
 * Value of returning `qty` units of a line (specification.md §10.1).
 * When the return completes the line, the remainder is used so no paise drift accumulates.
 */
export function returnLineValue(params: {
  lineTotalPaise: number;
  soldQuantity: number;
  alreadyReturnedQuantity: number;
  alreadyReturnedValuePaise: number;
  quantity: number;
}): number {
  const { lineTotalPaise, soldQuantity, alreadyReturnedQuantity, alreadyReturnedValuePaise, quantity } =
    params;
  if (quantity < 1 || alreadyReturnedQuantity + quantity > soldQuantity) {
    throw new BillingError('VALIDATION_ERROR', 'Return quantity exceeds sold quantity');
  }
  if (alreadyReturnedQuantity + quantity === soldQuantity) {
    return lineTotalPaise - alreadyReturnedValuePaise;
  }
  return Math.round((lineTotalPaise * quantity) / soldQuantity);
}

/** Bundle availability: min over components of floor(stock / qtyPerBundle). */
export function bundleAvailability(
  components: { quantity: number; available: number }[],
): number {
  if (components.length === 0) return 0;
  return Math.max(
    0,
    Math.min(...components.map((c) => Math.floor(c.available / c.quantity))),
  );
}

export function isLowStock(quantity: number, minStockAlert: number): boolean {
  return quantity <= minStockAlert;
}

export function formatDocumentNumber(prefix: string, series: string, value: number): string {
  return `${prefix}-${series}-${String(value).padStart(6, '0')}`;
}
