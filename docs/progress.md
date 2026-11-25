# Progress Log

> **Continuation protocol**: read `plan.md`, `specification.md` and this file first, then inspect the repository (`git log`, `git status`, run the tests) before assuming anything is done. Resume from the latest verified checkpoint below. Only mark items ✅ when they work and tests pass.

Legend: ✅ done & verified · 🟡 done, partially verified · ⬜ not started · ⚠️ blocked

## Environment facts (dev machine, 2026-11-22)
- Node 24.2, pnpm 10.33, PostgreSQL 14.18 (Homebrew), no Docker, **no Xcode** (Command Line Tools only → iOS simulator unavailable; mobile verified by typecheck, unit tests and `expo export`).
- Local DBs (owner role `kite`/`kite`): `kite` (dev, demo catalog), `kite_test` (integration tests; wiped each run), `kite_e2e` (Playwright + load test data, ~4,800 bills).
- Pinned stack: NestJS 11.2, TypeORM 0.3.31, Next.js 15.5, Tailwind 4.1, Expo SDK 58 (RN 0.88, React 19.3), Zod 3.25 (plan.md D3).

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 1 Documentation | ✅ | All docs in `docs/` |
| 2 Foundation | ✅ | Monorepo, shared package, NestJS app, migration, auth, RBAC, 12-user seeder, prod bootstrap |
| 3 Catalog & inventory | ✅ | Categories, products, bundles/combos, CSV import/export, ledger, receipts, adjustments + approval, stock counts, suppliers, purchases |
| 4 Billing engine | ✅ | Preview, idempotent create, discounts + manager override, payments, returns, refunds, void, PDFs (A4/80 mm), repeat bill |
| 5 CRM | ✅ | 25 routes, all on live API; Playwright smoke test (3/3) with screenshots reviewed |
| 6 Mobile | 🟡 | All 14 screens implemented; typecheck, 9 unit tests and iOS Hermes bundle pass. **Not yet run on a simulator/device** (needs Xcode or EAS) |
| 7 Advanced | ✅ | Combos, barcode scanning, supplier payments, cash closing, returns/refunds, seasonal report, offline-safe cart (online-only checkout by design, D12) |
| 8 Quality & prod | 🟡 | Tests, load test, audit, Dockerfiles, Compose, Caddy, CI, backups (verified), docs done. Docker images & CI workflow **not executed** here (no Docker; not pushed) |

## Checkpoints (git)
- `927f26a` — docs, shared engine, API + integration tests
- `8457708` — CRM + api-client + Playwright
- `653afba` — iOS POS app
- (next commit) — production readiness: load test, deployment artifacts, audit fixes, docs

## Decisions log (beyond plan.md D1–D16)
- D17 Enums are `varchar` + `CHECK` constraints.
- D18 `stock_movements.seq bigserial` gives strict ledger order (rows in one transaction share `now()`).
- D19 Session validity keyed on the refresh-token family (`sid`), so access tokens survive rotation but die immediately on logout/revoke/deactivate.
- D20 Refresh-token errors are returned from the transaction and thrown after commit so reuse-detection revocations persist (**bug found by tests and fixed**).
- D21 Invoice number allocated before stock movements; ledger stays append-only; rollback keeps numbering gap-free.
- D22 Product `kind` immutable after creation.
- D23 Invoice PDFs use bundled Noto Sans (OFL) for ₹.
- D24 Login limiter 5/min per IP+identifier, 30/min per IP; account lock after 10 failures. Global API limit 3000/min/IP (one shop NAT IP).
- D25 Test DB reset via `DROP OWNED BY CURRENT_USER`; refuses URLs without "test".
- D26 Top-level `discountReason` on invoices (needed when only item discounts exceed the cap).
- D27 Mobile: manager approval credentials are never persisted with the cart; refresh token in Keychain only when "Keep me signed in".
- D28 `tsconfig.build.json` has `incremental: false` (stale `.tsbuildinfo` + `deleteOutDir` produced an empty `dist`).
- D29 Security overrides: multer ≥ 2.5.0, postcss ≥ 8.5.23; csv-parse 7.0.3.
- D30 (2026-11-22) Mobile upgraded Expo SDK 54 → **58** (expo 58.0.26, RN 0.88.1, React 19.3.0) so the current App Store Expo Go can open it. CRM aligned to React 19.3.0 to keep a single React copy in the hoisted node_modules. Code changes were type-level only (RN 0.88 stricter types: `onRefresh` returns void, `TextInputInstance` ref type, no `null` list-empty components, tab icon colour narrowing). Verified: `expo install --check` (all runtime modules match), mobile typecheck, 9 unit tests, iOS bundle export, dev-server bundle, CRM typecheck + build. Dev tooling left on jest 29 / TypeScript 5.9 (Expo suggests jest 30 / TS 6; dev-only). RN 0.88 declares Node ^24.3 — this Mac runs 24.2 and everything worked, but upgrade Node when convenient.

- D31 (2026-11-25) Free hosting target: **Oracle Cloud Always Free** (one ARM VM, docker compose) + DuckDNS. CRM and API now served from **one domain** by Caddy (`/api/*`, `/uploads/*` → API; rest → CRM; CRM built with `NEXT_PUBLIC_API_URL=/api/v1`). Verified locally through a Caddy-equivalent proxy: login, httpOnly refresh cookie (path `/api/v1/auth`) and session survival on reload (Playwright). Scripts: `deploy/push.sh` (Mac) → `deploy/oracle/server-install.sh` (server). Guide: docs/deployment-oracle.md. Docker images still unbuilt until the first server deploy.

- D32 (2026-11-25) **Hosting plan changed to Neon (DB) + Render (API) + Vercel (CRM)** at the user's request (Oracle guide kept as an alternative). Changes: API no longer forces `ssl:false` (Neon's URL carries `sslmode`) and no longer sends the `-c timezone=UTC` startup option (rejected by poolers; all business-date SQL converts explicitly; 49/49 e2e pass with the DB session in Asia/Kolkata); API honours `PORT`; CRM optionally proxies `/api/*` + `/uploads/*` via `API_PROXY_TARGET` so the refresh cookie stays first-party on vercel.app; `render.yaml`, `apps/crm/vercel.json`. Rehearsed from a clean copy: Render build/start/migrate/bootstrap, Vercel build + proxy + Chromium sign-in → password change → dashboard → reload. **Neon connection not yet verified: the pasted password was rejected (28P01)**; `.env` holds the Neon URLs (`DATABASE_URL` pooled, `MIGRATE_DATABASE_URL` direct) with the local URL kept as a comment.

## Known issues / open items
1. **iOS app not yet run on a device or simulator** (no Xcode here). Before the season: build via EAS or Xcode and run the device checklist in testing-plan.md (scanner, AirPrint, share to WhatsApp, offline banner, kill/restore cart).
2. Docker images, `docker compose`, and the GitHub Actions workflow were written but **not executed** on this machine.
3. Remaining audit findings are assessed as unreachable (security.md); re-run `pnpm audit --prod` before go-live.
4. Dashboard performance verified at ~5k invoices (p99 16 ms); not yet measured at the 50k target in spec §22.
5. Report PDF export is out of scope for v1 (CSV/XLSX provided; invoices and statements are PDF).
6. Stock transfer between locations is reserved in the schema but not exposed (single shop).

## Test results (actual runs, 2026-11-22)
| Command | Result |
|---|---|
| `pnpm --filter @kite/shared test` | **40/40** passed |
| `pnpm --filter api test` (unit) | **6/6** passed |
| `pnpm --filter mobile test` | **9/9** passed |
| `pnpm -r typecheck` | all 5 packages clean (strict) |
| `pnpm --filter api test:e2e` (real PostgreSQL) | **49/49** passed — auth 11, RBAC 5, catalog/inventory 9, invoices 18, concurrency 5, full 14-step flow 1 |
| `pnpm --filter crm build` | success (25 routes) |
| `pnpm --filter crm test:e2e` (Playwright, Chromium) | **3/3** passed |
| `expo export --platform ios` | success — SDK 54: 3.57 MB; after SDK 58 upgrade: 3.5 MB Hermes bundle |
| Load test (`pnpm --filter api load`, 12 users, 15 s/scenario, prod build) | checkout **313 bills/s, p99 184 ms, 0 errors**; search p99 11 ms; POS catalog p99 8 ms; dashboard p99 16 ms. After 4,738 bills: ledger sums = balances, numbers unique and gap-free, no negative stock |
| Backup → restore (`scripts/backup.sh`, `scripts/restore.sh`) | 4,738 invoices and 14,211 ledger rows restored identically |
| `pnpm audit --prod` | 28 → 10 findings after fixes; remainder assessed in security.md |
