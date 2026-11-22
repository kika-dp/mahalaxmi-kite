import { assertLedgerConsistent, createTestApp, key, makeProduct, stockOf, TestCtx } from './helpers';

const SELLERS = Array.from({ length: 9 }, (_, i) => `seller0${i + 1}`);

describe('Concurrency: overselling, numbering, idempotency, payments', () => {
  let t: TestCtx;
  let admin: ReturnType<TestCtx['api']>;
  beforeAll(async () => {
    t = await createTestApp();
    admin = t.api(await t.token('admin01'));
    for (const s of SELLERS) await t.token(s); // warm logins
  });
  afterAll(() => t.close());

  it('stock 5: A sells 4 and B sells 3 at the same time → exactly one succeeds', async () => {
    const p = await makeProduct(admin, { price: 1000, stock: 5 });
    const a = t.api(await t.token('seller01'));
    const b = t.api(await t.token('seller02'));
    const [ra, rb] = await Promise.all([
      a.post('/invoices', { idempotencyKey: key(), items: [{ productId: p.id, quantity: 4 }], payments: [{ method: 'CASH', amountPaise: 4000 }] }),
      b.post('/invoices', { idempotencyKey: key(), items: [{ productId: p.id, quantity: 3 }], payments: [{ method: 'CASH', amountPaise: 3000 }] }),
    ]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual([201, 409]);
    const sold = ra.status === 201 ? 4 : 3;
    expect(await stockOf(t.ds, p.id)).toBe(5 - sold);
    await assertLedgerConsistent(t.ds, p.id);
  });

  it('12 sellers fire 60 parallel one-unit bills at stock 50 → 50 succeed, 0 left, unique sequential numbers', async () => {
    const p = await makeProduct(admin, { price: 1000, stock: 50 });
    const users = [...SELLERS, 'admin01', 'admin02', 'superadmin'];
    const apis = await Promise.all(users.map(async (u) => t.api(await t.token(u))));
    const requests = Array.from({ length: 60 }, (_, i) =>
      apis[i % apis.length].post('/invoices', {
        idempotencyKey: key(),
        items: [{ productId: p.id, quantity: 1 }],
        payments: [{ method: 'CASH', amountPaise: 1000 }],
      }),
    );
    const results = await Promise.all(requests);
    const ok = results.filter((r) => r.status === 201);
    const short = results.filter((r) => r.status === 409);
    expect(ok).toHaveLength(50);
    expect(short).toHaveLength(10);
    short.forEach((r) => expect(r.body.error.code).toBe('INSUFFICIENT_STOCK'));
    expect(await stockOf(t.ds, p.id)).toBe(0);
    const numbers = ok.map((r) => r.body.data.invoiceNumber as string);
    expect(new Set(numbers).size).toBe(50);
    // gap-free within this burst: the 50 numbers are consecutive
    const seq = numbers.map((n) => Number(n.split('-').pop())).sort((x, y) => x - y);
    expect(seq[seq.length - 1] - seq[0]).toBe(49);
    await assertLedgerConsistent(t.ds, p.id);
    const [{ n }] = await t.ds.query(`SELECT count(*)::int AS n FROM stock_movements WHERE product_id = $1 AND movement_type = 'SALE'`, [p.id]);
    expect(n).toBe(50);
  });

  it('the same idempotency key sent 5 times in parallel creates exactly one invoice', async () => {
    const p = await makeProduct(admin, { price: 1000, stock: 10 });
    const s = t.api(await t.token('seller03'));
    const body = { idempotencyKey: key(), items: [{ productId: p.id, quantity: 2 }], payments: [{ method: 'UPI', amountPaise: 2000 }] };
    const results = await Promise.all(Array.from({ length: 5 }, () => s.post('/invoices', body)));
    results.forEach((r) => expect([200, 201]).toContain(r.status));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
    expect(await stockOf(t.ds, p.id)).toBe(8);
    const [{ n }] = await t.ds.query(`SELECT count(*)::int AS n FROM invoices WHERE idempotency_key = $1`, [body.idempotencyKey]);
    expect(n).toBe(1);
  });

  it('parallel payments can never exceed the bill total', async () => {
    const p = await makeProduct(admin, { price: 10000, stock: 10 });
    const s = t.api(await t.token('seller04'));
    const inv = await s.post('/invoices', { idempotencyKey: key(), items: [{ productId: p.id, quantity: 1 }], customer: { name: 'Race Payer' } });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => s.post(`/invoices/${inv.body.data.id}/payments`, { idempotencyKey: key(), payments: [{ method: 'CASH', amountPaise: 4000 }] })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    const final = await s.get(`/invoices/${inv.body.data.id}`);
    expect(final.body.data.amountPaidPaise).toBe(8000);
    expect(final.body.data.outstandingPaise).toBe(2000);
    expect(await stockOf(t.ds, p.id)).toBe(9);
  });

  it('concurrent decreasing adjustments and sales never drive stock negative', async () => {
    const p = await makeProduct(admin, { price: 1000, stock: 10 });
    const s = t.api(await t.token('seller05'));
    const ops = [
      ...Array.from({ length: 6 }, () => s.post('/invoices', { idempotencyKey: key(), items: [{ productId: p.id, quantity: 2 }], payments: [{ method: 'CASH', amountPaise: 2000 }] })),
      ...Array.from({ length: 4 }, () => admin.post('/inventory/adjustments', { productId: p.id, type: 'DAMAGED', quantity: 2, reason: 'Rain damage' })),
    ];
    const results = await Promise.all(ops);
    const okUnits = results.filter((r) => r.status === 201).length * 2;
    expect(okUnits).toBeLessThanOrEqual(10);
    expect(await stockOf(t.ds, p.id)).toBe(10 - okUnits);
    expect(await stockOf(t.ds, p.id)).toBeGreaterThanOrEqual(0);
    await assertLedgerConsistent(t.ds, p.id);
  });
});
