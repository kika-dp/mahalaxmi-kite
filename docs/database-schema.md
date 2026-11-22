# Database Schema

PostgreSQL ≥ 14. Managed exclusively by TypeORM migrations in `apps/api/src/database/migrations` (`synchronize` is always off). Extensions: `pgcrypto` (UUIDs), `pg_trgm` (fuzzy product search), `citext` (case-insensitive identifiers).

Conventions
- Table/column names `snake_case`; primary keys `uuid DEFAULT gen_random_uuid()` unless noted.
- Money: `bigint` **paise** (columns end in `_paise`), mapped to JS `number` by a transformer (safe to ₹90 trillion).
- Percentages: `integer` basis points (`_bps`).
- Quantities: `integer` in the product's base unit.
- Time: `timestamptz` (UTC). Business dates use `(created_at AT TIME ZONE 'Asia/Kolkata')::date`.
- Every table has `created_at`; mutable tables also have `updated_at`.
- Enumerations are `varchar` columns with `CHECK (… IN (…))` constraints (easier to evolve than PG enum types).
- Actor foreign keys on ledger-style tables are named `*_by_id` (e.g. `created_by_id`, `requested_by_id`).

## Entity relationship overview

```
users 1─* user_sessions
users 1─* invoices (salesperson)          seasons 1─* invoices
product_categories 1─* products           suppliers 1─* products (default supplier)
products 1─1 stock_balances (STANDARD only)
products 1─* product_bundle_items (as bundle) *─1 products (as component)
products 1─* stock_movements
customers 1─* invoices
invoices 1─* invoice_items 1─* invoice_item_components
invoices 1─* payments
invoices 1─* returns 1─* return_items *─1 invoice_items
suppliers 1─* purchases 1─* purchase_items ; suppliers 1─* supplier_payments
stock_adjustments ─ stock_movements (reference)
stock_counts 1─* stock_count_items
cash_sessions 1─* cash_movements
audit_logs (append-only), document_sequences, shop_settings (single row)
```

## Tables

### users
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| username | citext UNIQUE NOT NULL | 3–32, `[a-z0-9._-]` |
| email | citext UNIQUE NOT NULL | |
| full_name | varchar(100) NOT NULL | |
| phone | varchar(15) | |
| role | enum `user_role` (SUPER_ADMIN, ADMIN, INVENTORY_MANAGER, SALESPERSON) | |
| password_hash | text NOT NULL | Argon2id encoded |
| must_change_password | boolean NOT NULL default true | |
| is_active | boolean NOT NULL default true | |
| max_discount_bps | integer NULL CHECK 0–10000 | per-user override of shop cap |
| failed_login_count | integer NOT NULL default 0 | |
| locked_until | timestamptz NULL | |
| last_login_at, password_changed_at | timestamptz NULL | |
| created_at, updated_at | timestamptz | |

### user_sessions
id, user_id FK→users (cascade), family_id uuid NOT NULL, refresh_token_hash char(64) UNIQUE, expires_at, revoked_at NULL, revoked_reason varchar(40) NULL, replaced_by_id uuid NULL, remember boolean, user_agent varchar(255), ip varchar(64), created_at, last_used_at. Index `(user_id) WHERE revoked_at IS NULL`, `(family_id)`.

### shop_settings (single row, `id = 1`, CHECK id = 1)
shop_name, address, phone, email, logo_url, brand_color (`#RRGGBB`), invoice_prefix varchar(10) default `KITE`, invoice_title varchar(40) default `Invoice`, invoice_footer text, tax_enabled bool default false, tax_label varchar(20) default `GST`, tax_rate_bps int default 0, gstin varchar(15), salesperson_max_discount_bps int default 1000, default_min_stock_alert int default 10, require_customer_phone_for_credit bool default false, updated_at, updated_by FK users.

### seasons
id, name varchar(60) UNIQUE, code varchar(20) UNIQUE, starts_on date, ends_on date (CHECK ends_on ≥ starts_on), invoice_series varchar(10), is_active bool. Partial unique index `ON seasons ((true)) WHERE is_active` → at most one active.

### product_categories
id, name citext UNIQUE, sort_order int default 0, is_active bool default true, created_at, updated_at.

### suppliers
id, name varchar(120), phone varchar(15), address text, notes text, is_active bool, created_at, updated_at. Index on lower(name).

### products
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| sku | citext UNIQUE NOT NULL | |
| barcode | varchar(64) UNIQUE NULL | |
| name | varchar(120) NOT NULL | GIN trigram index |
| description | text | |
| category_id | uuid FK→product_categories NOT NULL | |
| kind | enum `product_kind` (STANDARD, BUNDLE) | |
| unit_type | enum `unit_type` (PIECE, PACKET, BUNDLE, BOX, DOZEN, ROLL) | |
| purchase_price_paise | bigint NOT NULL default 0 CHECK ≥ 0 | |
| selling_price_paise | bigint NOT NULL CHECK ≥ 0 | |
| mrp_paise | bigint NULL CHECK ≥ 0 | |
| min_stock_alert | integer NOT NULL default 10 CHECK ≥ 0 | |
| supplier_id | uuid FK→suppliers NULL | |
| image_url | varchar(255) NULL | |
| is_active | boolean default true | |
| is_favorite | boolean default false | |
| favorite_order | integer default 0 | |
| has_opening_stock | boolean default false | |
| created_by, updated_by | uuid FK→users NULL | |
| created_at, updated_at | timestamptz | |
Indexes: `(category_id)`, `(is_active, is_favorite)`, GIN trigram on `name`, `sku`.

### product_bundle_items
id, bundle_product_id FK→products (cascade), component_product_id FK→products, quantity int CHECK > 0, UNIQUE(bundle_product_id, component_product_id), CHECK bundle ≠ component.

### stock_balances
product_id uuid PK FK→products, quantity integer NOT NULL **CHECK (quantity >= 0)**, updated_at. Row exists for every STANDARD product (created with the product, quantity 0).

### stock_movements (append-only ledger)
id uuid, **seq bigserial UNIQUE** (strict insertion order — rows written in one transaction share `now()`), product_id FK, movement_type enum `stock_movement_type`, quantity_change int (≠ 0 CHECK), previous_quantity int, new_quantity int (CHECK new = previous + change, CHECK new ≥ 0), unit_cost_paise bigint NULL, reference_type enum (`INVOICE`, `RETURN`, `VOID`, `PURCHASE`, `RECEIPT`, `ADJUSTMENT`, `STOCK_COUNT`, `OPENING`), reference_id uuid NULL, reference_number varchar(30) NULL, reason text NULL, created_by_id FK users, created_at. Indexes `(product_id, created_at DESC)`, `(product_id, seq DESC)`, `(reference_type, reference_id)`, `(created_at)`.

### stock_adjustments
id, product_id FK, adjustment_type (ADJUSTMENT_IN, ADJUSTMENT_OUT, DAMAGED, LOST), quantity int > 0, reason text NOT NULL, status (PENDING, APPLIED, REJECTED), requested_by FK, decided_by FK NULL, decided_at NULL, decision_note NULL, movement_id FK→stock_movements NULL, created_at.

### stock_counts / stock_count_items
stock_counts: id, count_number varchar UNIQUE, status (OPEN, COMPLETED, CANCELLED), notes, created_by, completed_by, created_at, completed_at.
stock_count_items: id, stock_count_id FK cascade, product_id FK, system_quantity int, counted_quantity int CHECK ≥ 0, variance int, counted_by, counted_at, UNIQUE(stock_count_id, product_id).

### customers
id, name varchar(100) NOT NULL, phone varchar(10) UNIQUE NULL, address text, notes text, last_purchase_at timestamptz, created_at, updated_at. Trigram index on name.

### document_sequences
key varchar(40) PK (e.g. `INV:KITE-2026`, `PUR:PUR-2026`, `RET:RET-2026`), last_value bigint NOT NULL default 0, updated_at.

### invoices
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| invoice_number | varchar(30) UNIQUE NOT NULL | |
| idempotency_key | uuid UNIQUE NOT NULL | |
| request_hash | char(64) NOT NULL | SHA-256 of normalized request |
| season_id | uuid FK NULL | |
| status | enum `invoice_status` (FINALIZED, VOID) | |
| payment_status | enum `payment_status` (UNPAID, PARTIALLY_PAID, PAID, REFUNDED) | |
| salesperson_id | uuid FK users NOT NULL | |
| customer_id | uuid FK NULL | |
| customer_name, customer_phone | varchar NULL | snapshot |
| gross_subtotal_paise, line_discount_total_paise | bigint | |
| bill_discount_type | enum (NONE, FIXED, PERCENT) | |
| bill_discount_value | bigint | paise or bps |
| bill_discount_paise, discount_total_paise | bigint | |
| taxable_amount_paise, tax_rate_bps, tax_paise | | |
| total_paise | bigint CHECK ≥ 0 | |
| cost_total_paise | bigint | Σ unit cost × qty |
| returned_amount_paise, amount_paid_paise, amount_refunded_paise, outstanding_paise | bigint ≥ 0 | cached aggregates |
| discount_reason | varchar(200) | |
| discount_applied_by_id, discount_approved_by_id | uuid FK NULL | |
| notes | varchar(500) | |
| voided_at, voided_by_id, void_reason | | |
| created_at, updated_at | | |
Indexes: `(created_at DESC)`, `(salesperson_id, created_at DESC)`, `(customer_id)`, `(payment_status) WHERE status='FINALIZED'`, `(customer_phone)`, `(season_id)`.

### invoice_items
id, invoice_id FK cascade, line_no int, product_id FK, product_name, sku, unit_type, kind, quantity int > 0, unit_price_paise, unit_cost_paise, gross_paise, line_discount_type, line_discount_value, line_discount_paise, bill_discount_alloc_paise, tax_alloc_paise, line_total_paise, returned_quantity int default 0 CHECK 0 ≤ returned ≤ quantity, note varchar(200). UNIQUE(invoice_id, line_no). Index (product_id).

### invoice_item_components (bundle snapshot)
id, invoice_item_id FK cascade, product_id FK, product_name (snapshot), quantity_per_unit int > 0, unit_cost_paise.

### payments
id, invoice_id FK, direction enum (IN, OUT), method enum (CASH, UPI, CARD, OTHER), amount_paise bigint CHECK > 0, reference varchar(60), note varchar(200), received_by_id FK users, return_id FK NULL, idempotency_key uuid UNIQUE NULL, created_at. Indexes `(invoice_id)`, `(created_at)`, `(method, created_at)`, `(received_by_id, created_at)`.

### returns / return_items
returns: id, return_number UNIQUE, invoice_id FK, reason text NOT NULL, total_paise, tax_paise, cost_paise, created_by FK, created_at. Index (invoice_id), (created_at).
return_items: id, return_id FK cascade, invoice_item_id FK, product_id FK, quantity > 0, amount_paise, tax_paise, cost_paise, restocked bool.

### purchases / purchase_items / supplier_payments
purchases: id, purchase_number UNIQUE, supplier_id FK NULL, purchase_date date, subtotal_paise, amount_paid_paise, notes, created_by, created_at.
purchase_items: id, purchase_id FK cascade, product_id FK, quantity > 0, unit_cost_paise ≥ 0, line_total_paise.
supplier_payments: id, supplier_id FK, purchase_id FK NULL, amount_paise > 0, method, note, paid_at timestamptz, created_by, created_at.

### cash_sessions / cash_movements
cash_sessions: id, business_date date UNIQUE, status (OPEN, CLOSED), opening_cash_paise, opened_by, opened_at, closed_by, closed_at, expected_cash_paise, counted_cash_paise, difference_paise, notes, summary jsonb.
cash_movements: id, cash_session_id FK, type (PAYOUT, EXPENSE, OTHER_RECEIPT), amount_paise > 0, reason, created_by, created_at.

### audit_logs (append-only)
id bigserial, actor_id uuid NULL, actor_username varchar, action varchar(50), entity_type varchar(40), entity_id varchar(64), before jsonb, after jsonb, metadata jsonb, ip varchar(64), request_id varchar(64), created_at. Indexes `(created_at DESC)`, `(entity_type, entity_id)`, `(actor_id, created_at DESC)`, `(action)`.

## Concurrency-critical statements

```sql
-- stock lock (ids sorted ascending in application code)
SELECT product_id, quantity FROM stock_balances WHERE product_id = ANY($1) ORDER BY product_id FOR UPDATE;

-- invoice number
INSERT INTO document_sequences(key, last_value) VALUES ($1, 1)
ON CONFLICT (key) DO UPDATE SET last_value = document_sequences.last_value + 1, updated_at = now()
RETURNING last_value;
```

Payments/returns/void lock the invoice row (`SELECT … FROM invoices WHERE id=$1 FOR UPDATE`) before recomputing aggregates.

## Least-privilege roles (production)
- `kite_migrator`: owns schema, runs migrations.
- `kite_app`: `SELECT, INSERT, UPDATE, DELETE` on business tables; **only `SELECT, INSERT`** on `audit_logs` and `stock_movements`; no DDL. Script: `apps/api/scripts/db-roles.sql`.
