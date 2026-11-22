# Testing Plan

## Levels

| Level | Tooling | Location | Runs against |
|---|---|---|---|
| Unit | Jest + ts-jest | `packages/shared/src/**/*.spec.ts`, `apps/api/src/**/*.spec.ts` | pure functions, services with fakes |
| Integration | Jest + supertest | `apps/api/test/*.e2e-spec.ts` | real NestJS app + real PostgreSQL database `kite_test` (dropped & migrated at suite start) |
| Concurrency | Jest + supertest, `Promise.all` | `apps/api/test/concurrency.e2e-spec.ts` | same |
| End-to-end (business flow) | Jest + supertest | `apps/api/test/full-flow.e2e-spec.ts` | API exactly as CRM + mobile call it |
| CRM UI smoke | Playwright | `apps/crm/e2e/` | running API + CRM |
| Mobile | TypeScript typecheck, ESLint, Jest unit tests for cart store | `apps/mobile` | — (device testing manual; see checklist) |
| Load | autocannon script | `apps/api/test/load/checkout-load.ts` | running API |

Commands: `pnpm test` (unit, all packages) · `pnpm --filter api test:e2e` (integration; needs Postgres, env `DATABASE_URL_TEST`) · `pnpm --filter crm test:e2e` · `pnpm --filter api load`.

## Unit coverage
- Billing: gross, line fixed/percent discounts, bill fixed/percent discounts, order of application, allocation sums exactly, rounding half-up, tax exclusive, 0 and 100% discounts, discount > eligible rejected, spec §8.2 example.
- Payment status derivation for all states incl. returns and refunds.
- Return line valuation incl. final-unit remainder.
- Money parsing/formatting (`"12.5"` → 1250, invalid inputs).
- Permissions: role matrix snapshot; `roleHas`.
- Phone normalization; SKU normalization.
- Invoice number formatting.
- Low-stock detection.
- Bundle availability calc.

## Integration coverage
- Auth: login by username/email; wrong password; lockout; must-change gate; change password; refresh rotation; reuse detection; logout; deactivated user blocked; all 12 seed users log in with expected role.
- Seeder: run twice → still 12 users, no duplicate categories.
- RBAC: salesperson forbidden routes; ownership 404.
- Products: create/update/archive, SKU uniqueness, bundle validation, cost field hiding, CSV import all-or-nothing, bulk price with audit.
- Inventory: opening, receipt, adjustment (applied/pending/approve/reject), negative prevention, count variance, movement ledger consistency (`Σ changes = balance`).
- Invoices: create (cash, split, partial, unpaid w/ customer, unpaid w/o customer → 422), discount cap & manager override, inactive product, insufficient stock (no side effects), bundle deduction, idempotent replay, key conflict, number format & sequence.
- Payments: later payment, mark paid, overpayment, payment on void, no stock change.
- Returns: partial, full, restock vs not, refund within credit, over-return rejected.
- Void: stock restore, refund required when paid, double void rejected.
- Dashboard: known fixture → exact KPI values.
- Cash session: expected cash formula, difference.
- Rollback: forced failure after stock update (test-only fault injection via invalid payment) leaves stock unchanged.

## Concurrency tests
1. Stock 5; 2 sellers request 4 and 3 simultaneously → exactly one 201, one 409; final stock ≥ 0 and equals 5 − sold.
2. Stock 50; 12 sellers × 5 parallel bills of 1 unit (60 requests) → 50 succeed, 10 fail, stock 0, 50 unique sequential invoice numbers, ledger sums match.
3. Same idempotency key sent 5× in parallel → 1 invoice, all responses reference it.
4. Parallel payments exceeding outstanding → total paid never exceeds total.

## Full business flow (prompt §24 E2E)
Admin login → create product → receive 100 → seller login → bill 10 units, ₹20 discount, partial payment → invoice created → stock 90 → admin lists bills and sees it → dashboard reflects sale & payment → admin records remaining payment → status PAID → stock still 90.

## Manual device checklist (iOS)
Login/logout/remember; forced change; favorites add speed; scanner; discount over cap with manager approval; split payment; partial requires name; offline banner and disabled checkout; airplane-mode during checkout then retry → single bill; share to WhatsApp; AirPrint; app killed with cart → cart restored; session revoked from CRM → login with cart preserved.

## Test data
Integration tests create their own data via API; seed users come from the dev seeder with `SEED_MUST_CHANGE_PASSWORD=false`.

## Results
Recorded per run in progress.md (date, command, pass/fail counts). Results are never fabricated.
