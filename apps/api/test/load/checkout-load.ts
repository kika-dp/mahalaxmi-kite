/**
 * Load test: 12 concurrent sellers creating real bills + catalog/search reads.
 *   API_URL=http://localhost:4000/api/v1 pnpm --filter api load
 * Requires the dev seed (12 users, SEED_MUST_CHANGE_PASSWORD=false) and the demo catalog.
 * WARNING: creates real invoices and deducts stock — run against a scratch database only.
 */
import autocannon from 'autocannon';
import { randomUUID } from 'crypto';

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const DURATION = Number(process.env.DURATION ?? 20);
const USERS = Array.from({ length: 9 }, (_, i) => [`seller0${i + 1}`, `KiteDev@2026#${String(i + 4).padStart(2, '0')}`]).concat([
  ['admin01', 'KiteDev@2026#02'],
  ['admin02', 'KiteDev@2026#03'],
  ['superadmin', 'KiteDev@2026#01'],
]);

async function login(identifier: string, password: string): Promise<string> {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  if (!r.ok) throw new Error(`login ${identifier}: ${r.status} ${await r.text()}`);
  return ((await r.json()) as { data: { accessToken: string } }).data.accessToken;
}

function run(opts: autocannon.Options): Promise<autocannon.Result> {
  return new Promise((resolve, reject) => autocannon(opts, (err, res) => (err ? reject(err) : resolve(res))));
}

function report(name: string, r: autocannon.Result) {
  const non2xx = r.non2xx;
  console.log(
    `${name.padEnd(28)} req/s ${r.requests.average.toFixed(1).padStart(7)} | p50 ${String(r.latency.p50).padStart(4)} ms | p97.5 ${String(r.latency.p97_5).padStart(4)} ms | p99 ${String(r.latency.p99).padStart(4)} ms | max ${String(r.latency.max).padStart(5)} ms | non-2xx ${non2xx} | errors ${r.errors}`,
  );
}

(async () => {
  const tokens = await Promise.all(USERS.map(([u, p]) => login(u, p)));
  const cat = (await (await fetch(`${API}/products/pos-catalog`, { headers: { authorization: `Bearer ${tokens[0]}` } })).json()) as {
    data: { products: { id: string; kind: string; availableQuantity: number; sellingPricePaise: number }[] };
  };
  const stocked = cat.data.products.filter((p) => p.kind === 'STANDARD' && p.availableQuantity > 500).map((p) => p.id);
  if (stocked.length < 2) throw new Error('Need the demo catalog with plenty of stock (seed:dev -- --with-demo-catalog)');
  // Top up stock (admin) so the run measures throughput, not stock-outs.
  const topUp = await fetch(`${API}/inventory/receipts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[9]}` },
    body: JSON.stringify({ items: stocked.map((productId) => ({ productId, quantity: 200_000 })), reason: 'Load test top-up' }),
  });
  if (!topUp.ok) throw new Error(`top-up failed: ${await topUp.text()}`);
  console.log(`Load test: ${tokens.length} concurrent users, ${DURATION}s per scenario, ${stocked.length} products\n`);

  let i = 0;
  const checkout = await run({
    url: `${API}/invoices`,
    connections: tokens.length,
    duration: DURATION,
    requests: [
      {
        method: 'POST',
        setupRequest: (req) => {
          const n = i++;
          const items = [
            { productId: stocked[n % stocked.length], quantity: 1 },
            { productId: stocked[(n + 1) % stocked.length], quantity: 1 },
            { productId: stocked[(n + 2) % stocked.length], quantity: 1 },
          ].filter((x, k, a) => a.findIndex((y) => y.productId === x.productId) === k);
          return {
            ...req,
            headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[n % tokens.length]}` },
            body: JSON.stringify({ idempotencyKey: randomUUID(), items, customer: { name: 'Load Test' } }),
          };
        },
      },
    ],
  });
  report('POST /invoices (3 lines)', checkout);

  const search = await run({ url: `${API}/products?q=kite&pageSize=25`, connections: tokens.length, duration: Math.ceil(DURATION / 2), headers: { authorization: `Bearer ${tokens[1]}` } });
  report('GET /products?q=kite', search);
  const pos = await run({ url: `${API}/products/pos-catalog`, connections: tokens.length, duration: Math.ceil(DURATION / 2), headers: { authorization: `Bearer ${tokens[2]}` } });
  report('GET /products/pos-catalog', pos);
  const dash = await run({ url: `${API}/dashboard/summary`, connections: 3, duration: Math.ceil(DURATION / 2), headers: { authorization: `Bearer ${tokens[9]}` } });
  report('GET /dashboard/summary', dash);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
