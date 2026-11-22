# Security

Target: OWASP ASVS Level 1 with Level 2 controls for authentication, session management and financial integrity.

## Controls

| Area | Control | Where |
|---|---|---|
| Passwords | Argon2id (m=19456 KiB, t=2, p=1); policy ≥10 chars, letter+digit, ≠ username, ≠ current | `auth/password.service.ts` |
| Brute force | Throttler 5/min per IP+identifier on login, 20/min/IP; account lock 15 min after 10 failures; generic error messages | `auth.controller.ts`, `auth.service.ts` |
| Tokens | Access JWT HS256 15 min with `sid`; secret ≥ 32 chars validated at boot. Refresh: 256-bit random, SHA-256 hashed at rest, rotation, reuse detection revokes family | `auth/` |
| Session validity | Each request checks user active + session not revoked (10 s cache) | `jwt-auth.guard.ts` |
| Token storage | Mobile: iOS Keychain via `expo-secure-store`. CRM: access token in memory, refresh token httpOnly SameSite=Strict cookie (path-scoped) | clients |
| Forced rotation | `mustChangePassword` gate on seeded/reset accounts | guard |
| RBAC | Permission decorator + guard on every controller route; default-deny (route without `@Permissions` or `@Public` fails a startup check test) | `common/guards` |
| Ownership | Salesperson invoice access scoped in queries (`salesperson_id = :me`); 404 for others | `invoices.service.ts` |
| Field-level | Cost/purchase fields stripped without `catalog.viewCost` | `catalog` serializers |
| Financial integrity | Server recomputes prices, discounts, tax, totals, statuses; client values ignored; DTO whitelist rejects unknown fields (`forbidNonWhitelisted`) | `invoices`, `ValidationPipe` |
| Idempotency | Unique idempotency keys for invoices/payments + request hash | `invoices` |
| Input validation | class-validator DTOs; numeric bounds; string lengths; UUID checks | DTOs |
| SQL injection | TypeORM parameters only; raw SQL uses `$n` placeholders; no string concatenation of user input (sort fields whitelisted) | everywhere |
| Uploads | Multer memory storage, 2 MB limit, MIME + magic-byte check (JPEG/PNG/WebP), random UUID filename, served with `X-Content-Type-Options: nosniff`; no SVG | `uploads` |
| Headers | helmet (HSTS in prod, frameguard, noSniff), CORS allow-list from `CORS_ORIGINS`, credentials only for CRM origin | `main.ts` |
| Logging | pino with redaction of `authorization`, `cookie`, `password*`, `refreshToken`, `accessToken`; no bodies logged for auth routes | `app.module.ts` |
| Audit | Append-only `audit_logs`; auth events, privileged actions, financial actions | `audit` |
| Errors | No stack traces/SQL in responses in production | exception filter |
| Secrets | Only via env; `.env` git-ignored; config validated at boot (fails fast) | `config/` |
| Dev credentials | Dev seeder refuses `NODE_ENV=production`; prod bootstrap requires env-provided password that must not match dev seeds | `seeds/` |
| Database | Least-privilege `kite_app` role (no DDL; no UPDATE/DELETE on ledger & audit tables) | `scripts/db-roles.sql` |
| Transport | HTTPS via Caddy (auto TLS); API not exposed directly | `Caddyfile` |
| Customer data | Phone/name only; access restricted by role; statements require `reports.financial` | — |
| Invoice access | PDFs require auth and same ownership rules; no public links | `documents` |

## Security review checklist (Phase 8) — status 2026-11-22
- [x] Every controller route has `@Permissions(...)` or `@Public()` — automated test `rbac.e2e-spec.ts` scans all routes
- [x] Salesperson cannot change price (403), adjust/receive stock (403), read others' invoices or PDFs (404), see cost fields (absent), void/return (403), exceed discount cap without approval (403) — integration tests
- [x] Manipulated invoice body with `unitPricePaise` / `totalPaise` / `paymentStatus` → 400 — integration test
- [x] Refresh-token reuse revokes the whole family — integration test (this found and fixed a bug where the revocation was rolled back)
- [x] Deactivated user's existing access token rejected on the next request — integration test
- [x] Login rate limiting — unit test of the limiter; account lockout after 10 failures — integration test
- [x] Upload rejects a non-image disguised as PNG; accepts a real PNG — integration test
- [x] Logs: pino redaction of authorization/cookie/password/token fields; audit log values sanitized (unit test)
- [x] Manager credentials for discount approval are never persisted on the phone (excluded from the stored cart)
- [x] `pnpm audit --prod` (2026-11-22): 28 findings → 10 after upgrading **multer 2.5.0** (uploads) and **csv-parse 7.0.3** (CSV import) and overriding **postcss ≥ 8.5.23**. Remaining, assessed as not reachable: `zod` (API uses zod only to parse its own environment config, never request bodies; class-validator handles input), `uuid` via exceljs (v3/v5/v6 buffer APIs never called), `glob`/`minimatch` via TypeORM (migrations are passed as classes, no user-controlled globs), `image-size` and `decode-uri-component` via Expo tooling/router (build-time / local deep-link parsing). Re-run before go-live.
- [ ] External penetration test — recommended before exposing the API publicly

## Reporting
Report vulnerabilities privately to the shop's technical owner; do not open public issues.
