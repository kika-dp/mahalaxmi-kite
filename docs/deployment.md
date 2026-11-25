# Deployment & Operations

## 1. Requirements

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22 LTS or 24 | developed on 24.2 |
| pnpm | 10.33 | `corepack enable && corepack prepare pnpm@10.33.2 --activate` |
| PostgreSQL | 14–16 | local (Homebrew/apt) or Docker |
| Docker + Compose | optional for dev, recommended for production | |
| Xcode 16+ on macOS | only to build/run the iOS app locally | or use EAS Build in the cloud (no Xcode needed) |

## 2. Local development

```bash
git clone <repo> kite-shop-platform && cd kite-shop-platform
corepack enable
pnpm install
cp .env.example .env                 # then set JWT_ACCESS_SECRET:  openssl rand -base64 48
```

### Database (choose one)
**Docker:** `docker compose up -d db` (creates `kite` and `kite_test`, user/password `kite`/`kite`).

**Local PostgreSQL:**
```bash
psql -d postgres -c "CREATE ROLE kite LOGIN PASSWORD 'kite' CREATEDB;"
createdb -O kite kite
createdb -O kite kite_test
```

### Build shared packages, migrate, seed
```bash
pnpm build:packages
pnpm --filter api migration:run
pnpm --filter api seed:dev                         # settings, 9 categories, season, the 12 dev users
pnpm --filter api seed:dev -- --with-demo-catalog  # OPTIONAL demo products with opening stock
pnpm --filter api seed:dev -- --reset-passwords    # restore documented dev passwords
```
The seeder is idempotent: running it again creates nothing new (verified by test). Seeded users must change their password at first sign-in (set `SEED_MUST_CHANGE_PASSWORD=false` only for automated tests).

### Run
```bash
pnpm dev:api        # http://localhost:4000/api/v1   ·  Swagger: http://localhost:4000/api/docs
pnpm dev:crm        # http://localhost:3000
pnpm dev:mobile     # Expo dev server (see §4)
```

### Development accounts (development only — the seeder refuses NODE_ENV=production)
| Username | Role | Password |
|---|---|---|
| superadmin | Super Admin | KiteDev@2026#01 |
| admin01 / admin02 | Admin | KiteDev@2026#02 / #03 |
| seller01 … seller09 | Salesperson | KiteDev@2026#04 … #12 |

**Testing every account:** sign in to the CRM as `superadmin`, `admin01`, `admin02` (each is asked to set a new password first). Sign in to the POS app as `seller01`…`seller09`. A salesperson signing in to the CRM is shown "use the Kite POS app". The automated check `pnpm --filter api test:e2e -t "all 12 seeded users"` logs every account in and asserts its role.

## 3. Tests
```bash
pnpm --filter @kite/shared test     # billing engine, money, permissions (40 tests)
pnpm --filter api test              # API unit tests
pnpm --filter api test:e2e          # integration tests on kite_test (DROPS & recreates its objects)
pnpm --filter mobile test           # cart logic
# CRM browser smoke test: API on :4000 with SEED_MUST_CHANGE_PASSWORD=false data, CRM on :3000
pnpm --filter crm exec playwright install chromium
pnpm --filter crm test:e2e
# Load test (scratch DB with demo catalog; creates thousands of real bills):
THROTTLE_DISABLED=true pnpm dev:api   # in another terminal
pnpm --filter api load
```

## 4. iOS app

The app uses native modules (camera, secure store, print, file system, WebView), so it runs as an **Expo development build**, not in Expo Go.

### API address on the phone
`localhost` on an iPhone is the phone itself. Use your Mac's LAN IP:
```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:4000/api/v1 pnpm dev:mobile
```
In development builds the server URL can also be changed in **Profile → Server**. Production builds use the HTTPS URL baked in by `eas.json`.

### Option A — local build with Xcode (macOS)
```bash
cd apps/mobile
npx expo prebuild --platform ios        # generates ios/ (git-ignored)
pnpm ios                                # builds & launches the iOS Simulator
pnpm ios:device                         # physical iPhone over USB (select your Apple team in Xcode once)
```
For a physical device you need a free or paid Apple Developer account selected under *Signing & Capabilities* for the `KitePOS` target; enable Developer Mode on the iPhone (Settings → Privacy & Security).

### Option B — EAS Build (no local Xcode required)
```bash
npm i -g eas-cli && eas login
cd apps/mobile
eas build:configure                     # links the project
eas build --profile development --platform ios     # dev client for registered devices (eas device:create)
eas build --profile preview --platform ios         # internal distribution (ad-hoc) to shop iPhones
eas build --profile production --platform ios && eas submit --platform ios   # TestFlight / App Store
```
Ad-hoc and TestFlight distribution require a paid Apple Developer Program membership. For a single shop, **TestFlight** (up to 100 internal testers, no App Review for internal builds) or **ad-hoc** builds are the practical choices. Edit `EXPO_PUBLIC_API_URL` in `eas.json` before building.

### What was verified on the development machine
This repository was built on a Mac **without Xcode**, so the app has not been launched in a simulator or on a device there. Verified instead: TypeScript strict typecheck, unit tests, and a full production JS bundle for iOS (`pnpm --filter mobile export:ios` → Hermes bytecode). Run the device checklist in testing-plan.md before the season.

## 5. Production (single server, Docker Compose)

> **Free options:** **Neon + Render + Vercel** → [deployment-free.md](deployment-free.md) (current plan). Alternative: Oracle Cloud Always Free + DuckDNS in [deployment-oracle.md](deployment-oracle.md) (one command from this Mac: `deploy/push.sh`). The stack serves the CRM and API from **one domain** (`/api/*` → API), so the generic steps below should use `SITE_DOMAIN` instead of separate CRM/API domains.

Recommended: a small VM (2 vCPU / 4 GB, Ubuntu 24.04) in an Indian region, plus a 4G hotspot at the shop as a backup link.

```bash
# DNS: shop.your-domain.in → server IP
cp .env.example .env
# Set at least:
#   NODE_ENV=production
#   JWT_ACCESS_SECRET=$(openssl rand -base64 48)
#   POSTGRES_PASSWORD=<strong password>
#   CORS_ORIGINS=https://shop.your-domain.in
#   COOKIE_SECURE=true
#   PUBLIC_API_URL=https://shop.your-domain.in
#   NEXT_PUBLIC_API_URL=/api/v1
#   SITE_DOMAIN=shop.your-domain.in       (CRM at /, API at /api — one HTTPS domain)
#   SWAGGER_ENABLED=false
docker compose --profile app --profile prod up -d --build      # db, api (auto-migrates), crm, caddy (HTTPS), backups
# First Super Admin (one time). Never use the dev seeder in production.
docker compose exec -e BOOTSTRAP_ADMIN_USERNAME=owner -e BOOTSTRAP_ADMIN_EMAIL=owner@your-shop.in \
  -e BOOTSTRAP_ADMIN_PASSWORD='<strong temporary password>' api node dist/database/seeds/prod-bootstrap.js
```
Then sign in to the CRM as `owner`, set a new password, fill **Shop settings**, create staff accounts under **Users & roles**, add products, and receive opening stock.

Without Docker: build with `pnpm build`, run `node apps/api/dist/main.js` and `node apps/crm/.next/standalone/apps/crm/server.js` under systemd, put Caddy or nginx in front for TLS, and run migrations with `pnpm --filter api migration:run:prod`.

### Least-privilege database roles
`apps/api/scripts/db-roles.sql` creates `kite_migrator` (owns schema, runs migrations) and `kite_app` (no DDL; **cannot UPDATE/DELETE** the stock ledger or audit log). Use `kite_app` in `DATABASE_URL` and `MIGRATE_DATABASE_URL` (kite_migrator) for migrations.

### HTTPS
Caddy obtains and renews a Let's Encrypt certificate automatically for `SITE_DOMAIN`, routes `/api/*` and `/uploads/*` to the API and everything else to the CRM, and adds HSTS and compression. Same-origin serving keeps the CRM's httpOnly refresh cookie first-party. The API and CRM containers only listen on 127.0.0.1.

### LAN mode (internet outage plan)
The whole stack can run on a shop laptop on the shop Wi-Fi (`docker compose --profile app up -d`). Point the phones at `http://<laptop-ip>:4000/api/v1` (development build setting, or a separate EAS build profile). Use only if the cloud server is unreachable for a long time, and never run two servers against different databases at once.

## 6. Backups & restore
- `backup` service: `pg_dump` (custom format) at start-up and nightly at 02:00 UTC (07:30 IST) into `./backups`, keeping 30 days. **Copy `./backups` off the server** (e.g. rclone to cloud storage) — a backup on the same disk is not a backup.
- Before every deploy: `docker compose exec backup sh /backup.sh`.
- Manual: `PGHOST=… PGUSER=… PGPASSWORD=… PGDATABASE=kite BACKUP_DIR=./backups ./scripts/backup.sh`
- Restore (into a new database first, verify, then switch): `./scripts/restore.sh backups/kite-<stamp>.dump kite_restore`
- Verified on the dev machine: a 1.7 MB dump of 4,738 bills restored with identical invoice and ledger row counts.
- Product images live in the `uploads` volume — include it in off-site copies.

## 7. Logging & monitoring
- API logs: structured JSON (pino) to stdout with request IDs (`X-Request-Id`), user id, latency; secrets redacted. `docker compose logs -f api`.
- Health: `GET /api/v1/health/live` (process) and `/health/ready` (database). Point an uptime monitor (e.g. UptimeRobot) at `/health/ready`.
- Business audit: CRM → Audit log.

## 8. Upgrades
```bash
git pull
docker compose exec backup sh /backup.sh
docker compose --profile app --profile prod up -d --build    # api runs pending migrations on start
```
Rollback: redeploy the previous image tag; if a migration must be undone, restore the pre-deploy backup (migrations have `down` steps but restoring is safer for data).
