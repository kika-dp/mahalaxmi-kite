import { addItem, cashChange, emptyCart, itemCount, preview, refreshFromCatalog, removeLine, setQuantity, stockWarnings, toRequest } from './cart-logic';

const kite = { productId: 'k', name: 'Regular Kite', sku: 'K', unitPricePaise: 2000, availableQuantity: 15 };
const firki = { productId: 'f', name: 'Firki', sku: 'F', unitPricePaise: 10000, availableQuantity: 2 };

describe('cart logic', () => {
  it('adds repeatedly to the same line (rapid tile taps)', () => {
    let c = emptyCart('key-1');
    for (let i = 0; i < 10; i++) c = addItem(c, kite);
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0].quantity).toBe(10);
    expect(itemCount(c)).toBe(10);
  });

  it('keeps the idempotency key for the life of the cart', () => {
    let c = emptyCart('key-1');
    c = addItem(c, kite);
    c = setQuantity(c, 0, 5);
    expect(c.idempotencyKey).toBe('key-1');
  });

  it('previews with the shared billing engine', () => {
    let c = addItem(addItem(emptyCart('k'), kite, 10), firki, 2);
    c = { ...c, billDiscount: { type: 'FIXED', value: 5000 } };
    const p = preview(c)!;
    expect(p.grossSubtotalPaise).toBe(40000);
    expect(p.totalPaise).toBe(35000);
  });

  it('returns null preview for invalid discounts instead of throwing', () => {
    const c = { ...addItem(emptyCart('k'), kite), billDiscount: { type: 'FIXED' as const, value: 999999 } };
    expect(preview(c)).toBeNull();
  });

  it('removes lines when quantity hits zero', () => {
    let c = addItem(emptyCart('k'), kite);
    c = setQuantity(c, 0, 0);
    expect(c.lines).toHaveLength(0);
    c = removeLine(addItem(c, firki), 0);
    expect(c.lines).toHaveLength(0);
  });

  it('flags lines beyond known stock', () => {
    const c = addItem(emptyCart('k'), firki, 3);
    expect(stockWarnings(c).map((l) => l.name)).toEqual(['Firki']);
  });

  it('refreshes prices from the catalog and reports changes', () => {
    const c = addItem(emptyCart('k'), kite, 2);
    const { cart, changed } = refreshFromCatalog(c, new Map([['k', { sellingPricePaise: 2500, availableQuantity: 9 }]]));
    expect(changed).toEqual(['Regular Kite']);
    expect(cart.lines[0].unitPricePaise).toBe(2500);
    expect(cart.lines[0].availableQuantity).toBe(9);
  });

  it('builds a request with no prices or totals (server computes them)', () => {
    let c = addItem(emptyCart('key-9'), kite, 3);
    c = { ...c, customer: { name: ' Ramesh ', phone: '' } };
    const r = toRequest(c, [{ method: 'CASH', amountPaise: 6000 }, { method: 'UPI', amountPaise: 0 }]);
    expect(r).toEqual({
      idempotencyKey: 'key-9',
      items: [{ productId: 'k', quantity: 3, discount: null }],
      billDiscount: null,
      customer: { name: 'Ramesh' },
      payments: [{ method: 'CASH', amountPaise: 6000 }],
      discountApproval: null,
    });
    expect(JSON.stringify(r)).not.toMatch(/unitPrice|total/i);
  });

  it('computes cash change', () => {
    expect(cashChange(38000, 50000)).toEqual({ recordPaise: 38000, changePaise: 12000 });
    expect(cashChange(38000, 20000)).toEqual({ recordPaise: 20000, changePaise: 0 });
  });
});
