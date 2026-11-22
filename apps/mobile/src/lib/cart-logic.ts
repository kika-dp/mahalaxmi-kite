/**
 * Pure cart logic (no React Native imports) so it can be unit-tested with plain Jest.
 * The preview uses the SAME calculateBill as the server; the server result is authoritative.
 */
import { calculateBill, DiscountType, MAX_LINE_QUANTITY, type BillResult, type CreateInvoiceRequest, type PaymentInput } from '@kite/shared';

export interface CartLine {
  productId: string;
  name: string;
  sku: string;
  unitPricePaise: number;
  quantity: number;
  availableQuantity: number;
  discount?: { type: 'FIXED' | 'PERCENT'; value: number } | null;
  note?: string;
}

export interface CartState {
  /** Generated when the cart starts; reused for every retry so a lost response never duplicates a bill. */
  idempotencyKey: string;
  lines: CartLine[];
  billDiscount: { type: 'FIXED' | 'PERCENT'; value: number; reason?: string } | null;
  discountApproval: { username: string; password: string } | null;
  discountReason: string;
  customer: { name: string; phone: string };
  notes: string;
  updatedAt: number;
}

export function emptyCart(key: string): CartState {
  return { idempotencyKey: key, lines: [], billDiscount: null, discountApproval: null, discountReason: '', customer: { name: '', phone: '' }, notes: '', updatedAt: Date.now() };
}

export function addItem(cart: CartState, p: Omit<CartLine, 'quantity'>, qty = 1): CartState {
  const existing = cart.lines.find((l) => l.productId === p.productId && !l.note);
  const lines = existing
    ? cart.lines.map((l) => (l === existing ? { ...l, quantity: Math.min(MAX_LINE_QUANTITY, l.quantity + qty), unitPricePaise: p.unitPricePaise, availableQuantity: p.availableQuantity } : l))
    : [...cart.lines, { ...p, quantity: Math.min(MAX_LINE_QUANTITY, qty) }];
  return touch({ ...cart, lines });
}

export function setQuantity(cart: CartState, index: number, qty: number): CartState {
  if (qty <= 0) return removeLine(cart, index);
  return touch({ ...cart, lines: cart.lines.map((l, i) => (i === index ? { ...l, quantity: Math.min(MAX_LINE_QUANTITY, Math.floor(qty)) } : l)) });
}

export function removeLine(cart: CartState, index: number): CartState {
  return touch({ ...cart, lines: cart.lines.filter((_, i) => i !== index) });
}

/** Update prices/stock from a fresh catalog. Returns the cart and the names whose price changed. */
export function refreshFromCatalog(cart: CartState, catalog: Map<string, { sellingPricePaise: number; availableQuantity: number }>): { cart: CartState; changed: string[] } {
  const changed: string[] = [];
  const lines = cart.lines.map((l) => {
    const p = catalog.get(l.productId);
    if (!p) return l;
    if (p.sellingPricePaise !== l.unitPricePaise) changed.push(l.name);
    return { ...l, unitPricePaise: p.sellingPricePaise, availableQuantity: p.availableQuantity };
  });
  return { cart: changed.length || lines.some((l, i) => l.availableQuantity !== cart.lines[i].availableQuantity) ? touch({ ...cart, lines }) : cart, changed };
}

export function itemCount(cart: CartState): number {
  return cart.lines.reduce((s, l) => s + l.quantity, 0);
}

/** Local preview; returns null when the discount is invalid (e.g. above the bill amount). */
export function preview(cart: CartState, taxRateBps = 0): BillResult | null {
  if (!cart.lines.length) return null;
  try {
    return calculateBill({
      lines: cart.lines.map((l) => ({ unitPricePaise: l.unitPricePaise, quantity: l.quantity, discount: l.discount ? { type: l.discount.type as DiscountType, value: l.discount.value } : null })),
      billDiscount: cart.billDiscount ? { type: cart.billDiscount.type as DiscountType, value: cart.billDiscount.value } : null,
      taxRateBps,
    });
  } catch {
    return null;
  }
}

/** Lines that ask for more than the last known stock (stock is re-verified by the server). */
export function stockWarnings(cart: CartState): CartLine[] {
  const need = new Map<string, number>();
  for (const l of cart.lines) need.set(l.productId, (need.get(l.productId) ?? 0) + l.quantity);
  return cart.lines.filter((l) => (need.get(l.productId) ?? 0) > l.availableQuantity);
}

export function toRequest(cart: CartState, payments: PaymentInput[]): CreateInvoiceRequest {
  const name = cart.customer.name.trim();
  const phone = cart.customer.phone.trim();
  return {
    idempotencyKey: cart.idempotencyKey,
    items: cart.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, discount: l.discount ?? null, ...(l.note ? { note: l.note } : {}) })),
    billDiscount: cart.billDiscount,
    customer: name || phone ? { ...(name ? { name } : {}), ...(phone ? { phone } : {}) } : null,
    payments: payments.filter((p) => p.amountPaise > 0),
    discountApproval: cart.discountApproval,
    ...((cart.discountReason ?? '').trim() ? { discountReason: (cart.discountReason ?? '').trim() } : {}),
    ...(cart.notes.trim() ? { notes: cart.notes.trim() } : {}),
  };
}

/** Split a cash-tendered amount into the bill payment and change to return. */
export function cashChange(totalDuePaise: number, tenderedPaise: number): { recordPaise: number; changePaise: number } {
  const record = Math.min(totalDuePaise, tenderedPaise);
  return { recordPaise: record, changePaise: Math.max(0, tenderedPaise - totalDuePaise) };
}

function touch(c: CartState): CartState {
  return { ...c, updatedAt: Date.now() };
}
