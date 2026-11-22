# Implementation Plan — Uttarayan Kite Shop Platform

Last updated: 2026-11-22 · Status tracking lives in [progress.md](progress.md). Requirements live in [specification.md](specification.md).

## 1. Goals and priorities
1. **Correctness** of stock and money under concurrent billing (non-negotiable rules in spec §8–10).
2. **Speed** of billing on the shop floor (a 3-item cash bill in < 10 seconds of taps).
3. **Operability** by non-technical staff (large targets, minimal typing, clear errors).
4. **Accountability**: every money/stock change is attributable and auditable.

The first real use is Uttarayan 2027 (14 Jan 2027). Everything needed for the counter (catalog, stock, billing, payments, invoices, CRM bills/dashboard) is on the critical path; advanced reports and polish follow.

## 2. Architecture decisions (summary; detail in architecture.md)

| # | Decision | Rationale |
|---|---|---|
| D1 | pnpm-workspace monorepo: `apps/api`, `apps/crm`, `apps/mobile`, `packages/shared`, `packages/api-client` | One repo, shared contracts. `node-linker=hoisted` for React Native compatibility. |
| D2 | Modular monolith NestJS 11 + TypeORM 0.3 + PostgreSQL | 12 users do not need microservices; transactions across stock+billing need one DB. |
| D3 | Pinned to latest *stable major lines with known APIs*: NestJS 11, TypeORM 0.3, Next.js 15, Tailwind 4.1, Expo SDK 54, Zod 3 | Newer majors exist (NestJS 12, TypeORM 1.x) but correctness > novelty. Upgrade later deliberately. |
| D4 | Money in integer paise (`bigint`), percentages in bps | No floating-point in finance. |
| D5 | Stock only on STANDARD products; packets/combos are BUNDLE products deducting components | Single physical stock; no duplicate inventory. |
| D6 | Stock changes via `SELECT … FOR UPDATE` in sorted order + `CHECK (quantity >= 0)` | Prevents overselling and deadlocks; DB is final guard. |
| D7 | Invoice numbers from a `document_sequences` row updated inside the invoice transaction | Unique, gap-free, concurrency-safe. |
| D8 | Client-generated idempotency key per cart + request hash | Double-taps/retries never create duplicate bills. |
| D9 | Billing math in `packages/shared` (pure functions) used by API (authoritative) and mobile (preview) | Same formula everywhere; server always recomputes. |
| D10 | Roles as enum + static permission map (not DB-configurable) | Fixed, testable, small attack surface. Prompt suggested a Role entity; not needed for 4 fixed roles. |
| D11 | JWT access (15 min) + rotating opaque refresh tokens with reuse detection; server-side session check per request | Revocation and deactivation take effect immediately. |
| D12 | **Online-only checkout in v1**; offline = cached catalog, persisted cart, clear status | Safe offline finalization needs stock reservation and reconciliation that can oversell. Revisit after season 1. |
| D13 | Server-side PDF (pdfkit) for invoices/statements; mobile downloads & shares via iOS share sheet / AirPrint | One rendering path, consistent documents, works for CRM and mobile. |
| D14 | `packages/shared` merges the suggested `shared-types` + `validation` packages | Fewer build units; Zod schemas and types live together. |
| D15 | Product images on local disk volume (`UPLOAD_DIR`), served by API | Simple single-node deploy; S3 adapter can replace later. |
| D16 | Business dates computed in SQL with `AT TIME ZONE 'Asia/Kolkata'` | Correct day boundaries regardless of server TZ. |

## 3. Module map and dependencies

```
auth ─► users ─► audit
settings, seasons
catalog (categories, products, bundles) ─► inventory (balances, ledger, adjustments, counts)
suppliers/purchases ─► inventory
customers
billing (calc in shared) ─► invoices ─► inventory, sequences, payments, customers, audit
returns/refunds/void ─► invoices, inventory, payments
cash-sessions ─► payments (read)
dashboard/reports ─► read models over invoices, payments, returns, inventory
documents (PDF) ─► invoices, customers, settings
```

## 4. Phases, tasks, acceptance criteria

### Phase 1 — Architecture & documentation
Tasks: requirements analysis; all docs in `docs/`; `.env.example`.
Acceptance: docs exist, decisions recorded, API contracts defined before UI work.

### Phase 2 — Foundation
Tasks: workspace + tooling (TS strict, ESLint, Prettier); `packages/shared` (enums, permissions, money, billing calc, zod schemas); NestJS app (config validation, pino logging with redaction, global exception filter + error envelope, request id, validation pipe, Swagger, helmet, CORS, throttler, health); TypeORM data source + initial migration; auth (login, refresh rotation, logout, me, change-password, lockout); RBAC guards; users module; audit module; dev seeder (12 users, idempotent) + prod bootstrap; docker-compose; CI workflow.
Acceptance: all 12 users log in; must-change-password enforced; refresh reuse revokes family; seeder twice → 12 users; RBAC unit tests pass.

### Phase 3 — Catalog & inventory
Tasks: categories; products CRUD + search (trigram) + images + CSV import/export + bulk price; bundles; stock balances; ledger service; opening/receipts; adjustments with approval; stock counts; low stock; suppliers; purchases; supplier payments; daily stock.
Acceptance: no stock change without a movement row; concurrent adjustments cannot go negative; import is all-or-nothing; cost fields hidden from salesperson.

### Phase 4 — Billing engine
Tasks: shared calc + unit tests; invoice preview; invoice create transaction (idempotency, discount caps + manager override, customer resolution, bundle expansion, locks, sequence, payments); payments; returns; refunds; void; PDF (A4 + thermal); repeat bill; me/summary.
Acceptance: spec §8.2 example (₹550 − ₹50, ₹300 paid → PARTIALLY_PAID, ₹200 outstanding) passes; 12 concurrent sellers on stock 5 never oversell; duplicate key → one invoice; payment never moves stock; return/void restore stock exactly once.

### Phase 5 — CRM (Next.js)
Tasks: design system (tokens, shadcn-style components); auth (login, forced password change, token refresh); layout (sidebar, topbar); Dashboard; Products, Product form, Categories; Inventory, Movements, Adjustments (+approvals), Stock counts, Low stock; Suppliers, Purchases; Bills list + detail (payments, returns, refund, void, PDF); Customers + detail + statement; Outstanding; Reports (+exports); Users; Settings (shop, seasons); Cash closing; Audit logs.
Acceptance: every screen uses live API data; RBAC-aware navigation; destructive actions confirm; forms validate with Zod; build passes.

### Phase 6 — Mobile POS (Expo, iOS)
Tasks: Expo Router app; login + forced change; secure token storage + refresh; home summary; catalog cache with freshness; New Bill (favorites grid, search, category chips, barcode scan, cart, qty steppers); discount sheet (fixed/percent, manager override); checkout (Paid/Partial/Unpaid, Cash/UPI/Card/Other, split, cash tendered → change); success screen; invoice PDF preview/share/print; history; bill detail (+collect payment); outstanding list; profile/settings; network banner; persisted cart.
Acceptance: typecheck + lint pass; `expo export --platform ios` bundles; full flow against local API (via Expo dev build on simulator/device — requires Xcode, see deployment.md).

### Phase 7 — Advanced
Combos (bundles), barcode scanning, supplier payments, cash closing, returns/refunds, seasonal comparison reports, offline resilience (baseline). Most are built inside phases 3–6; this phase closes gaps.

### Phase 8 — Quality & production readiness
Tasks: integration test suite against real Postgres (auth, products, inventory, invoices, concurrency, idempotency, payments, returns, void, cash, seeder); API-level end-to-end flow test (spec'd 14 steps); Playwright CRM smoke test; load script (autocannon) for checkout & search; security review (OWASP checklist in security.md); Dockerfiles + compose prod profile; backup/restore scripts; deployment docs.
Acceptance: all suites green; load targets in spec §22 met or deviations recorded; no open critical defects.

## 5. Testing & verification strategy
See [testing-plan.md](testing-plan.md). Summary: unit (Jest) for pure logic; integration (Jest + supertest + real Postgres `kite_test`, migrations applied fresh per run); concurrency tests with parallel requests; API e2e of the full business flow; CRM Playwright smoke; mobile typecheck/lint/unit tests on cart store & calc; manual device checklist.

## 6. Security & deployment
See [security.md](security.md) and [deployment.md](deployment.md).

## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Internet outage at shop during rush | Billing halts | Online-only v1; recommend 4G hotspot backup + LAN server option (API can run on a shop laptop; deployment.md "LAN mode"). Cart persists; no duplicate bills. Offline finalization deferred (D12). |
| iOS build needs Xcode / Apple developer account | Can't install on iPhones | Documented EAS Build cloud path (no local Xcode needed) + TestFlight/Ad-hoc. This dev machine has no Xcode — mobile verified via typecheck/export only here. |
| Deadlocks under concurrency | Failed bills | Sorted locking order; retry on `40P01` once; tested. |
| Wrong prices billed | Revenue loss | Server price only; audit of price changes; mobile preview reconciles with server total. |
| Data loss | Severe | Nightly `pg_dump` + pre-deploy dump; restore drill documented. |
| Staff misuse (discounts, voids) | Loss | Discount caps + manager override, admin-only void/return, audit log, salesperson performance report. |
| Library major upgrades | Breakage | Pinned versions, lockfile committed. |

## 8. Overall completion checklist (Definition of Done — prompt §29)
- [x] CRM runs (`next build` + `next start`, Playwright smoke test passed)
- [ ] Mobile app runs on simulator/device — **not verifiable on the dev machine (no Xcode)**; typecheck, unit tests and iOS JS bundle verified
- [x] All 12 seed users log in with correct access (integration test)
- [x] Admin creates/modifies products
- [x] Admin receives and adjusts stock
- [x] Mobile user creates a real bill (API flow tested exactly as the app calls it; on-device run pending)
- [x] Manual discounts (fixed/percent) work, incl. manager override
- [x] Payment statuses work; partial payments work
- [x] Stock deducts automatically, exactly once
- [x] Concurrent billing does not corrupt stock (tests + 4,738-bill load test)
- [x] Bills appear in CRM
- [x] Admin views/downloads invoices (A4 + 80 mm PDF)
- [x] Dashboard accurate (delta tests)
- [x] Low-stock alerts work
- [x] Reports generate (JSON/CSV/XLSX)
- [x] Returns/voids preserve integrity (tests)
- [x] Test suites pass
- [x] No known critical security/financial defects (see security.md audit notes)
- [x] Setup & deployment docs complete
