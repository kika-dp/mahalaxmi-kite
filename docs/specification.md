# Uttarayan Kite Shop Platform — Functional & Technical Specification

Status: **v1.0 (source of truth)** · Last updated: 2026-11-22
Companion documents: [plan.md](plan.md) · [architecture.md](architecture.md) · [database-schema.md](database-schema.md) · [api-specification.md](api-specification.md) · [ui-ux-specification.md](ui-ux-specification.md) · [security.md](security.md) · [testing-plan.md](testing-plan.md)

---

## 1. Product summary

A billing, inventory and sales platform for a retail kite shop operating at peak load during Uttarayan (Makar Sankranti, ~10–15 January). 10–12 salespeople bill simultaneously from iPhones while the owner manages stock, prices, collections and reports from a web CRM. Correctness of stock and money is the primary requirement; speed of billing is the second.

| Surface | Users | Purpose |
|---|---|---|
| Web CRM (`apps/crm`) | Super Admin, Admin, Inventory Manager | Catalog, stock, bills, customers, suppliers, reports, users, settings |
| iOS POS (`apps/mobile`) | Salesperson (Admins may also use it) | Fast billing, payments, invoice share/print, own history |
| API (`apps/api`) | Both clients | All business rules; the only component that writes to the database |

## 2. Glossary

| Term | Meaning |
|---|---|
| Paise | Integer minor unit of INR. ₹1 = 100 paise. **All money is stored and computed in integer paise.** |
| bps | Basis points. 1% = 100 bps. All percentages are stored as integer bps. |
| Standard product | A product that holds its own stock (e.g. "Regular Kite", "Firki 6-reel"). |
| Bundle product | A sellable product with no stock of its own; selling it deducts its components. Covers packets (1 component × N, e.g. "Kite Packet of 10") and combos (several components, e.g. "Uttarayan Starter Kit"). |
| Base unit | The unit in which a standard product's stock is counted (its `unitType`). |
| Business date | The calendar date in `Asia/Kolkata` (IST) on which an event happened. |
| Finalized invoice | An invoice that has been committed: it has a number, stock is deducted, its financial fields are immutable. There are no draft invoices on the server; carts live on the device. |
| Net paid | Sum of incoming payments minus outgoing refunds on an invoice. |
| Amount owed | Invoice total minus value of returned items. |

## 3. Roles and permissions

Roles are a fixed enum. Permissions are a fixed map in `packages/shared/src/permissions.ts`; the API enforces them with guards on every route. Hiding menus in the UI is cosmetic only.

| Permission | SUPER_ADMIN | ADMIN | INVENTORY_MANAGER | SALESPERSON |
|---|:-:|:-:|:-:|:-:|
| `users.manage` (create/edit/disable/reset/revoke salespeople & inventory managers) | ✓ | ✓ | | |
| `users.manageAdmins` (create/disable ADMIN and SUPER_ADMIN) | ✓ | | | |
| `settings.manage` (shop settings, seasons) | ✓ | ✓ | | |
| `catalog.read` (products, categories, stock qty, selling price) | ✓ | ✓ | ✓ | ✓ |
| `catalog.write` (create/edit products, prices, categories, favorites, bundles, import) | ✓ | ✓ | | |
| `catalog.viewCost` (purchase price, margins, valuation) | ✓ | ✓ | ✓ | |
| `inventory.receive` (opening stock, receipts, purchases) | ✓ | ✓ | ✓ | |
| `inventory.adjust` (adjustments, damaged, lost, stock counts) | ✓ | ✓ | ✓ | |
| `inventory.approve` (approve/reject pending adjustments; adjustments apply immediately) | ✓ | ✓ | | |
| `inventory.viewLedger` (stock movements, low stock, count reports) | ✓ | ✓ | ✓ | |
| `suppliers.manage` (suppliers, supplier payments) | ✓ | ✓ | ✓ (no payments) | |
| `invoices.create` | ✓ | ✓ | | ✓ |
| `invoices.readAll` | ✓ | ✓ | | |
| `invoices.readOwn` (only invoices where `salespersonId = me`) | ✓ | ✓ | | ✓ |
| `payments.record` (own invoices for salesperson; any for admin) | ✓ | ✓ | | ✓ |
| `invoices.return` / `invoices.refund` / `invoices.void` | ✓ | ✓ | | |
| `discounts.unlimited` (no discount cap) and `discounts.approve` (manager override) | ✓ | ✓ | | |
| `customers.read` (search/list) / `customers.write` | ✓ | ✓ | | ✓ (search by phone, create) |
| `dashboard.view`, `reports.financial` (sales, payments, profit, discounts, outstanding) | ✓ | ✓ | | |
| `reports.inventory` (stock movement, low stock, purchases w/o profit) | ✓ | ✓ | ✓ | |
| `cash.manage` (cash sessions, payouts, closing) | ✓ | ✓ | | |
| `audit.view` | ✓ | ✓ | | |

Additional server-side rules:

- A SALESPERSON can read/record payments only on invoices they created. Requests for other invoices return **404** (not 403) to avoid revealing existence.
- Purchase price/cost fields are stripped from responses for users without `catalog.viewCost`.
- An ADMIN cannot modify, disable, or reset a SUPER_ADMIN or another ADMIN; only SUPER_ADMIN can (`users.manageAdmins`).
- No one can deactivate themselves or remove the last active SUPER_ADMIN.
- The CRM refuses SALESPERSON logins with a friendly message ("Use the Kite POS app"); the API still authenticates them.

## 4. Authentication & sessions

- Login with **username or email** + password. Usernames/emails are case-insensitive (stored lower-case).
- Passwords hashed with **Argon2id** (memoryCost 19 MiB, timeCost 2, parallelism 1 — OWASP baseline).
- **Access token**: JWT (HS256), 15 min TTL, claims `sub`, `role`, `sid` (session id), `mcp` (must-change-password flag).
- **Refresh token**: 256-bit random opaque string; only its SHA-256 hash is stored in `user_sessions`. TTL 7 days (mobile "remember me") or 12 hours (no remember / CRM default). **Rotated on every refresh**; the old row is marked replaced. Presenting an already-rotated token (reuse) revokes the entire session family and is audit-logged as `AUTH_REFRESH_REUSE`.
- Every authenticated request re-checks that the user is active and the session (`sid`) is not revoked — deactivating a user or revoking sessions takes effect within one request, not after token expiry. (Cheap: one indexed lookup, cached 10 s in-process.)
- **Must change password**: seeded users and admin-reset users have `mustChangePassword = true`. While set, the API returns `403 PASSWORD_CHANGE_REQUIRED` for everything except `GET /auth/me`, `POST /auth/change-password`, `POST /auth/logout`, `POST /auth/refresh`.
- Password policy: ≥ 10 characters, at least one letter and one digit, must differ from current password, must not equal the username.
- Login rate limit: 5 attempts per minute per IP+identifier, 20/min per IP; responses never distinguish "unknown user" from "wrong password". After 10 consecutive failures the account is locked for 15 minutes.
- Admin operations: activate/deactivate user, reset password (sets temporary password + `mustChangePassword`, revokes all sessions), revoke all sessions.

## 5. Seed data

### 5.1 Development seed (`pnpm --filter api seed:dev`)
Idempotent (upsert by username; never duplicates, never overwrites a password that has been changed unless `--reset-passwords`). Refuses to run when `NODE_ENV=production`.

| Username | Email | Role | Password |
|---|---|---|---|
| superadmin | superadmin@kite.local | SUPER_ADMIN | KiteDev@2026#01 |
| admin01 | admin01@kite.local | ADMIN | KiteDev@2026#02 |
| admin02 | admin02@kite.local | ADMIN | KiteDev@2026#03 |
| seller01 … seller09 | seller0N@kite.local | SALESPERSON | KiteDev@2026#04 … #12 |

Exactly 12 users. All created with `mustChangePassword = true` (configurable for automated tests via `SEED_MUST_CHANGE_PASSWORD=false`).

Also seeded: shop settings, the 9 default categories, the active season "Uttarayan 2026–27", and (only with `--with-demo-catalog`) a demo catalog with opening stock. **The demo catalog is never seeded automatically**, so production dashboards never contain dummy data.

### 5.2 Production bootstrap (`pnpm --filter api bootstrap:prod`)
Creates settings, categories, season, and **one** SUPER_ADMIN from `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` env vars (password must satisfy policy and must not equal any dev seed password). Runs only if no SUPER_ADMIN exists. The user must change the password on first login.

## 6. Catalog

### 6.1 Categories
Default: Regular Kites, Designer Kites, Premium Kites, Kids Kites, Manjha, Firki, Kite Threads, Accessories, Other Products. Fields: name (unique, case-insensitive), sortOrder, isActive. Categories with products cannot be deleted — only deactivated.

### 6.2 Product fields
| Field | Rules |
|---|---|
| id | UUID |
| name | 2–120 chars, required |
| sku | 1–40 chars, `[A-Z0-9-_]` upper-cased, unique. Auto-generated `KT-000123` if blank. |
| barcode | optional, unique when set (EAN/UPC/QR text, ≤ 64 chars) |
| categoryId | required, active category |
| kind | `STANDARD` or `BUNDLE` (immutable after first sale) |
| unitType | `PIECE`, `PACKET`, `BUNDLE`, `BOX`, `DOZEN`, `ROLL` |
| description | ≤ 1000 chars |
| imageUrl | via upload endpoint; JPEG/PNG/WebP ≤ 2 MB |
| purchasePricePaise | integer ≥ 0 (STANDARD). For BUNDLE it is derived (Σ component cost × qty) and read-only. |
| sellingPricePaise | integer ≥ 0, required |
| mrpPaise | optional, ≥ sellingPrice when set (warning only if lower) |
| minStockAlert | integer ≥ 0, default from settings (10) — STANDARD only |
| supplierId | optional |
| isActive | inactive products are hidden from POS and cannot be billed |
| isFavorite / favoriteOrder | Quick-sell tiles on the POS |
| bundleItems | BUNDLE only: 1–20 `{componentProductId, quantity ≥ 1}`; components must be active STANDARD products; no duplicates |

### 6.3 Units, packets and combos (no duplicate stock)
Stock exists **only** on STANDARD products, in their base unit. Packets and combos are BUNDLE products whose sale deducts component stock:

- "Regular Kite" (STANDARD, PIECE, ₹10) — holds stock, e.g. 1,500 pieces.
- "Regular Kite Packet (10)" (BUNDLE, PACKET, ₹90) → components: Regular Kite × 10.
- "Uttarayan Starter Kit" (BUNDLE, BUNDLE, ₹399) → Regular Kite × 10, Firki × 1, Manjha 1000m × 1.

A bundle's available quantity = `min over components floor(componentStock / componentQty)`. Bundle definitions are snapshotted onto each invoice line, so later edits to the bundle never change past invoices or how their returns restore stock.

### 6.4 Catalog operations
Create, edit, activate/deactivate, search (name/SKU/barcode, trigram index), filter by category/kind/active/favorite/stock state, sort by name/price/quantity/updated, image upload, CSV import (create or update by SKU; validates all rows first and applies nothing if any row fails, returns per-row errors), CSV export, bulk price update (list of `{productId, sellingPricePaise, purchasePricePaise?}`), bulk stock receipt (via inventory receipts, ledgered), product-wise sales history.

Products are never hard-deleted once referenced by an invoice, purchase or stock movement; `DELETE /products/:id` deactivates (archives) them. A product with no history may be hard-deleted.

Price changes are audit-logged with before/after values. Historical invoices keep their snapshot (name, SKU, unit, price, cost).

## 7. Inventory

### 7.1 Stock balance & ledger
`stock_balances.quantity` (integer, `CHECK quantity >= 0`) is the current stock of a STANDARD product. It is modified **only** by the inventory service inside a database transaction that also inserts a `stock_movements` row with `previousQuantity`, `quantityChange`, `newQuantity`, type, reference, reason, user, timestamp. There is no API that sets a quantity directly.

Movement types: `OPENING`, `PURCHASE_RECEIPT`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `DAMAGED`, `LOST`, `COUNT_CORRECTION`, `SALE`, `SALE_RETURN`, `VOID_RESTORE`, `TRANSFER_IN`/`TRANSFER_OUT` (reserved for multi-location; not exposed in v1).

### 7.2 Concurrency rule
All stock-changing transactions lock the affected `stock_balances` rows with `SELECT … FOR UPDATE` **in ascending product-id order** (prevents deadlocks), validate, then update. The `CHECK (quantity >= 0)` constraint is a second line of defence. Example: stock 5; A sells 4 and B sells 3 concurrently → exactly one succeeds; the other gets `409 INSUFFICIENT_STOCK` with the current available quantity, and nothing is written for it.

### 7.3 Operations
| Operation | Who | Effect |
|---|---|---|
| Opening stock | receive | `OPENING` +qty; allowed once per product (subsequent use → receipt) |
| Stock receipt (no supplier) | receive | `PURCHASE_RECEIPT` +qty, optional unit cost |
| Purchase (supplier) | receive | Creates purchase + items; `PURCHASE_RECEIPT` per item; optionally updates product purchase price to latest cost (default on) |
| Adjustment | adjust | types `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `DAMAGED`, `LOST`; reason required (3–500 chars). Applied immediately for ADMIN/SUPER_ADMIN. For INVENTORY_MANAGER, decreasing adjustments are created `PENDING` and apply only when an admin approves them; increases apply immediately. |
| Physical stock count | adjust | Open a count → record counted qty per product (system qty snapshotted at the moment each line is counted) → complete. On completion, for each line `variance = counted − systemAtCount`; a `COUNT_CORRECTION` movement of `variance` is applied to the current balance (so sales made after a line was counted are not double-counted). Variance report available before completion. |
| Sale | invoices.create | `SALE` −qty per component, same transaction as invoice |
| Return | invoices.return | `SALE_RETURN` +qty if the line is marked restockable; otherwise a `DAMAGED` record with 0 balance effect is not created — the item is simply not restocked and the return line records `restocked=false` |
| Void | invoices.void | `VOID_RESTORE` +qty for each not-yet-returned unit |

If a decreasing adjustment would make stock negative it is rejected (`409 INSUFFICIENT_STOCK`); a pending adjustment is re-validated at approval time.

### 7.4 Alerts and views
- Low stock: active STANDARD product with `quantity ≤ minStockAlert`. Out of stock: `quantity = 0`.
- Inventory value: Σ quantity × purchasePrice (cost) and Σ quantity × sellingPrice (retail).
- Daily opening/closing stock per product for a date range (derived from the ledger: closing = last `newQuantity` on or before the day end).
- Inventory aging: days since last `PURCHASE_RECEIPT`/`OPENING` and days since last `SALE`.

## 8. Billing engine

### 8.1 Input (from client)
```
{
  idempotencyKey: uuid,                 // generated once per cart on the device
  items: [{ productId, quantity (1–9999), discount?: {type: FIXED|PERCENT, value}, note? }],
  billDiscount?: { type: FIXED|PERCENT, value, reason? },
  customer?: { name?, phone? } | { customerId },
  payments?: [{ method: CASH|UPI|CARD|OTHER, amountPaise, reference?, note? }],
  discountApproval?: { username, password },   // manager override
  notes?
}
```
The client **never** sends prices, totals, statuses or costs. Duplicate product lines are allowed (e.g. separate notes) but merged in validation for stock checks.

### 8.2 Calculation (integer paise; `packages/shared/src/billing.ts`, used by API authoritatively and by mobile for preview)
Rounding: every percentage computation is `round_half_up(base × bps / 10000)` to whole paise. No rupee round-off.

```
for each line i:
  gross_i        = qty_i × unitPrice_i
  lineDisc_i     = FIXED  → value (paise per line, not per unit)
                   PERCENT→ round(gross_i × bps / 10000)
  require 0 ≤ lineDisc_i ≤ gross_i
  net_i          = gross_i − lineDisc_i
grossSubtotal    = Σ gross_i
lineDiscountTotal= Σ lineDisc_i
eligible         = grossSubtotal − lineDiscountTotal
billDisc         = FIXED → value ; PERCENT → round(eligible × bps / 10000)
require 0 ≤ billDisc ≤ eligible
billDisc allocated to lines pro-rata to net_i (largest-remainder method so Σ alloc = billDisc exactly)
taxable          = eligible − billDisc
tax              = taxEnabled ? round(taxable × taxRateBps / 10000) : 0   (exclusive tax)
tax allocated to lines pro-rata to (net_i − billAlloc_i) (largest remainder)
lineTotal_i      = net_i − billAlloc_i + taxAlloc_i
total            = taxable + tax = Σ lineTotal_i
discountTotal    = lineDiscountTotal + billDisc
```
Percent values: 0 < bps ≤ 10000 (client sends percent with up to 2 decimals; the API converts to bps). Fixed values: integer paise ≥ 0.

### 8.3 Discount authorization
- `discountPercentOfGross = discountTotal / grossSubtotal`.
- Users with `discounts.unlimited` may discount up to 100%.
- Others are capped at `user.maxDiscountBps ?? settings.salespersonMaxDiscountBps` (default 1000 = 10%).
- Over the cap, the request must include `discountApproval` with credentials of an active user holding `discounts.approve`; verified server-side, recorded as `discountApprovedById`, audit-logged (`DISCOUNT_OVERRIDE`). Failure → `403 DISCOUNT_APPROVAL_REQUIRED` / `DISCOUNT_APPROVAL_INVALID`.
- A discount reason is required when a discount exceeds the cap (approval) and optional otherwise.
- `discountAppliedById` = invoice creator; recorded on the invoice.

### 8.4 Finalization transaction (single DB transaction, `READ COMMITTED` + row locks)
1. Idempotency: if an invoice with `idempotencyKey` exists → if same creator and same request hash, return it with `200` and `replayed: true`; else `409 IDEMPOTENCY_KEY_CONFLICT`. A unique index on `idempotency_key` resolves races (the loser catches `23505` and returns the winner's invoice).
2. Load products (active, by id) and bundle components; reject inactive/missing (`422 PRODUCT_UNAVAILABLE`).
3. Compute totals (8.2), validate discount authorization (8.3), validate payments (Σ ≤ total; each > 0).
4. If outstanding > 0: `customer.name` required (`422 CUSTOMER_REQUIRED_FOR_CREDIT`).
5. Resolve customer: by `customerId`, or find-or-create by normalized phone (10-digit Indian mobile, optional +91), or walk-in (name/phone snapshot only, no record) when no phone.
6. Expand bundle lines to component quantities; aggregate per standard product; lock `stock_balances` rows ascending; verify availability; update balances; insert `SALE` movements.
7. Allocate the next invoice number from `document_sequences` (`UPDATE … SET last_value = last_value + 1 RETURNING`) — row-locked, gap-free under commit, unique index as backstop.
8. Insert invoice, items (snapshots: name, SKU, unit, kind, unit price, unit cost, bundle components), payments, audit log entry.
9. Commit. Any error rolls back everything — no stock change, no number consumed (the sequence update is in the same transaction).

### 8.5 Invoice numbering
Format `{prefix}-{seriesYear}-{000001}`, e.g. `KITE-2026-000001`. `prefix` comes from shop settings (`KITE` default); `seriesYear` is the active season's `invoiceSeries` (e.g. `2026` for Uttarayan 2026–27), falling back to the IST calendar year. Each `{prefix}-{seriesYear}` has its own sequence row; changing the prefix or season starts a new series and never renumbers old invoices. Other documents use the same mechanism: purchases `PUR-…`, returns `RET-…`.

## 9. Payments

- Payment rows are the only source of truth for money received. Fields: invoice, `direction` (`IN` payment / `OUT` refund), method (`CASH`, `UPI`, `CARD`, `OTHER`), amountPaise > 0, reference (UPI/Card txn id), note, receivedBy, createdAt, optional idempotencyKey (unique).
- Invoice cached aggregates (updated in the same transaction as the payment): `amountPaidPaise` (Σ IN), `amountRefundedPaise` (Σ OUT), `returnedAmountPaise`, `outstandingPaise`, `paymentStatus`.
- Derived:
  - `owed = total − returnedAmount`
  - `netPaid = amountPaid − amountRefunded`
  - `outstanding = max(0, owed − netPaid)`
  - `creditDue = max(0, netPaid − owed)` (money the shop owes back after a return)
- `paymentStatus`:
  - `REFUNDED` if `amountRefunded > 0` and `netPaid == 0` and `owed == 0`
  - `PAID` if `outstanding == 0` (includes fully returned invoices with nothing paid)
  - `PARTIALLY_PAID` if `0 < netPaid < owed`
  - `UNPAID` if `netPaid == 0` and `owed > 0`
- Overpayment is rejected (`422 OVERPAYMENT`). Cash change is handled in the mobile UI ("Cash tendered ₹500 → give back ₹120"); only the bill amount is recorded.
- Split payment: multiple payment rows at checkout (e.g. ₹300 CASH + ₹200 UPI).
- Later collection: `POST /invoices/:id/payments` with its own idempotency key. **Never touches stock.**
- Payments on a VOID invoice are rejected.
- Payments are immutable. A mistaken payment is corrected by an admin refund (`OUT`) with a reason.

## 10. Returns, refunds and voids

### 10.1 Return (admin)
Input: lines `{invoiceItemId, quantity, restock: boolean}`, reason (required), optional `refund: {method, amountPaise}`.
- `quantity ≤ sold − alreadyReturned` per line.
- Value per line = `round(lineTotal × qty / soldQty)`; when the return completes the line (all units returned), value = `lineTotal − Σ previous returned values` (no paise drift).
- Restockable lines restore component stock using the invoice's bundle snapshot (`SALE_RETURN`).
- `returnedAmountPaise` += value; return number `RET-YYYY-NNNNNN`.
- Optional refund in the same transaction: `amount ≤ creditDue` after the return.
- Profit reporting deducts returned revenue (ex-tax) and returned cost.

### 10.2 Refund (admin)
`POST /invoices/:id/refunds` `{method, amountPaise, reason}`: an `OUT` payment, `amount ≤ netPaid` (allows correcting a mistaken payment) and reason required.

### 10.3 Void (admin)
`POST /invoices/:id/void` `{reason, refundMethod?}`. Allowed on FINALIZED invoices only. Restores all not-yet-returned stock (`VOID_RESTORE`), sets `status=VOID`, `voidedAt/By/Reason`, `outstanding=0`. If `netPaid > 0`, a refund of `netPaid` is recorded with `refundMethod` (required in that case). Voided invoices keep their number and remain visible; they are excluded from sales figures. Void is irreversible.

### 10.4 Immutability
After finalization these fields never change: items, prices, quantities, discounts, total, tax, customer snapshot, salesperson, number, created timestamp. Only aggregates driven by payments/returns/void change, each via its own audited record. Customer linkage on an invoice can be corrected (attach to customer record) by admin, audit-logged.

## 11. Customers
Fields: id, name (2–100), phone (unique when set, normalized `+91XXXXXXXXXX` → stored `XXXXXXXXXX`), address, notes, createdAt, lastPurchaseAt. Walk-in sales need no record. Features: create, edit, search by phone/name, purchase history, total spent (Σ owed on non-void invoices), outstanding (Σ outstanding), collect payment against outstanding invoices (allocates oldest-first across selected invoices; one payment row per invoice), statement PDF (invoices, payments, running balance for a date range).

## 12. Suppliers and purchases
- Supplier: name, phone, address, notes, isActive.
- Purchase: number `PUR-…`, supplier (optional), purchase date, items `{productId (STANDARD), quantity, unitCostPaise}`, subtotal, amountPaid, balance, notes, `updateCostPrice` flag. Creation receives stock immediately (one transaction).
- Supplier payments: `{supplierId, purchaseId?, amountPaise, method, note}`; amount ≤ purchase balance when linked. Supplier balance = Σ purchase totals − Σ supplier payments. **Supplier payables never mix with customer receivables or sales.**

## 13. Cash sessions (daily shop closing)
- One session per business date. Admin opens it with opening cash.
- Cash movements during the day: `PAYOUT`, `EXPENSE`, `OTHER_RECEIPT` with reason.
- Closing summary (computed live; snapshotted at close):
  - Opening cash
  - Cash sales collected = Σ IN payments with method CASH on the business date
  - Other cash receipts = Σ OTHER_RECEIPT
  - Cash refunds = Σ OUT payments with method CASH on the business date
  - Cash expenses/payouts = Σ PAYOUT + EXPENSE
  - **Expected closing cash** = opening + cash sales + other receipts − cash refunds − payouts/expenses
  - Actual counted cash (entered at close), Difference = counted − expected
  - UPI/Card/Other collections, total bills, bills value, pending customer payments (as of close)
- Unpaid invoices never count as cash. A closed session is immutable; reopening is SUPER_ADMIN-only with a reason (audited).
- Billing is **not** blocked when no session is open (sales must never stop during the rush); the CRM shows a banner.

## 14. Seasons
Season: name ("Uttarayan 2026–27"), code, startsOn, endsOn, invoiceSeries ("2026"), isActive (exactly one active). Invoices store `seasonId`. Season reports compare sales, top products, categories, bills, average bill value, discounts, and closing stock across seasons.

## 15. Dashboard (CRM, `dashboard.view`)
All figures from transactions; every widget accepts `from`/`to` (IST dates). Definitions:

| KPI | Definition |
|---|---|
| Sales (range) | Σ `total` of non-void invoices created in range − Σ return values recorded in range |
| Sales this season | same, for active season's date range |
| Cash collected (range) | Σ IN payments, method CASH, in range |
| UPI collected | Σ IN payments, method UPI, in range |
| Outstanding | Σ `outstanding` on non-void invoices (point-in-time, not filtered) |
| Bills | count of non-void invoices created in range |
| Products in inventory | count of active STANDARD products, and Σ units |
| Low stock count | active STANDARD with quantity ≤ minStockAlert |
| Inventory value | Σ quantity × purchasePrice (cost) |
| Estimated gross profit | (Σ line revenue ex-tax − Σ line cost) for non-void invoices in range − (returned revenue ex-tax − returned cost) for returns in range. Excludes operating expenses, taxes, supplier credit, shrinkage. |
| Average bill value | Σ total / bills for non-void invoices in range |
| Discount given | Σ `discountTotal` of non-void invoices in range |
| Refunds | Σ OUT payments in range (shown separately) |

Charts: daily sales trend (sales, collections), payment method breakdown, top products (qty, revenue), salesperson performance (bills, sales, collected, discounts), stock overview (in stock, low, out, valuation).

## 16. Reports (`reports.*`)
Each report: JSON (paginated or full), CSV export, XLSX export; filters as applicable (date range, product, category, salesperson, payment method, season). Reports: Daily sales, Weekly sales, Seasonal sales, Product-wise sales, Category-wise sales, Salesperson-wise sales, Payment collection, Pending customer payments (with ageing), Discount, Stock movement (with opening/closing balances per product for the range), Low stock, Inventory valuation, Purchases (with supplier balances), Estimated gross profit, Returns & refunds. Invoice PDFs and customer statements are PDF; reports are CSV/XLSX (PDF report export is out of scope for v1).

## 17. Invoices (documents)
PDF generated server-side (pdfkit), A4 and 80 mm thermal layouts (`?format=a4|thermal`). Contents: shop name/address/phone/logo, title ("Bill of Supply"/"Invoice" by default; "Tax Invoice" **only** when tax is enabled and a GSTIN is configured), number, IST date-time, salesperson, customer (if any), lines (name, qty, unit, rate, discount, amount), subtotal, discounts, tax (if enabled), total, paid, balance, status, payment methods, returns/void watermark, notes, footer. Access requires authentication and invoice-read permission; links are never public.

Actions: view, PDF download (CRM), share via iOS share sheet (includes WhatsApp if installed — no WhatsApp API is used), AirPrint, reprint, record payment, return/refund/void (admin).

## 18. Mobile POS behaviour
- Catalog cached on device (React Query persisted to AsyncStorage) with "updated N min ago" freshness. Refreshed on app focus, every 60 s while the bill screen is open, and after each checkout.
- Cart persisted locally (Zustand + AsyncStorage) including its idempotency key; survives app kill.
- Checkout requires connectivity. Offline: cart editing works, checkout button shows "Offline — cannot verify stock", nothing is queued. (Decision: no offline finalization in v1 — see plan.md §Risks.)
- Checkout button disables on tap until the response; retries reuse the same idempotency key, so a lost response never creates a second bill.
- On `INSUFFICIENT_STOCK`, the cart highlights affected lines with the server's current availability.
- Repeat bill: copies items/quantities (not discounts' approval, not payments) into a new cart with a new idempotency key; prices are current.
- Barcode scanning via `expo-camera` (EAN-13, EAN-8, UPC, Code128, QR); a scan matches `barcode` or `sku`.

## 19. Audit log
Every privileged or financial action writes an `audit_logs` row: actor, action, entity type/id, before/after JSON (sanitized), metadata, IP, timestamp. Actions include: AUTH_LOGIN_SUCCESS/FAILED/LOCKED, AUTH_LOGOUT, AUTH_REFRESH_REUSE, PASSWORD_CHANGED/RESET, USER_CREATED/UPDATED/ACTIVATED/DEACTIVATED, SESSIONS_REVOKED, PRODUCT_CREATED/UPDATED/PRICE_CHANGED/ARCHIVED, CATEGORY_*, STOCK_* (each movement is itself the ledger), ADJUSTMENT_APPROVED/REJECTED, INVOICE_CREATED, DISCOUNT_OVERRIDE, PAYMENT_RECORDED, RETURN_CREATED, REFUND_RECORDED, INVOICE_VOIDED, CASH_SESSION_*, SETTINGS_UPDATED, PURCHASE_CREATED, SUPPLIER_PAYMENT. Audit rows are append-only (no update/delete API; DB role for app has no UPDATE/DELETE grant on `audit_logs` in production).

## 20. Error model
All errors: `{ "error": { "code": "INSUFFICIENT_STOCK", "message": "…", "details": {…} }, "requestId": "…" }`.

| HTTP | Codes |
|---|---|
| 400 | `VALIDATION_ERROR` (details: field errors) |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `TOKEN_EXPIRED`, `SESSION_REVOKED` |
| 403 | `FORBIDDEN`, `PASSWORD_CHANGE_REQUIRED`, `ACCOUNT_DISABLED`, `ACCOUNT_LOCKED`, `DISCOUNT_APPROVAL_REQUIRED`, `DISCOUNT_APPROVAL_INVALID` |
| 404 | `NOT_FOUND` |
| 409 | `INSUFFICIENT_STOCK` (details: `[{productId, name, requested, available}]`), `IDEMPOTENCY_KEY_CONFLICT`, `DUPLICATE` (unique field), `INVALID_STATE` (e.g. void a void), `CONCURRENT_MODIFICATION` |
| 422 | `PRODUCT_UNAVAILABLE`, `DISCOUNT_EXCEEDS_AMOUNT`, `OVERPAYMENT`, `REFUND_EXCEEDS_CREDIT`, `RETURN_EXCEEDS_SOLD`, `CUSTOMER_REQUIRED_FOR_CREDIT`, `BUSINESS_RULE` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` (no internals leaked) |

## 21. Edge cases (explicitly handled)
1. Double-tap checkout / lost response → same idempotency key → single invoice.
2. Two devices sell the last units → one `409 INSUFFICIENT_STOCK`.
3. Product price changes while an item is in a cart → server bills at current price; mobile shows a "Prices updated" notice when the server total differs from the preview (response includes the authoritative total; the mobile app re-previews from refreshed catalog before submit).
4. Product deactivated while in cart → `422 PRODUCT_UNAVAILABLE`.
5. Bundle whose component is out of stock → `INSUFFICIENT_STOCK` naming the component.
6. Discount 100% → total 0 → status `PAID` with no payment rows.
7. Discount > eligible → `422 DISCOUNT_EXCEEDS_AMOUNT`.
8. Payment > outstanding → `422 OVERPAYMENT`.
9. Return after partial payment → outstanding recomputed; credit due only if net paid > owed.
10. Void of a partially paid invoice → refund of net paid required.
11. Session revoked / user disabled mid-shift → next request 401, mobile returns to login and **keeps the cart**.
12. Refresh token reuse (stolen token) → whole session family revoked.
13. Invoice number contention → serialized by the sequence row lock; never duplicated.
14. Clock skew on devices → all timestamps are server-assigned.
15. CSV import with a bad row → nothing applied; row errors returned.
16. Deleting a category/product with history → deactivation instead.
17. Season switch mid-day → new series; old numbers untouched.
18. Customer phone entered with +91/spaces → normalized; invalid → 400.

## 22. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | p95 `POST /invoices` (5 lines) < 300 ms and product search < 150 ms on a 2 vCPU server with 12 concurrent sellers; dashboard summary < 800 ms with 50k invoices. Verified by `apps/api/test/load` script. |
| Concurrency | 12 parallel sellers hammering the same product never produce negative stock or duplicate numbers (integration-tested). |
| Availability | Single-node deploy with health checks and auto-restart; DB backups nightly + before each deploy; documented restore. |
| Data integrity | FK + CHECK constraints; transactions for every multi-row write; migrations only (no `synchronize`). |
| Security | See security.md (OWASP ASVS L1-oriented). |
| Time | DB stores `timestamptz` (UTC); all business-date logic uses `Asia/Kolkata`. |
| Accessibility | CRM WCAG 2.1 AA contrast, keyboard navigable; mobile touch targets ≥ 48 pt, Dynamic Type tolerant. |
| Observability | JSON structured logs with request id and redaction; `/health/live`, `/health/ready` (DB). |

## 23. Definition of Done (per feature)
A feature is done when: (1) API endpoint implemented with DTO validation, RBAC, audit where required; (2) covered by unit and/or integration tests that pass; (3) UI implemented against the real API (no mock data); (4) errors are handled and shown; (5) documented in api-specification.md; (6) recorded in progress.md with test evidence. The project-level Definition of Done is the checklist in plan.md §8.
