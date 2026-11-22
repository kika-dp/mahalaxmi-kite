/**
 * The end-to-end business flow from the master prompt §24, driven through the API exactly as the
 * CRM (admin) and the iOS app (salesperson) call it.
 */
import { randomUUID } from 'crypto';
import { categoryId, createTestApp, PASSWORDS, TestCtx, uniq } from './helpers';

describe('Full flow: CRM admin + mobile salesperson', () => {
  let t: TestCtx;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('runs the 14-step flow', async () => {
    // 1. Admin logs into CRM (cookie-based refresh)
    const crm = await t.http().post('/api/v1/auth/login').send({ identifier: 'admin01', password: PASSWORDS.admin01, client: 'crm' });
    expect(crm.status).toBe(200);
    const admin = t.api(crm.body.data.accessToken);
    const dashBefore = (await admin.get('/dashboard/summary')).body.data;

    // 2. Admin creates a product
    const created = await admin.post('/products', {
      name: `Flow Kite ${uniq()}`,
      categoryId: await categoryId(admin, 'Designer Kites'),
      kind: 'STANDARD',
      unitType: 'PIECE',
      sellingPricePaise: 2000,
      purchasePricePaise: 1200,
    });
    expect(created.status).toBe(201);
    const productId = created.body.data.id;

    // 3. Admin adds 100 units of stock
    expect((await admin.post('/inventory/receipts', { items: [{ productId, quantity: 100 }] })).status).toBe(201);

    // 4. Salesperson logs into the iOS app
    const mob = await t.http().post('/api/v1/auth/login').send({ identifier: 'seller01', password: PASSWORDS.seller01, client: 'mobile', remember: true });
    expect(mob.status).toBe(200);
    const seller = t.api(mob.body.data.accessToken);
    const catalog = await seller.get('/products/pos-catalog');
    expect(catalog.body.data.products.find((p: { id: string }) => p.id === productId).availableQuantity).toBe(100);

    // 5–7. Adds 10 units, applies ₹20 discount, accepts partial payment (₹100 of ₹180)
    const res = await seller.post('/invoices', {
      idempotencyKey: randomUUID(),
      items: [{ productId, quantity: 10 }],
      billDiscount: { type: 'FIXED', value: 2000 },
      payments: [{ method: 'CASH', amountPaise: 10000 }],
      customer: { name: 'Flow Customer', phone: '9898989898' },
    });
    // 8. Invoice is created
    expect(res.status).toBe(201);
    const inv = res.body.data;
    expect(inv.totalPaise).toBe(18000);
    expect(inv.paymentStatus).toBe('PARTIALLY_PAID');
    expect(inv.outstandingPaise).toBe(8000);

    // 9. Available stock becomes 90
    expect((await admin.get(`/products/${productId}`)).body.data.availableQuantity).toBe(90);

    // 10. CRM shows the new invoice
    const list = await admin.get(`/invoices?number=${inv.invoiceNumber}`);
    expect(list.body.data[0].id).toBe(inv.id);

    // 11. Dashboard reflects the sale and payment correctly
    const dashMid = (await admin.get('/dashboard/summary')).body.data;
    expect(dashMid.salesPaise - dashBefore.salesPaise).toBe(18000);
    expect(dashMid.cashCollectedPaise - dashBefore.cashCollectedPaise).toBe(10000);
    expect(dashMid.outstandingPaise - dashBefore.outstandingPaise).toBe(8000);

    // 12. Admin receives the outstanding payment later
    const paid = await admin.post(`/invoices/${inv.id}/payments`, { idempotencyKey: randomUUID(), markPaid: true, method: 'UPI' });
    expect(paid.status).toBe(201);

    // 13. Invoice status changes to Paid
    expect(paid.body.data.paymentStatus).toBe('PAID');
    expect(paid.body.data.outstandingPaise).toBe(0);
    expect(paid.body.data.payments.map((p: { receivedBy: { username: string } }) => p.receivedBy.username)).toEqual(['seller01', 'admin01']);

    // 14. No additional stock is deducted
    expect((await admin.get(`/products/${productId}`)).body.data.availableQuantity).toBe(90);
    const dashAfter = (await admin.get('/dashboard/summary')).body.data;
    expect(dashAfter.salesPaise - dashBefore.salesPaise).toBe(18000);
    expect(dashAfter.upiCollectedPaise - dashBefore.upiCollectedPaise).toBe(8000);
    expect(dashAfter.outstandingPaise - dashBefore.outstandingPaise).toBe(0);

    // Invoice PDF downloads for the admin and the salesperson who made it
    expect((await admin.get(`/invoices/${inv.id}/pdf`)).status).toBe(200);
    expect((await seller.get(`/invoices/${inv.id}/pdf?format=thermal`)).status).toBe(200);
  });
});
