# Architecture

## System context

```
 iPhones (Expo/React Native POS) ─┐            ┌─ Web CRM (Next.js, browser)
                                   │ HTTPS/JSON │
                                   ▼            ▼
                         ┌───────────────────────────────┐
                         │  NestJS API (modular monolith) │── uploads/ (product images, logo)
                         │  /api/v1  ·  Swagger /api/docs │
                         └──────────────┬────────────────┘
                                        │ TypeORM (pg pool)
                                        ▼
                                  PostgreSQL 14+
```

Single deployable API; CRM is a separate Next.js server (or static-ish Node server) that talks to the API from the browser. The mobile app talks to the API directly. Reverse proxy (Caddy) terminates TLS for both.

## Repository layout

```
kite-shop-platform/
├── apps/
│   ├── api/                 NestJS
│   │   ├── src/
│   │   │   ├── main.ts, app.module.ts
│   │   │   ├── config/      env schema (zod), typed config
│   │   │   ├── common/      filters, guards, decorators, interceptors, money transformer, errors, pagination
│   │   │   ├── database/    data-source.ts, migrations/, seeds/
│   │   │   └── modules/
│   │   │       auth/ users/ audit/ settings/ catalog/ inventory/ suppliers/
│   │   │       customers/ invoices/ cash/ dashboard/ reports/ documents/ health/ me/
│   │   └── test/            integration & e2e (supertest, real Postgres)
│   ├── crm/                 Next.js 15 App Router
│   │   └── src/app/(auth)/login, (app)/dashboard, products, inventory, bills, …
│   └── mobile/              Expo SDK 54, Expo Router
│       └── app/(auth)/login, (app)/(tabs)/index|bills|outstanding|profile, bill/new, …
├── packages/
│   ├── shared/              enums, permissions, money, billing calc, zod schemas, DTO types
│   └── api-client/          typed fetch client with token refresh hooks
├── docs/
├── docker-compose.yml, Caddyfile, .env.example
└── .github/workflows/ci.yml
```

## Backend module responsibilities

| Module | Owns | Key collaborators |
|---|---|---|
| auth | login, tokens, sessions, password change, lockout | users, audit |
| users | CRUD, activation, reset, session revoke | auth (sessions), audit |
| audit | `AuditService.log()` (accepts an EntityManager to join the caller's transaction) | all |
| settings | shop settings, seasons, logo | — |
| catalog | categories, products, bundles, images, CSV, availability calc | inventory (balances) |
| inventory | `StockService.apply(manager, changes[])` — the only writer of stock; ledger; adjustments; counts | audit |
| suppliers | suppliers, purchases, supplier payments | inventory, sequences |
| customers | customers, statements, multi-invoice collection | invoices (payments) |
| invoices | preview, create, payments, returns, refunds, void, repeat | shared billing, inventory, sequences, customers, audit |
| documents | PDF rendering (invoice A4/thermal, customer statement) | invoices, settings |
| cash | cash sessions, movements, closing summary | payments (read) |
| dashboard / reports | read-only SQL aggregates; CSV/XLSX serialization | — |

### Transaction pattern
Services that write money/stock open a transaction with `dataSource.transaction(async (m) => …)` and pass the `EntityManager` to collaborators (`StockService.apply(m, …)`, `SequenceService.next(m, …)`, `AuditService.log(m, …)`). Nothing in a write path uses the global repository. On PostgreSQL `40P01` (deadlock) or `40001`, the invoice transaction is retried once.

### Request pipeline
`helmet → CORS → requestId → pino-http → ThrottlerGuard → JwtAuthGuard (+ session/active check, must-change-password gate) → PermissionsGuard → ValidationPipe (whitelist, forbidNonWhitelisted, transform) → controller → service → ResponseInterceptor ({data}) → AllExceptionsFilter (error envelope)`.

## Frontend architecture

**CRM**: Next.js App Router, client-side data fetching with TanStack Query through `@kite/api-client`. Access token lives in memory only. For `client: "crm"` logins the API sets the refresh token as an **httpOnly, `SameSite=Strict`, `Secure` (prod) cookie scoped to `/api/v1/auth`** and omits it from the JSON body; the CRM and API are deployed same-site (`crm.example.com` / `api.example.com`, or `localhost:3000` / `localhost:4000` in dev), so `fetch(..., {credentials: "include"})` with CORS credentials restricted to the CRM origin works without a BFF. On page load the CRM calls `/auth/refresh` to obtain an access token. JavaScript can never read the refresh token. Zustand for UI state (sidebar, filters). React Hook Form + Zod for forms, Recharts for charts, Tailwind 4 + shadcn-style components (Radix primitives).

**Mobile**: Expo Router stack + tabs. Tokens in `expo-secure-store`. TanStack Query with AsyncStorage persister (catalog, summaries). Zustand store for the cart (persisted). `@react-native-community/netinfo` for connectivity. `expo-camera` for barcode scanning. `expo-file-system` + `expo-sharing` + `expo-print` for PDF share/print. Billing preview computed locally with `@kite/shared` and reconciled with server response.

## Shared contracts
`@kite/shared` exports: enums (Role, ProductKind, UnitType, PaymentMethod, …), `PERMISSIONS`/`roleHas()`, money helpers (`rupeesToPaise`, `formatINR`), `calculateBill()`, Zod schemas for request bodies (used by CRM/mobile forms; API uses class-validator DTOs mirroring them), and response TypeScript types. It is built to CommonJS + `.d.ts` (`tsc`) and consumed by all apps.

## Key flows

### Checkout (mobile)
1. Cart built offline-capable from cached catalog; idempotency key generated when the cart is created.
2. Tap Checkout → `POST /invoices` (button locked).
3. API transaction: idempotency check → products → calc → discount auth → customer → lock stock → movements → number → invoice/items/payments → audit → commit.
4. 201 → success screen with number, totals, share/print; cart cleared; catalog & summary invalidated.
5. Network error → retry with the same key (safe).

### Later payment
`POST /invoices/:id/payments` → lock invoice → validate ≤ outstanding → insert payment(s) → recompute aggregates/status → audit → commit. No stock code path is reachable.

## Scalability notes
Expected load: ~12 writers, a few CRM readers, ~5k bills/day peak. A single 2 vCPU/4 GB VM runs API + Postgres comfortably. Hot paths are indexed; dashboard queries aggregate by indexed `created_at`. If needed later: read replica for reports, Redis for throttling across instances.
