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

## Security review checklist (Phase 8)
- [ ] Every controller route has `@Permissions(...)` or `@Public()` (automated test)
- [ ] Salesperson cannot: change price (PATCH /products → 403), adjust stock (403), read others' invoices (404), view cost (field absent), void/return (403), exceed discount cap without approval (403)
- [ ] Manipulated invoice body with `unitPricePaise`/`totalPaise` → 400 (forbidden fields)
- [ ] Refresh token reuse revokes family
- [ ] Deactivated user's existing access token rejected on next request
- [ ] Rate limiting on login verified
- [ ] Upload rejects non-image and oversize files
- [ ] Logs contain no passwords/tokens
- [ ] `pnpm audit --prod` reviewed

## Reporting
Report vulnerabilities privately to the shop's technical owner; do not open public issues.
