# Progress Log

> **Continuation protocol**: read `plan.md`, `specification.md` and this file first, then inspect the repository (`git log`, `git status`, run the tests) before assuming anything is done. Resume from the latest verified checkpoint below. Only mark items ✅ when they work and tests pass.

Legend: ✅ done & verified · 🟡 in progress / partially verified · ⬜ not started · ⚠️ blocked

## Environment facts (dev machine, 2026-11-22)
- Node 24.2, pnpm 10.33, PostgreSQL 14.18 (Homebrew), no Docker, **no Xcode** (Command Line Tools only → iOS simulator unavailable here; mobile verified by typecheck/lint/export).
- Local DBs: `kite` and `kite_test`, owned by role `kite` (password `kite`), created with `createdb -O kite`.
- Pinned stack: NestJS 11.2, TypeORM 0.3.31, Next.js 15.5, Tailwind 4.1, Expo SDK 54, Zod 3.25 (plan.md D3).

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 1 Documentation | ✅ | All docs in `docs/` (deployment.md finalized in Phase 8) |
| 2 Foundation | ✅ | Monorepo, shared package, NestJS app, migration, auth, RBAC, 12-user seeder |
| 3 Catalog & inventory | ✅ | Categories, products, bundles, CSV, ledger, receipts, adjustments+approval, counts, suppliers, purchases |
| 4 Billing engine | ✅ | Preview, create (idempotent), discounts+override, payments, returns, refunds, void, PDFs, me/summary |
| 5 CRM | ⬜ | |
| 6 Mobile | ⬜ | |
| 7 Advanced | 🟡 | Backend done: combos, cash closing, returns/refunds, seasonal report, supplier payments. UI pending. |
| 8 Quality & prod | 🟡 | API test suites done; Docker/CI/deploy docs/load test pending |

## Checkpoints
- 2026-11-22 — Phase 1 complete.
- 2026-11-22 — Phases 2–4 complete (commit `927f26a`). API typechecks, builds (`nest build`), all tests green.

## Decisions log (beyond plan.md D1–D16)
- D17: Enums stored as `varchar` + `CHECK` constraints (not PG enum types) — easier migrations.
- D18: `stock_movements.seq bigserial` gives strict ledger order (rows in one transaction share `now()`).
- D19: Session validity keyed on the refresh-token **family** id (`sid` claim), so access tokens stay valid across refresh rotation but die immediately on logout/revoke/deactivate.
- D20: Refresh-token errors are returned from the transaction and thrown after commit, so reuse-detection revocations persist (bug found by tests and fixed).
- D21: Invoice number is allocated before stock movements so ledger rows carry it; the ledger stays append-only (no UPDATE). Rollback keeps numbering gap-free.
- D22: Product `kind` is immutable after creation (stricter than spec "after first sale").
- D23: Invoice PDFs use bundled Noto Sans (OFL) for the ₹ glyph; falls back to "Rs." if missing.
- D24: Login limiter: 5/min per IP+identifier, 30/min per IP (a shop shares one NAT IP), plus 10-failure account lock.
- D25: Test DB reset uses `DROP OWNED BY CURRENT_USER` (no schema ownership needed); refuses URLs without "test".

## Known issues / blockers
- iOS simulator/device runs cannot be performed on this machine (no Xcode). Use EAS Build or a Mac with Xcode (deployment.md).

## Test results (actual runs)
| Date | Command | Result |
|---|---|---|
| 2026-11-22 | `pnpm --filter @kite/shared test` | 2 suites, **40/40 passed** |
| 2026-11-22 | `pnpm --filter api test` (unit) | 1 suite, **6/6 passed** |
| 2026-11-22 | `pnpm --filter api test:e2e` (real Postgres) | 6 suites, **48/48 passed** — auth (11), RBAC (5), catalog/inventory (9), invoices (17), concurrency (5), full 14-step flow (1) |
