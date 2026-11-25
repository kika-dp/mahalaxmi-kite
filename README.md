# Uttarayan Kite Shop Platform

Billing, inventory and sales management for a retail kite shop during the Uttarayan rush.

| App | Stack | For |
|---|---|---|
| `apps/api` | NestJS 11 · TypeORM · PostgreSQL | All business rules, the only writer to the database |
| `apps/crm` | Next.js 15 · Tailwind 4 · TanStack Query · Recharts | Owners, admins, inventory staff |
| `apps/mobile` | Expo SDK 58 (React Native) · Expo Router | Salespeople billing on iPhones |
| `packages/shared` | TypeScript | Money (integer paise), billing engine, permissions, contracts |
| `packages/api-client` | TypeScript | Typed HTTP client used by both apps |

## Quick start
```bash
corepack enable && pnpm install
cp .env.example .env     # set JWT_ACCESS_SECRET (openssl rand -base64 48)
docker compose up -d db  # or a local PostgreSQL — see docs/deployment.md
pnpm build:packages
pnpm --filter api migration:run
pnpm --filter api seed:dev -- --with-demo-catalog
pnpm dev:api             # :4000  (Swagger at /api/docs)
pnpm dev:crm             # :3000  — sign in as admin01 / KiteDev@2026#02
pnpm dev:mobile          # Expo dev build — sign in as seller01 / KiteDev@2026#04
```
Dev accounts (12 users) are listed in [docs/deployment.md](docs/deployment.md) §2. They exist only in development and must change their password at first sign-in.

## Guarantees (tested)
- Stock is deducted exactly once per bill, in the same transaction as the bill; failed checkouts change nothing.
- Concurrent sellers can't oversell (row locks in a fixed order + a `CHECK (quantity >= 0)` constraint).
- Invoice numbers are unique and gap-free under concurrency (`KITE-2026-000001`).
- Retried or double-tapped checkouts never create a second bill (idempotency keys).
- Prices, discounts, totals and payment status are always computed by the server.
- Payments never move stock; returns and voids restore it through the ledger.
- Dashboards and reports come only from real transactions; unpaid bills are never counted as collected cash.

## Documentation
[plan](docs/plan.md) · [specification](docs/specification.md) · [architecture](docs/architecture.md) · [database schema](docs/database-schema.md) · [API](docs/api-specification.md) · [UI/UX](docs/ui-ux-specification.md) · [security](docs/security.md) · [testing](docs/testing-plan.md) · [deployment](docs/deployment.md) · [free hosting: Neon + Render + Vercel](docs/deployment-free.md) · [progress](docs/progress.md)

## Tests
```bash
pnpm test                 # unit tests
pnpm test:e2e             # API integration tests against PostgreSQL (kite_test)
pnpm --filter crm test:e2e   # Playwright smoke test (needs API + CRM running)
pnpm --filter api load       # load test (scratch database)
```
