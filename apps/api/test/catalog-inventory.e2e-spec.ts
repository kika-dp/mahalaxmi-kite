import { assertLedgerConsistent, categoryId, createTestApp, makeProduct, stockOf, TestCtx, uniq } from './helpers';

describe('Catalog and inventory', () => {
  let t: TestCtx;
  let admin: ReturnType<TestCtx['api']>;
  beforeAll(async () => {
    t = await createTestApp();
    admin = t.api(await t.token('admin01'));
  });
  afterAll(() => t.close());

  it('creates products with opening stock in the ledger, rejects duplicate SKUs and negative prices', async () => {
    const p = await makeProduct(admin, { stock: 42 });
    expect(await stockOf(t.ds, p.id)).toBe(42);
    const [mv] = await t.ds.query(`SELECT movement_type, quantity_change, previous_quantity, new_quantity, created_by_id FROM stock_movements WHERE product_id = $1`, [p.id]);
    expect(mv).toMatchObject({ movement_type: 'OPENING', quantity_change: 42, previous_quantity: 0, new_quantity: 42 });
    expect(mv.created_by_id).toBeTruthy();
    const dup = await admin.post('/products', { name: 'Dup', sku: p.sku, categoryId: await categoryId(admin), kind: 'STANDARD', unitType: 'PIECE', sellingPricePaise: 100 });
    expect(dup.status).toBe(409);
    const neg = await admin.post('/products', { name: 'Neg', categoryId: await categoryId(admin), kind: 'STANDARD', unitType: 'PIECE', sellingPricePaise: -1 });
    expect(neg.status).toBe(400);
    const auto = await admin.post('/products', { name: 'Auto SKU kite', categoryId: await categoryId(admin), kind: 'STANDARD', unitType: 'PIECE', sellingPricePaise: 500 });
    expect(auto.body.data.sku).toMatch(/^KT-\d{6}$/);
    expect(auto.body.data.minStockAlert).toBe(10);
  });

  it('validates bundles (components must be active standard products)', async () => {
    const a = await makeProduct(admin);
    const bundle = await admin.post('/products', { name: 'B1', categoryId: await categoryId(admin), kind: 'BUNDLE', unitType: 'PACKET', sellingPricePaise: 100, bundleItems: [{ componentProductId: a.id, quantity: 10 }] });
    expect(bundle.status).toBe(201);
    const nested = await admin.post('/products', { name: 'B2', categoryId: await categoryId(admin), kind: 'BUNDLE', unitType: 'PACKET', sellingPricePaise: 100, bundleItems: [{ componentProductId: bundle.body.data.id, quantity: 1 }] });
    expect(nested.status).toBe(400);
    const empty = await admin.post('/products', { name: 'B3', categoryId: await categoryId(admin), kind: 'BUNDLE', unitType: 'PACKET', sellingPricePaise: 100 });
    expect(empty.status).toBe(400);
    const stockOnBundle = await admin.post('/inventory/receipts', { items: [{ productId: bundle.body.data.id, quantity: 5 }] });
    expect(stockOnBundle.status).toBe(400);
  });

  it('archives products with history instead of deleting them; deletes unused ones', async () => {
    const used = await makeProduct(admin, { stock: 3 });
    const r1 = await admin.del(`/products/${used.id}`);
    expect(r1.body.data).toEqual({ archived: true, deleted: false });
    expect((await admin.get(`/products/${used.id}`)).body.data.isActive).toBe(false);
    const fresh = await admin.post('/products', { name: 'Unused', categoryId: await categoryId(admin), kind: 'STANDARD', unitType: 'PIECE', sellingPricePaise: 100 });
    const r2 = await admin.del(`/products/${fresh.body.data.id}`);
    expect(r2.body.data).toEqual({ archived: false, deleted: true });
  });

  it('receives stock, records receipts and prevents a second opening', async () => {
    const p = await makeProduct(admin, { stock: 10 });
    const r = await admin.post('/inventory/receipts', { items: [{ productId: p.id, quantity: 90, unitCostPaise: 1100 }] });
    expect(r.status).toBe(201);
    expect(r.body.data.referenceNumber).toMatch(/^RCV-/);
    expect(await stockOf(t.ds, p.id)).toBe(100);
    const again = await admin.post('/inventory/opening', { items: [{ productId: p.id, quantity: 5 }] });
    expect(again.status).toBe(409);
    await assertLedgerConsistent(t.ds, p.id);
  });

  it('applies admin adjustments immediately, never below zero', async () => {
    const p = await makeProduct(admin, { stock: 5 });
    const lost = await admin.post('/inventory/adjustments', { productId: p.id, type: 'LOST', quantity: 2, reason: 'Missing after count' });
    expect(lost.body.data.status).toBe('APPLIED');
    expect(await stockOf(t.ds, p.id)).toBe(3);
    const tooMuch = await admin.post('/inventory/adjustments', { productId: p.id, type: 'DAMAGED', quantity: 4, reason: 'Rain' });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await stockOf(t.ds, p.id)).toBe(3);
    const noReason = await admin.post('/inventory/adjustments', { productId: p.id, type: 'ADJUSTMENT_IN', quantity: 1, reason: '' });
    expect(noReason.status).toBe(400);
  });

  it('reconciles a physical stock count using the count-time snapshot', async () => {
    const p = await makeProduct(admin, { price: 1000, stock: 20 });
    const count = await admin.post('/inventory/counts', { notes: 'Evening count' });
    expect(count.body.data.countNumber).toMatch(/^SC-/);
    const id = count.body.data.id;
    const rec = await admin.put(`/inventory/counts/${id}/items`, { items: [{ productId: p.id, countedQuantity: 18 }] });
    expect(rec.body.data.items[0]).toMatchObject({ systemQuantity: 20, countedQuantity: 18, variance: -2 });
    // a sale after counting must not be double-counted
    const seller = t.api(await t.token('seller09'));
    await seller.post('/invoices', { idempotencyKey: crypto.randomUUID(), items: [{ productId: p.id, quantity: 5 }], payments: [{ method: 'CASH', amountPaise: 5000 }] });
    expect(await stockOf(t.ds, p.id)).toBe(15);
    const done = await admin.post(`/inventory/counts/${id}/complete`);
    expect(done.body.data.status).toBe('COMPLETED');
    expect(await stockOf(t.ds, p.id)).toBe(13);
    await assertLedgerConsistent(t.ds, p.id);
  });

  it('imports CSV all-or-nothing and supports dry runs', async () => {
    const goodSku = uniq('CSV');
    const csv = (rows: string[]) => Buffer.from(['sku,name,category,unitType,sellingPrice,purchasePrice,minStockAlert,openingStock', ...rows].join('\n'));
    const bad = await t
      .http()
      .post('/api/v1/products/import')
      .set('Authorization', `Bearer ${await t.token('admin01')}`)
      .attach('file', csv([`${goodSku},Good kite,Regular Kites,PIECE,12.50,8,5,30`, `${uniq('CSV')},Bad kite,No Such Category,PIECE,abc,,,`]), 'p.csv');
    expect(bad.status).toBe(200);
    expect(bad.body.data.errors.length).toBeGreaterThanOrEqual(2);
    expect(bad.body.data.created).toBe(0);
    const [{ n }] = await t.ds.query(`SELECT count(*)::int AS n FROM products WHERE sku = $1`, [goodSku]);
    expect(n).toBe(0);
    const ok = await t
      .http()
      .post('/api/v1/products/import')
      .set('Authorization', `Bearer ${await t.token('admin01')}`)
      .attach('file', csv([`${goodSku},Good kite,Regular Kites,PIECE,12.50,8,5,30`]), 'p.csv');
    expect(ok.body.data.created).toBe(1);
    const [row] = await t.ds.query(`SELECT p.selling_price_paise::int AS price, sb.quantity FROM products p JOIN stock_balances sb ON sb.product_id = p.id WHERE p.sku = $1`, [goodSku]);
    expect(row).toEqual({ price: 1250, quantity: 30 });
    const exp = await admin.get('/products/export');
    expect(exp.headers['content-type']).toMatch(/text\/csv/);
    expect(exp.text).toContain(goodSku);
  });

  it('bulk price update writes an audit entry per product', async () => {
    const a = await makeProduct(admin, { price: 1000 });
    const b = await makeProduct(admin, { price: 2000 });
    const res = await admin.post('/products/bulk-price', { items: [{ productId: a.id, sellingPricePaise: 1100 }, { productId: b.id, sellingPricePaise: 2200 }] });
    expect(res.body.data.updated).toBe(2);
    const [{ n }] = await t.ds.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'PRODUCT_PRICE_CHANGED' AND entity_id = ANY($1)`, [[a.id, b.id]]);
    expect(n).toBe(2);
  });

  it('reports low stock and rejects non-image uploads', async () => {
    const p = await makeProduct(admin, { stock: 3, min: 5 });
    const low = await admin.get('/inventory/low-stock');
    expect(low.body.data.some((r: { productId: string }) => r.productId === p.id)).toBe(true);
    const fake = await t
      .http()
      .post(`/api/v1/products/${p.id}/image`)
      .set('Authorization', `Bearer ${await t.token('admin01')}`)
      .attach('file', Buffer.from('<svg onload=alert(1)>'), { filename: 'x.png', contentType: 'image/png' });
    expect(fake.status).toBe(400);
    const png = Buffer.from('89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C6300010000050001', 'hex');
    const real = await t.http().post(`/api/v1/products/${p.id}/image`).set('Authorization', `Bearer ${await t.token('admin01')}`).attach('file', png, 'k.png');
    expect(real.status).toBe(200);
    expect(real.body.data.imageUrl).toMatch(/\/uploads\/[0-9a-f-]+\.png$/);
  });
});
