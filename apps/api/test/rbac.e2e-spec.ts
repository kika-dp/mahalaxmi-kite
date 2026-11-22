import { DiscoveryService, MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../src/common/decorators';
import { createTestApp, key, makeProduct, TestCtx } from './helpers';

describe('RBAC and ownership', () => {
  let t: TestCtx;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('every route declares @Public or a permission (default-deny is real)', () => {
    const discovery = new DiscoveryService(t.app.get(ModulesContainer));
    const scanner = new MetadataScanner();
    const reflector = t.app.get(Reflector);
    const missing: string[] = [];
    for (const wrapper of discovery.getControllers()) {
      const instance = wrapper.instance as object;
      if (!instance) continue;
      const proto = Object.getPrototypeOf(instance);
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = proto[name];
        if (!Reflect.getMetadata('path', handler)) continue; // not a route
        const targets = [handler, instance.constructor];
        const ok = reflector.getAllAndOverride(IS_PUBLIC_KEY, targets) || reflector.getAllAndOverride(PERMISSIONS_KEY, targets);
        if (!ok) missing.push(`${instance.constructor.name}.${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('a salesperson cannot change prices, adjust stock, view costs, void, return or see reports', async () => {
    const admin = t.api(await t.token('admin01'));
    const seller = t.api(await t.token('seller04'));
    const p = await makeProduct(admin);
    expect((await seller.patch(`/products/${p.id}`, { sellingPricePaise: 1 })).status).toBe(403);
    expect((await seller.post('/inventory/adjustments', { productId: p.id, type: 'ADJUSTMENT_IN', quantity: 5, reason: 'hack' })).status).toBe(403);
    expect((await seller.post('/inventory/receipts', { items: [{ productId: p.id, quantity: 5 }] })).status).toBe(403);
    const prod = await seller.get(`/products/${p.id}`);
    expect(prod.status).toBe(200);
    expect(prod.body.data.purchasePricePaise).toBeUndefined();
    expect((await seller.get('/dashboard/summary')).status).toBe(403);
    expect((await seller.get('/reports/daily-sales')).status).toBe(403);
    expect((await seller.get('/audit-logs')).status).toBe(403);
    expect((await seller.get('/users')).status).toBe(403);
    expect((await seller.patch('/settings', { salespersonMaxDiscountBps: 10000 })).status).toBe(403);

    const inv = await seller.post('/invoices', { idempotencyKey: key(), items: [{ productId: p.id, quantity: 1 }], payments: [{ method: 'CASH', amountPaise: 2000 }] });
    expect(inv.status).toBe(201);
    expect(inv.body.data.costTotalPaise).toBeUndefined();
    expect((await seller.post(`/invoices/${inv.body.data.id}/void`, { reason: 'try' })).status).toBe(403);
    expect((await seller.post(`/invoices/${inv.body.data.id}/returns`, { reason: 'try', items: [] })).status).toBe(403);
  });

  it('rejects client-supplied prices, totals or statuses (unknown fields are refused)', async () => {
    const admin = t.api(await t.token('admin01'));
    const seller = t.api(await t.token('seller04'));
    const p = await makeProduct(admin, { price: 5000 });
    const res = await seller.post('/invoices', {
      idempotencyKey: key(),
      items: [{ productId: p.id, quantity: 1, unitPricePaise: 1 }],
      totalPaise: 1,
      paymentStatus: 'PAID',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it("a salesperson gets 404 for another salesperson's invoice", async () => {
    const admin = t.api(await t.token('admin01'));
    const s5 = t.api(await t.token('seller05'));
    const s6 = t.api(await t.token('seller06'));
    const p = await makeProduct(admin);
    const inv = await s5.post('/invoices', { idempotencyKey: key(), items: [{ productId: p.id, quantity: 1 }], payments: [{ method: 'CASH', amountPaise: 1000 }], customer: { name: 'Owner Test' } });
    expect(inv.status).toBe(201);
    expect((await s6.get(`/invoices/${inv.body.data.id}`)).status).toBe(404);
    expect((await s6.get(`/invoices/${inv.body.data.id}/pdf`)).status).toBe(404);
    expect((await s6.post(`/invoices/${inv.body.data.id}/payments`, { idempotencyKey: key(), markPaid: true, method: 'CASH' })).status).toBe(404);
    const list = await s6.get('/invoices?pageSize=200');
    expect(list.body.data.every((i: { salesperson: { username: string } }) => i.salesperson.username === 'seller06')).toBe(true);
    expect((await s5.get(`/invoices/${inv.body.data.id}`)).status).toBe(200);
  });

  it('an inventory manager can receive and request adjustments but not view financial reports', async () => {
    const sa = t.api(await t.token('superadmin'));
    const admin = t.api(await t.token('admin01'));
    const username = `inv${Date.now().toString(36)}`;
    await sa.post('/users', { username, email: `${username}@kite.local`, fullName: 'Inv Mgr', role: 'INVENTORY_MANAGER', password: 'TempPass#123' });
    const l = await t.http().post('/api/v1/auth/login').send({ identifier: username, password: 'TempPass#123' });
    const pw = await t.api(l.body.data.accessToken).post('/auth/change-password', { currentPassword: 'TempPass#123', newPassword: 'InvMgrPass#2026' });
    const im = t.api(pw.body.data.accessToken);
    const p = await makeProduct(admin, { stock: 20 });
    expect((await im.post('/inventory/receipts', { items: [{ productId: p.id, quantity: 5 }] })).status).toBe(201);
    const adj = await im.post('/inventory/adjustments', { productId: p.id, type: 'DAMAGED', quantity: 3, reason: 'Torn kites' });
    expect(adj.status).toBe(201);
    expect(adj.body.data.status).toBe('PENDING');
    expect((await im.post(`/inventory/adjustments/${adj.body.data.id}/approve`, {})).status).toBe(403);
    expect((await im.get('/dashboard/summary')).status).toBe(403);
    expect((await im.get('/reports/profit')).status).toBe(403);
    expect((await im.get('/reports/low-stock')).status).toBe(200);
    expect((await im.get('/invoices')).status).toBe(403);
  });
});
