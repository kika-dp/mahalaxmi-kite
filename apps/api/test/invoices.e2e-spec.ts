import { assertLedgerConsistent, categoryId, createTestApp, key, makeProduct, stockOf, TestCtx, uniq } from './helpers';

describe('Billing engine: invoices, discounts, payments, returns, voids', () => {
  let t: TestCtx;
  let admin: ReturnType<TestCtx['api']>;
  let seller: ReturnType<TestCtx['api']>;
  beforeAll(async () => {
    t = await createTestApp();
    admin = t.api(await t.token('admin01'));
    seller = t.api(await t.token('seller07'));
  });
  afterAll(() => t.close());

  it('reproduces the specification example: ₹550 − ₹50 = ₹500, ₹300 paid → partially paid, stock deducted once', async () => {
    const kite = await makeProduct(admin, { price: 2000, stock: 150 });
    const firki = await makeProduct(admin, { price: 10000, stock: 25 });
    const manjha = await makeProduct(admin, { price: 15000, stock: 40 });
    const res = await seller.post('/invoices', {
      idempotencyKey: key(),
      items: [
        { productId: kite.id, quantity: 10 },
        { productId: firki.id, quantity: 2 },
        { productId: manjha.id, quantity: 1 },
      ],
      billDiscount: { type: 'FIXED', value: 5000 },
      payments: [{ method: 'CASH', amountPaise: 30000 }],
      customer: { name: 'Spec Customer', phone: '9876500001' },
    });
    expect(res.status).toBe(201);
    const inv = res.body.data;
    expect(inv.invoiceNumber).toMatch(/^KITE-2026-\d{6}$/);
    expect(inv.grossSubtotalPaise).toBe(55000);
    expect(inv.discountTotalPaise).toBe(5000);
    expect(inv.totalPaise).toBe(50000);
    expect(inv.amountPaidPaise).toBe(30000);
    expect(inv.outstandingPaise).toBe(20000);
    expect(inv.paymentStatus).toBe('PARTIALLY_PAID');
    expect(inv.items.reduce((s: number, i: { lineTotalPaise: number }) => s + i.lineTotalPaise, 0)).toBe(50000);
    expect(await stockOf(t.ds, kite.id)).toBe(140);
    expect(await stockOf(t.ds, firki.id)).toBe(23);
    expect(await stockOf(t.ds, manjha.id)).toBe(39);
    for (const p of [kite, firki, manjha]) await assertLedgerConsistent(t.ds, p.id);

    // Later payment: status → PAID, NO stock change (rule 4)
    const pay = await seller.post(`/invoices/${inv.id}/payments`, { idempotencyKey: key(), markPaid: true, method: 'UPI' });
    expect(pay.status).toBe(201);
    expect(pay.body.data.paymentStatus).toBe('PAID');
    expect(pay.body.data.outstandingPaise).toBe(0);
    expect(await stockOf(t.ds, kite.id)).toBe(140);
    const [{ n }] = await t.ds.query(`SELECT count(*)::int AS n FROM stock_movements WHERE reference_id = $1`, [inv.id]);
    expect(n).toBe(3);
  });

  it('applies percentage discounts and enforces the salesperson cap with manager override', async () => {
    const p = await makeProduct(admin, { price: 150000, stock: 10 });
    // 10% is within the default cap
    const ok = await seller.post('/invoices', {
      idempotencyKey: key(),
      items: [{ productId: p.id, quantity: 1 }],
      billDiscount: { type: 'PERCENT', value: 1000 },
      payments: [{ method: 'CASH', amountPaise: 135000 }],
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.totalPaise).toBe(135000);
    expect(ok.body.data.paymentStatus).toBe('PAID');

    // 20% needs approval
    const body = {
      idempotencyKey: key(),
      items: [{ productId: p.id, quantity: 1 }],
      billDiscount: { type: 'PERCENT', value: 2000, reason: 'Bulk buyer' },
      payments: [{ method: 'CASH', amountPaise: 120000 }],
    };
    const stockBefore = await stockOf(t.ds, p.id);
    const denied = await seller.post('/invoices', body);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('DISCOUNT_APPROVAL_REQUIRED');
    expect(await stockOf(t.ds, p.id)).toBe(stockBefore);

    const badApproval = await seller.post('/invoices', { ...body, idempotencyKey: key(), discountApproval: { username: 'seller01', password: 'whatever-123' } });
    expect(badApproval.body.error.code).toBe('DISCOUNT_APPROVAL_INVALID');

    const approved = await seller.post('/invoices', { ...body, idempotencyKey: key(), discountApproval: { username: 'admin02', password: 'KiteDev@2026#03' } });
    expect(approved.status).toBe(201);
    expect(approved.body.data.totalPaise).toBe(120000);
    expect(approved.body.data.discountApprovedBy.username).toBe('admin02');
    expect(approved.body.data.discountAppliedBy.username).toBe('seller07');
    const [{ n }] = await t.ds.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'DISCOUNT_OVERRIDE' AND entity_id = $1`, [approved.body.data.id]);
    expect(n).toBe(1);
  });

  it('accepts manager-approved item-level discounts with a top-level discountReason', async () => {
    const p = await makeProduct(admin, { price: 10000, stock: 5 });
    const body = {
      idempotencyKey: key(),
      items: [{ productId: p.id, quantity: 1, discount: { type: 'PERCENT', value: 2500 } }],
      payments: [{ method: 'UPI', amountPaise: 7500 }],
      discountApproval: { username: 'admin01', password: 'KiteDev@2026#02' },
    };
    const noReason = await seller.post('/invoices', body);
    expect(noReason.status).toBe(400);
    const ok = await seller.post('/invoices', { ...body, idempotencyKey: key(), discountReason: 'Slightly torn' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.discountReason).toBe('Slightly torn');
    expect(ok.body.data.discountApprovedBy.username).toBe('admin01');
  });

  it('rejects discounts above the bill amount and negative totals', async () => {
    const p = await makeProduct(admin, { price: 1000, stock: 10 });
    const res = await admin.post('/invoices', { idempotencyKey: key(), items: [{ productId: p.id, quantity: 1 }], billDiscount: { type: 'FIXED', value: 1001 } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DISCOUNT_EXCEEDS_AMOUNT');
    const line = await admin.post('/invoices', { idempotencyKey: key(), items: [{ productId: p.id, quantity: 1, discount: { type: 'PERCENT', value: 10001 } }] });
    expect(line.status).toBe(422);
    // admin may give 100% (total 0 → PAID with no payment)
    const free = await admin.post('/invoices', { idempotencyKey: key(), items: [{ productId: p.id, quantity: 1 }], billDiscount: { type: 'PERCENT', value: 10000, reason: 'Gift' } });
    expect(free.status).toBe(201);
    expect(free.body.data.totalPaise).toBe(0);
    expect(free.body.data.paymentStatus).toBe('PAID');
  });

  it('requires a customer name for unpaid/partial bills; allows walk-in when fully paid', async () => {
    const p = await makeProduct(admin, { price: 1000, stock: 10 });
    const unpaid = await seller.post('/invoices', { idempotencyKey: key(), items: [{ productId: p.id, quantity: 1 }] });
    expect(unpaid.status).toBe(422);
    expect(unpaid.body.error.code).toBe('CUSTOMER_REQUIRED_FOR_CREDIT');
    expect(await stockOf(t.ds, p.id)).toBe(10);
    const withName = await seller.post('/invoices', { idempotencyKey: key(), items: [{ productId: p.id, quantity: 1 }], customer: { name: 'Credit Kaka' } });
    expect(withName.status).toBe(201);
    expect(withName.body.data.paymentStatus).toBe('UNPAID');
    expect(withName.body.data.outstandingPaise).toBe(1000);
    // unpaid sale still deducts stock (rule 3)
    expect(await stockOf(t.ds, p.id)).toBe(9);
    const walkIn = await seller.post('/invoices', { idempotencyKey: key(), items: [{ productId: p.id, quantity: 1 }], payments: [{ method: 'UPI', amountPaise: 1000 }] });
    expect(walkIn.status).toBe(201);
    expect(walkIn.body.data.customerName).toBeNull();
  });

  it('rejects overpayment at checkout and on later payments', async () => {
    const p = await makeProduct(admin, { price: 1000, stock: 10 });
    const over = await seller.post('/invoices', { idempotencyKey: key(), items: [{ productId: p.id, quantity: 1 }], payments: [{ method: 'CASH', amountPaise: 1001 }] });
    expect(over.body.error.code).toBe('OVERPAYMENT');
    const inv = await seller.post('/invoices', { idempotencyKey: key(), items: [{ productId: p.id, quantity: 2 }], payments: [{ method: 'CASH', amountPaise: 500 }], customer: { name: 'Partial' } });
    const later = await seller.post(`/invoices/${inv.body.data.id}/payments`, { idempotencyKey: key(), payments: [{ method: 'CASH', amountPaise: 1501 }] });
    expect(later.body.error.code).toBe('OVERPAYMENT');
    // payment idempotency
    const k = key();
    const a = await seller.post(`/invoices/${inv.body.data.id}/payments`, { idempotencyKey: k, payments: [{ method: 'CASH', amountPaise: 500 }] });
    const b = await seller.post(`/invoices/${inv.body.data.id}/payments`, { idempotencyKey: k, payments: [{ method: 'CASH', amountPaise: 500 }] });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.meta.replayed).toBe(true);
    expect(b.body.data.amountPaidPaise).toBe(1000);
  });

  it('fails atomically on insufficient stock (no stock, number, or payment written)', async () => {
    const a = await makeProduct(admin, { price: 1000, stock: 10 });
    const b = await makeProduct(admin, { price: 1000, stock: 2 });
    const [{ before }] = await t.ds.query(`SELECT count(*)::int AS before FROM invoices`);
    const res = await seller.post('/invoices', {
      idempotencyKey: key(),
      items: [{ productId: a.id, quantity: 5 }, { productId: b.id, quantity: 3 }],
      payments: [{ method: 'CASH', amountPaise: 8000 }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.error.details[0]).toMatchObject({ productId: b.id, requested: 3, available: 2 });
    expect(await stockOf(t.ds, a.id)).toBe(10);
    expect(await stockOf(t.ds, b.id)).toBe(2);
    const [{ after }] = await t.ds.query(`SELECT count(*)::int AS after FROM invoices`);
    expect(after).toBe(before);
  });

  it('refuses inactive products', async () => {
    const p = await makeProduct(admin, { stock: 5 });
    await admin.patch(`/products/${p.id}`, { isActive: false });
    const res = await seller.post('/invoices', { idempotencyKey: key(), items: [{ productId: p.id, quantity: 1 }], payments: [{ method: 'CASH', amountPaise: 2000 }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PRODUCT_UNAVAILABLE');
  });

  it('keeps historical prices when the product price changes', async () => {
    const p = await makeProduct(admin, { price: 1000, stock: 10 });
    const inv = await seller.post('/invoices', { idempotencyKey: key(), items: [{ productId: p.id, quantity: 1 }], payments: [{ method: 'CASH', amountPaise: 1000 }] });
    await admin.patch(`/products/${p.id}`, { sellingPricePaise: 9999, name: 'Renamed kite' });
    const again = await admin.get(`/invoices/${inv.body.data.id}`);
    expect(again.body.data.items[0].unitPricePaise).toBe(1000);
    expect(again.body.data.items[0].productName).toBe(p.name);
    expect(again.body.data.totalPaise).toBe(1000);
  });

  it('sells bundles/packets by deducting component stock and restores them on return', async () => {
    const kite = await makeProduct(admin, { price: 1000, stock: 100 });
    const firki = await makeProduct(admin, { price: 20000, stock: 10 });
    const combo = await admin.post('/products', {
      name: `Starter ${uniq()}`,
      categoryId: await categoryId(admin, 'Other Products'),
      kind: 'BUNDLE',
      unitType: 'BUNDLE',
      sellingPricePaise: 25000,
      bundleItems: [
        { componentProductId: kite.id, quantity: 10 },
        { componentProductId: firki.id, quantity: 1 },
      ],
    });
    expect(combo.status).toBe(201);
    expect(combo.body.data.availableQuantity).toBe(10);
    expect(combo.body.data.purchasePricePaise).toBe(10 * 1200 + 1200);
    const inv = await seller.post('/invoices', { idempotencyKey: key(), items: [{ productId: combo.body.data.id, quantity: 2 }], payments: [{ method: 'CASH', amountPaise: 50000 }] });
    expect(inv.status).toBe(201);
    expect(await stockOf(t.ds, kite.id)).toBe(80);
    expect(await stockOf(t.ds, firki.id)).toBe(8);
    // changing the bundle afterwards does not affect how the old sale is restored
    await admin.patch(`/products/${combo.body.data.id}`, { bundleItems: [{ componentProductId: kite.id, quantity: 5 }] });
    const ret = await admin.post(`/invoices/${inv.body.data.id}/returns`, {
      reason: 'Customer changed mind',
      items: [{ invoiceItemId: inv.body.data.items[0].id, quantity: 1, restock: true }],
      refund: { method: 'CASH', amountPaise: 25000 },
    });
    expect(ret.status).toBe(201);
    expect(await stockOf(t.ds, kite.id)).toBe(90);
    expect(await stockOf(t.ds, firki.id)).toBe(9);
    expect(ret.body.data.returnedAmountPaise).toBe(25000);
    expect(ret.body.data.amountRefundedPaise).toBe(25000);
    expect(ret.body.data.paymentStatus).toBe('PAID');
    await assertLedgerConsistent(t.ds, kite.id);
  });

  it('handles partial returns, over-return, refund limits and non-restocked returns', async () => {
    const p = await makeProduct(admin, { price: 1000, stock: 10 });
    const inv = await seller.post('/invoices', {
      idempotencyKey: key(),
      items: [{ productId: p.id, quantity: 3 }],
      billDiscount: { type: 'FIXED', value: 100 },
      payments: [{ method: 'CASH', amountPaise: 1000 }],
      customer: { name: 'Returner' },
    });
    const id = inv.body.data.id;
    const itemId = inv.body.data.items[0].id;
    expect(inv.body.data.totalPaise).toBe(2900);
    expect(inv.body.data.outstandingPaise).toBe(1900);
    const r1 = await admin.post(`/invoices/${id}/returns`, { reason: 'Torn kite', items: [{ invoiceItemId: itemId, quantity: 1, restock: false }] });
    expect(r1.status).toBe(201);
    expect(r1.body.data.returnedAmountPaise).toBe(967); // round(2900/3)
    expect(r1.body.data.outstandingPaise).toBe(2900 - 967 - 1000);
    expect(await stockOf(t.ds, p.id)).toBe(7); // not restocked
    const over = await admin.post(`/invoices/${id}/returns`, { reason: 'Again', items: [{ invoiceItemId: itemId, quantity: 3, restock: true }] });
    expect(over.body.error.code).toBe('RETURN_EXCEEDS_SOLD');
    const badRefund = await admin.post(`/invoices/${id}/returns`, { reason: 'Rest', items: [{ invoiceItemId: itemId, quantity: 2, restock: true }], refund: { method: 'CASH', amountPaise: 99999 } });
    expect(badRefund.body.error.code).toBe('REFUND_EXCEEDS_CREDIT');
    expect(await stockOf(t.ds, p.id)).toBe(7); // the failed return rolled back
    const r2 = await admin.post(`/invoices/${id}/returns`, { reason: 'Rest', items: [{ invoiceItemId: itemId, quantity: 2, restock: true }], refund: { method: 'CASH', amountPaise: 1000 } });
    expect(r2.status).toBe(201);
    expect(r2.body.data.returnedAmountPaise).toBe(2900); // remainder rule: exact total
    expect(r2.body.data.outstandingPaise).toBe(0);
    expect(r2.body.data.paymentStatus).toBe('REFUNDED');
    expect(await stockOf(t.ds, p.id)).toBe(9);
    await assertLedgerConsistent(t.ds, p.id);
  });

  it('voids with full stock restoration and mandatory refund of money received', async () => {
    const p = await makeProduct(admin, { price: 1000, stock: 10 });
    const inv = await seller.post('/invoices', { idempotencyKey: key(), items: [{ productId: p.id, quantity: 4 }], payments: [{ method: 'CASH', amountPaise: 1500 }], customer: { name: 'Void Me' } });
    const id = inv.body.data.id;
    expect(await stockOf(t.ds, p.id)).toBe(6);
    const noMethod = await admin.post(`/invoices/${id}/void`, { reason: 'Wrong bill' });
    expect(noMethod.status).toBe(400);
    const v = await admin.post(`/invoices/${id}/void`, { reason: 'Wrong bill', refundMethod: 'CASH' });
    expect(v.status).toBe(200);
    expect(v.body.data.status).toBe('VOID');
    expect(v.body.data.amountRefundedPaise).toBe(1500);
    expect(v.body.data.outstandingPaise).toBe(0);
    expect(v.body.data.voidedBy.username).toBe('admin01');
    expect(await stockOf(t.ds, p.id)).toBe(10);
    expect((await admin.post(`/invoices/${id}/void`, { reason: 'Again', refundMethod: 'CASH' })).body.error.code).toBe('INVALID_STATE');
    expect((await seller.post(`/invoices/${id}/payments`, { idempotencyKey: key(), markPaid: true, method: 'CASH' })).body.error.code).toBe('INVALID_STATE');
    const pdf = await admin.get(`/invoices/${id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    await assertLedgerConsistent(t.ds, p.id);
  });

  it('idempotency: same key + same body replays; same key + different body conflicts', async () => {
    const p = await makeProduct(admin, { price: 1000, stock: 10 });
    const k = key();
    const body = { idempotencyKey: k, items: [{ productId: p.id, quantity: 1 }], payments: [{ method: 'CASH', amountPaise: 1000 }] };
    const a = await seller.post('/invoices', body);
    const b = await seller.post('/invoices', body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.data.invoiceNumber).toBe(a.body.data.invoiceNumber);
    expect(await stockOf(t.ds, p.id)).toBe(9);
    const c = await seller.post('/invoices', { ...body, items: [{ productId: p.id, quantity: 2 }] });
    expect(c.status).toBe(409);
    expect(c.body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
    const other = t.api(await t.token('seller08'));
    expect((await other.post('/invoices', body)).body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
  });

  it('preview computes totals and stock issues without writing anything', async () => {
    const p = await makeProduct(admin, { price: 1000, stock: 2 });
    const res = await seller.post('/invoices/preview', { items: [{ productId: p.id, quantity: 3 }], billDiscount: { type: 'PERCENT', value: 1500 } });
    expect(res.status).toBe(200);
    expect(res.body.data.totalPaise).toBe(2550);
    expect(res.body.data.requiresDiscountApproval).toBe(true);
    expect(res.body.data.stockIssues[0]).toMatchObject({ requested: 3, available: 2 });
    expect(await stockOf(t.ds, p.id)).toBe(2);
  });

  it('collects a customer payment oldest-first across bills', async () => {
    const p = await makeProduct(admin, { price: 1000, stock: 10 });
    const phone = `9${String(Date.now()).slice(-9)}`;
    const i1 = await seller.post('/invoices', { idempotencyKey: key(), items: [{ productId: p.id, quantity: 1 }], customer: { name: 'Multi Bill', phone } });
    const i2 = await seller.post('/invoices', { idempotencyKey: key(), items: [{ productId: p.id, quantity: 2 }], customer: { name: 'Multi Bill', phone } });
    expect(i1.body.data.customerId).toBe(i2.body.data.customerId);
    const res = await seller.post(`/customers/${i1.body.data.customerId}/payments`, { idempotencyKey: key(), amountPaise: 1500, method: 'CASH' });
    expect(res.status).toBe(201);
    expect(res.body.data.allocations).toEqual([
      expect.objectContaining({ invoiceId: i1.body.data.id, amountPaise: 1000 }),
      expect.objectContaining({ invoiceId: i2.body.data.id, amountPaise: 500 }),
    ]);
    expect(res.body.data.customer.outstandingPaise).toBe(1500);
    expect(await stockOf(t.ds, p.id)).toBe(7);
  });

  it('dashboard figures move exactly with sales, payments and returns', async () => {
    const before = (await admin.get('/dashboard/summary')).body.data;
    const p = await makeProduct(admin, { price: 10000, cost: 6000, stock: 10 });
    const inv = await seller.post('/invoices', {
      idempotencyKey: key(),
      items: [{ productId: p.id, quantity: 2 }],
      billDiscount: { type: 'FIXED', value: 2000 },
      payments: [{ method: 'CASH', amountPaise: 10000 }, { method: 'UPI', amountPaise: 5000 }],
      customer: { name: 'Dash Test' },
    });
    const mid = (await admin.get('/dashboard/summary')).body.data;
    expect(mid.salesPaise - before.salesPaise).toBe(18000);
    expect(mid.billsCount - before.billsCount).toBe(1);
    expect(mid.cashCollectedPaise - before.cashCollectedPaise).toBe(10000);
    expect(mid.upiCollectedPaise - before.upiCollectedPaise).toBe(5000);
    expect(mid.outstandingPaise - before.outstandingPaise).toBe(3000);
    expect(mid.discountGivenPaise - before.discountGivenPaise).toBe(2000);
    expect(mid.estimatedGrossProfitPaise - before.estimatedGrossProfitPaise).toBe(18000 - 12000);
    // an unpaid amount is NOT collected cash
    expect(mid.totalCollectedPaise - before.totalCollectedPaise).toBe(15000);
    await admin.post(`/invoices/${inv.body.data.id}/returns`, { reason: 'Return one', items: [{ invoiceItemId: inv.body.data.items[0].id, quantity: 1, restock: true }] });
    const after = (await admin.get('/dashboard/summary')).body.data;
    expect(after.salesPaise - before.salesPaise).toBe(9000);
    expect(after.returnsPaise - before.returnsPaise).toBe(9000);
    expect(after.estimatedGrossProfitPaise - before.estimatedGrossProfitPaise).toBe(3000);
  });

  it('cash closing counts only recorded cash, never unpaid bills', async () => {
    const p = await makeProduct(admin, { price: 1000, stock: 20 });
    let today = (await admin.get('/cash-sessions/today')).body.data;
    let sessionId = today.session?.id;
    if (!sessionId) sessionId = (await admin.post('/cash-sessions', { openingCashPaise: 50000 })).body.data.id;
    const s0 = (await admin.get(`/cash-sessions/${sessionId}`)).body.data.summary;
    await seller.post('/invoices', { idempotencyKey: key(), items: [{ productId: p.id, quantity: 3 }], payments: [{ method: 'CASH', amountPaise: 3000 }] });
    await seller.post('/invoices', { idempotencyKey: key(), items: [{ productId: p.id, quantity: 5 }], customer: { name: 'Unpaid Uncle' } });
    await admin.post(`/cash-sessions/${sessionId}/movements`, { type: 'EXPENSE', amountPaise: 500, reason: 'Tea for staff' });
    const s1 = (await admin.get(`/cash-sessions/${sessionId}`)).body.data.summary;
    expect(s1.cashSalesPaise - s0.cashSalesPaise).toBe(3000);
    expect(s1.payoutsPaise - s0.payoutsPaise).toBe(500);
    expect(s1.expectedCashPaise - s0.expectedCashPaise).toBe(2500);
    const closed = await admin.post(`/cash-sessions/${sessionId}/close`, { countedCashPaise: s1.expectedCashPaise - 200 });
    expect(closed.status).toBe(200);
    expect(closed.body.data.differencePaise).toBe(-200);
    expect((await admin.post(`/cash-sessions/${sessionId}/movements`, { type: 'PAYOUT', amountPaise: 1, reason: 'late' })).body.error.code).toBe('INVALID_STATE');
    const reopened = await t.api(await t.token('superadmin')).post(`/cash-sessions/${sessionId}/reopen`, { reason: 'Recount' });
    expect(reopened.body.data.status).toBe('OPEN');
  });

  it('serves reports as JSON, CSV and XLSX', async () => {
    const json = await admin.get('/reports/daily-sales');
    expect(json.status).toBe(200);
    expect(json.body.data.columns.length).toBeGreaterThan(5);
    for (const type of ['product-sales', 'category-sales', 'salesperson-sales', 'payments', 'outstanding', 'discounts', 'stock-movements', 'low-stock', 'inventory-valuation', 'purchases', 'profit', 'returns', 'weekly-sales', 'seasonal-sales']) {
      const r = await admin.get(`/reports/${type}`);
      expect([type, r.status]).toEqual([type, 200]);
    }
    const csv = await admin.get('/reports/payments?format=csv');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toMatch(/Amount/);
    const xlsx = await admin.get('/reports/profit?format=xlsx').buffer(true);
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
  });
});
