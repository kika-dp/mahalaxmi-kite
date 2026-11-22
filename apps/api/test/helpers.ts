import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';

export const PASSWORDS: Record<string, string> = {
  superadmin: 'KiteDev@2026#01',
  admin01: 'KiteDev@2026#02',
  admin02: 'KiteDev@2026#03',
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`seller0${i + 1}`, `KiteDev@2026#${String(i + 4).padStart(2, '0')}`])),
};

export interface TestCtx {
  app: INestApplication;
  ds: DataSource;
  http: () => ReturnType<typeof request>;
  token: (username: string) => Promise<string>;
  api: (token: string) => Api;
  close: () => Promise<void>;
}

export interface Api {
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  patch: (url: string, body?: object) => request.Test;
  put: (url: string, body?: object) => request.Test;
  del: (url: string) => request.Test;
}

export async function createTestApp(): Promise<TestCtx> {
  // Imported lazily so setup-env.ts has already pointed DATABASE_URL at the test database.
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/bootstrap');
  const { loadEnv } = await import('../src/config/env');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  await configureApp(app, loadEnv());
  await app.init();
  const server = app.getHttpServer();
  const tokens = new Map<string, string>();
  const ctx: TestCtx = {
    app,
    ds: app.get(DataSource),
    http: () => request(server),
    token: async (username) => {
      if (tokens.has(username)) return tokens.get(username)!;
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ identifier: username, password: PASSWORDS[username], client: 'mobile' });
      if (res.status !== 200) throw new Error(`login ${username} failed: ${res.status} ${JSON.stringify(res.body)}`);
      tokens.set(username, res.body.data.accessToken);
      return res.body.data.accessToken;
    },
    api: (token) => {
      const h = (t: request.Test) => t.set('Authorization', `Bearer ${token}`);
      return {
        get: (url) => h(request(server).get(`/api/v1${url}`)),
        post: (url, body) => h(request(server).post(`/api/v1${url}`)).send(body ?? {}),
        patch: (url, body) => h(request(server).patch(`/api/v1${url}`)).send(body ?? {}),
        put: (url, body) => h(request(server).put(`/api/v1${url}`)).send(body ?? {}),
        del: (url) => h(request(server).delete(`/api/v1${url}`)),
      };
    },
    close: () => app.close(),
  };
  return ctx;
}

let counter = 0;
export const uniq = (prefix = 'T') => `${prefix}${Date.now().toString(36).toUpperCase()}${(counter++).toString(36).toUpperCase()}`;
export const key = () => randomUUID();

export async function categoryId(api: Api, name = 'Regular Kites'): Promise<string> {
  const res = await api.get('/categories');
  return res.body.data.find((c: { name: string }) => c.name === name).id;
}

/** Create a STANDARD product with opening stock via the API (as admin). */
export async function makeProduct(
  api: Api,
  opts: { price?: number; cost?: number; stock?: number; name?: string; min?: number; category?: string } = {},
): Promise<{ id: string; sku: string; name: string }> {
  const sku = uniq('P');
  const res = await api.post('/products', {
    name: opts.name ?? `Kite ${sku}`,
    sku,
    categoryId: await categoryId(api, opts.category),
    kind: 'STANDARD',
    unitType: 'PIECE',
    sellingPricePaise: opts.price ?? 2000,
    purchasePricePaise: opts.cost ?? 1200,
    minStockAlert: opts.min ?? 5,
    openingStock: opts.stock ?? 100,
  });
  if (res.status !== 201) throw new Error(`makeProduct failed ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.data.id, sku, name: res.body.data.name };
}

export async function stockOf(ds: DataSource, productId: string): Promise<number> {
  const [r] = await ds.query(`SELECT quantity FROM stock_balances WHERE product_id = $1`, [productId]);
  return r.quantity;
}

/** Ledger invariant: last movement's new_quantity == balance and Σ changes == balance. */
export async function assertLedgerConsistent(ds: DataSource, productId: string): Promise<void> {
  const [r] = await ds.query(
    `SELECT sb.quantity,
            COALESCE((SELECT sum(quantity_change) FROM stock_movements WHERE product_id = $1), 0)::int AS sum_changes,
            (SELECT new_quantity FROM stock_movements WHERE product_id = $1 ORDER BY seq DESC LIMIT 1) AS last_new
     FROM stock_balances sb WHERE sb.product_id = $1`,
    [productId],
  );
  expect(r.sum_changes).toBe(r.quantity);
  if (r.last_new !== null) expect(r.last_new).toBe(r.quantity);
}
