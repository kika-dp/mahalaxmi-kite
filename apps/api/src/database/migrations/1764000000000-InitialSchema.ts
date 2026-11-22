import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema (docs/database-schema.md). Hand-written so that every CHECK constraint,
 * partial index and trigram index is explicit and reviewable.
 */
export class InitialSchema1764000000000 implements MigrationInterface {
  name = 'InitialSchema1764000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE EXTENSION IF NOT EXISTS citext;
      CREATE EXTENSION IF NOT EXISTS pg_trgm;

      -- ---------------- identity ----------------
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        username citext NOT NULL UNIQUE,
        email citext NOT NULL UNIQUE,
        full_name varchar(100) NOT NULL,
        phone varchar(15),
        role varchar(20) NOT NULL CHECK (role IN ('SUPER_ADMIN','ADMIN','INVENTORY_MANAGER','SALESPERSON')),
        password_hash text NOT NULL,
        must_change_password boolean NOT NULL DEFAULT true,
        is_active boolean NOT NULL DEFAULT true,
        max_discount_bps int CHECK (max_discount_bps BETWEEN 0 AND 10000),
        failed_login_count int NOT NULL DEFAULT 0,
        locked_until timestamptz,
        last_login_at timestamptz,
        password_changed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE user_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        family_id uuid NOT NULL,
        refresh_token_hash char(64) NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        revoked_reason varchar(40),
        replaced_by_id uuid,
        remember boolean NOT NULL DEFAULT false,
        user_agent varchar(255),
        ip varchar(64),
        created_at timestamptz NOT NULL DEFAULT now(),
        last_used_at timestamptz
      );
      CREATE INDEX idx_sessions_user_active ON user_sessions(user_id) WHERE revoked_at IS NULL;
      CREATE INDEX idx_sessions_family ON user_sessions(family_id);

      CREATE TABLE shop_settings (
        id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        shop_name varchar(120) NOT NULL,
        address text NOT NULL DEFAULT '',
        phone varchar(20) NOT NULL DEFAULT '',
        email varchar(120),
        logo_url varchar(255),
        brand_color varchar(7) NOT NULL DEFAULT '#F97316' CHECK (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
        invoice_prefix varchar(10) NOT NULL DEFAULT 'KITE' CHECK (invoice_prefix ~ '^[A-Z0-9]{1,10}$'),
        invoice_title varchar(40) NOT NULL DEFAULT 'Invoice',
        invoice_footer text,
        tax_enabled boolean NOT NULL DEFAULT false,
        tax_label varchar(20) NOT NULL DEFAULT 'GST',
        tax_rate_bps int NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
        gstin varchar(15),
        salesperson_max_discount_bps int NOT NULL DEFAULT 1000 CHECK (salesperson_max_discount_bps BETWEEN 0 AND 10000),
        default_min_stock_alert int NOT NULL DEFAULT 10 CHECK (default_min_stock_alert >= 0),
        require_customer_phone_for_credit boolean NOT NULL DEFAULT false,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by uuid REFERENCES users(id)
      );

      CREATE TABLE seasons (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(60) NOT NULL UNIQUE,
        code varchar(20) NOT NULL UNIQUE,
        starts_on date NOT NULL,
        ends_on date NOT NULL,
        invoice_series varchar(10) NOT NULL CHECK (invoice_series ~ '^[A-Z0-9]{1,10}$'),
        is_active boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK (ends_on >= starts_on)
      );
      CREATE UNIQUE INDEX uq_seasons_single_active ON seasons ((true)) WHERE is_active;

      CREATE TABLE audit_logs (
        id bigserial PRIMARY KEY,
        actor_id uuid,
        actor_username varchar(64),
        action varchar(50) NOT NULL,
        entity_type varchar(40),
        entity_id varchar(64),
        before jsonb,
        after jsonb,
        metadata jsonb,
        ip varchar(64),
        request_id varchar(64),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
      CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
      CREATE INDEX idx_audit_actor ON audit_logs(actor_id, created_at DESC);
      CREATE INDEX idx_audit_action ON audit_logs(action);

      CREATE TABLE document_sequences (
        key varchar(40) PRIMARY KEY,
        last_value bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      -- ---------------- catalog ----------------
      CREATE TABLE product_categories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name citext NOT NULL UNIQUE,
        sort_order int NOT NULL DEFAULT 0,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE suppliers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(120) NOT NULL,
        phone varchar(15),
        address text,
        notes text,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_suppliers_name ON suppliers (lower(name));

      CREATE TABLE products (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        sku citext NOT NULL UNIQUE,
        barcode varchar(64) UNIQUE,
        name varchar(120) NOT NULL,
        description text,
        category_id uuid NOT NULL REFERENCES product_categories(id),
        kind varchar(10) NOT NULL CHECK (kind IN ('STANDARD','BUNDLE')),
        unit_type varchar(10) NOT NULL CHECK (unit_type IN ('PIECE','PACKET','BUNDLE','BOX','DOZEN','ROLL')),
        purchase_price_paise bigint NOT NULL DEFAULT 0 CHECK (purchase_price_paise >= 0),
        selling_price_paise bigint NOT NULL CHECK (selling_price_paise >= 0),
        mrp_paise bigint CHECK (mrp_paise >= 0),
        min_stock_alert int NOT NULL DEFAULT 10 CHECK (min_stock_alert >= 0),
        supplier_id uuid REFERENCES suppliers(id),
        image_url varchar(255),
        is_active boolean NOT NULL DEFAULT true,
        is_favorite boolean NOT NULL DEFAULT false,
        favorite_order int NOT NULL DEFAULT 0,
        has_opening_stock boolean NOT NULL DEFAULT false,
        created_by uuid REFERENCES users(id),
        updated_by uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_products_category ON products(category_id);
      CREATE INDEX idx_products_active_fav ON products(is_active, is_favorite);
      CREATE INDEX idx_products_name_trgm ON products USING gin (name gin_trgm_ops);
      CREATE INDEX idx_products_sku_trgm ON products USING gin ((sku::text) gin_trgm_ops);

      CREATE TABLE product_bundle_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        bundle_product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        component_product_id uuid NOT NULL REFERENCES products(id),
        quantity int NOT NULL CHECK (quantity > 0),
        UNIQUE (bundle_product_id, component_product_id),
        CHECK (bundle_product_id <> component_product_id)
      );
      CREATE INDEX idx_bundle_component ON product_bundle_items(component_product_id);

      CREATE TABLE stock_balances (
        product_id uuid PRIMARY KEY REFERENCES products(id),
        quantity int NOT NULL DEFAULT 0 CONSTRAINT chk_stock_non_negative CHECK (quantity >= 0),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      -- ---------------- inventory ----------------
      CREATE TABLE stock_movements (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        seq bigserial NOT NULL UNIQUE, -- strict insertion order (created_at ties within a transaction)
        product_id uuid NOT NULL REFERENCES products(id),
        movement_type varchar(20) NOT NULL CHECK (movement_type IN (
          'OPENING','PURCHASE_RECEIPT','ADJUSTMENT_IN','ADJUSTMENT_OUT','DAMAGED','LOST','COUNT_CORRECTION',
          'SALE','SALE_RETURN','VOID_RESTORE','TRANSFER_IN','TRANSFER_OUT')),
        quantity_change int NOT NULL CHECK (quantity_change <> 0),
        previous_quantity int NOT NULL,
        new_quantity int NOT NULL CHECK (new_quantity >= 0),
        unit_cost_paise bigint,
        reference_type varchar(20) CHECK (reference_type IN (
          'INVOICE','RETURN','VOID','PURCHASE','RECEIPT','ADJUSTMENT','STOCK_COUNT','OPENING')),
        reference_id uuid,
        reference_number varchar(30),
        reason text,
        created_by_id uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK (new_quantity = previous_quantity + quantity_change)
      );
      CREATE INDEX idx_movements_product_time ON stock_movements(product_id, created_at DESC);
      CREATE INDEX idx_movements_product_seq ON stock_movements(product_id, seq DESC);
      CREATE INDEX idx_movements_reference ON stock_movements(reference_type, reference_id);
      CREATE INDEX idx_movements_time ON stock_movements(created_at);

      CREATE TABLE stock_adjustments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id uuid NOT NULL REFERENCES products(id),
        adjustment_type varchar(20) NOT NULL CHECK (adjustment_type IN ('ADJUSTMENT_IN','ADJUSTMENT_OUT','DAMAGED','LOST')),
        quantity int NOT NULL CHECK (quantity > 0),
        reason text NOT NULL,
        status varchar(10) NOT NULL CHECK (status IN ('PENDING','APPLIED','REJECTED')),
        requested_by_id uuid NOT NULL REFERENCES users(id),
        decided_by_id uuid REFERENCES users(id),
        decided_at timestamptz,
        decision_note text,
        movement_id uuid REFERENCES stock_movements(id),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_adjustments_status ON stock_adjustments(status, created_at DESC);

      CREATE TABLE stock_counts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        count_number varchar(30) NOT NULL UNIQUE,
        status varchar(10) NOT NULL CHECK (status IN ('OPEN','COMPLETED','CANCELLED')),
        notes text,
        created_by_id uuid NOT NULL REFERENCES users(id),
        completed_by_id uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz
      );

      CREATE TABLE stock_count_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        stock_count_id uuid NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
        product_id uuid NOT NULL REFERENCES products(id),
        system_quantity int NOT NULL,
        counted_quantity int NOT NULL CHECK (counted_quantity >= 0),
        variance int NOT NULL,
        counted_by_id uuid NOT NULL REFERENCES users(id),
        counted_at timestamptz NOT NULL,
        UNIQUE (stock_count_id, product_id)
      );

      -- ---------------- customers & sales ----------------
      CREATE TABLE customers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(100) NOT NULL,
        phone varchar(10) UNIQUE CHECK (phone ~ '^[6-9][0-9]{9}$'),
        address text,
        notes text,
        last_purchase_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_customers_name_trgm ON customers USING gin (name gin_trgm_ops);

      CREATE TABLE invoices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_number varchar(30) NOT NULL UNIQUE,
        idempotency_key uuid NOT NULL UNIQUE,
        request_hash char(64) NOT NULL,
        season_id uuid REFERENCES seasons(id),
        status varchar(10) NOT NULL CHECK (status IN ('FINALIZED','VOID')),
        payment_status varchar(16) NOT NULL CHECK (payment_status IN ('UNPAID','PARTIALLY_PAID','PAID','REFUNDED')),
        salesperson_id uuid NOT NULL REFERENCES users(id),
        customer_id uuid REFERENCES customers(id),
        customer_name varchar(100),
        customer_phone varchar(10),
        gross_subtotal_paise bigint NOT NULL DEFAULT 0 CHECK (gross_subtotal_paise >= 0),
        line_discount_total_paise bigint NOT NULL DEFAULT 0 CHECK (line_discount_total_paise >= 0),
        bill_discount_type varchar(8) NOT NULL DEFAULT 'NONE' CHECK (bill_discount_type IN ('NONE','FIXED','PERCENT')),
        bill_discount_value bigint NOT NULL DEFAULT 0 CHECK (bill_discount_value >= 0),
        bill_discount_paise bigint NOT NULL DEFAULT 0 CHECK (bill_discount_paise >= 0),
        discount_total_paise bigint NOT NULL DEFAULT 0 CHECK (discount_total_paise >= 0),
        taxable_amount_paise bigint NOT NULL DEFAULT 0 CHECK (taxable_amount_paise >= 0),
        tax_rate_bps int NOT NULL DEFAULT 0,
        tax_paise bigint NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
        total_paise bigint NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
        cost_total_paise bigint NOT NULL DEFAULT 0,
        returned_amount_paise bigint NOT NULL DEFAULT 0 CHECK (returned_amount_paise >= 0 AND returned_amount_paise <= total_paise),
        amount_paid_paise bigint NOT NULL DEFAULT 0 CHECK (amount_paid_paise >= 0),
        amount_refunded_paise bigint NOT NULL DEFAULT 0 CHECK (amount_refunded_paise >= 0 AND amount_refunded_paise <= amount_paid_paise),
        outstanding_paise bigint NOT NULL DEFAULT 0 CHECK (outstanding_paise >= 0),
        discount_reason varchar(200),
        discount_applied_by_id uuid REFERENCES users(id),
        discount_approved_by_id uuid REFERENCES users(id),
        notes varchar(500),
        voided_at timestamptz,
        voided_by_id uuid REFERENCES users(id),
        void_reason varchar(500),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (total_paise = taxable_amount_paise + tax_paise),
        CHECK (discount_total_paise = line_discount_total_paise + bill_discount_paise)
      );
      CREATE INDEX idx_invoices_created ON invoices(created_at DESC);
      CREATE INDEX idx_invoices_salesperson ON invoices(salesperson_id, created_at DESC);
      CREATE INDEX idx_invoices_customer ON invoices(customer_id);
      CREATE INDEX idx_invoices_customer_phone ON invoices(customer_phone);
      CREATE INDEX idx_invoices_outstanding ON invoices(payment_status) WHERE status = 'FINALIZED';
      CREATE INDEX idx_invoices_season ON invoices(season_id);

      CREATE TABLE invoice_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        line_no int NOT NULL,
        product_id uuid NOT NULL REFERENCES products(id),
        product_name varchar(120) NOT NULL,
        sku varchar(40) NOT NULL,
        unit_type varchar(10) NOT NULL,
        kind varchar(10) NOT NULL,
        quantity int NOT NULL CHECK (quantity > 0),
        unit_price_paise bigint NOT NULL CHECK (unit_price_paise >= 0),
        unit_cost_paise bigint NOT NULL DEFAULT 0,
        gross_paise bigint NOT NULL,
        line_discount_type varchar(8) NOT NULL DEFAULT 'NONE',
        line_discount_value bigint NOT NULL DEFAULT 0,
        line_discount_paise bigint NOT NULL DEFAULT 0 CHECK (line_discount_paise >= 0),
        bill_discount_alloc_paise bigint NOT NULL DEFAULT 0 CHECK (bill_discount_alloc_paise >= 0),
        tax_alloc_paise bigint NOT NULL DEFAULT 0 CHECK (tax_alloc_paise >= 0),
        line_total_paise bigint NOT NULL CHECK (line_total_paise >= 0),
        returned_quantity int NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0 AND returned_quantity <= quantity),
        note varchar(200),
        UNIQUE (invoice_id, line_no),
        CHECK (gross_paise = quantity * unit_price_paise)
      );
      CREATE INDEX idx_invoice_items_product ON invoice_items(product_id);

      CREATE TABLE invoice_item_components (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_item_id uuid NOT NULL REFERENCES invoice_items(id) ON DELETE CASCADE,
        product_id uuid NOT NULL REFERENCES products(id),
        product_name varchar(120) NOT NULL,
        quantity_per_unit int NOT NULL CHECK (quantity_per_unit > 0),
        unit_cost_paise bigint NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_item_components_item ON invoice_item_components(invoice_item_id);

      CREATE TABLE returns (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        return_number varchar(30) NOT NULL UNIQUE,
        invoice_id uuid NOT NULL REFERENCES invoices(id),
        reason text NOT NULL,
        total_paise bigint NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
        tax_paise bigint NOT NULL DEFAULT 0,
        cost_paise bigint NOT NULL DEFAULT 0,
        created_by_id uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_returns_invoice ON returns(invoice_id);
      CREATE INDEX idx_returns_created ON returns(created_at);

      CREATE TABLE return_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        return_id uuid NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
        invoice_item_id uuid NOT NULL REFERENCES invoice_items(id),
        product_id uuid NOT NULL REFERENCES products(id),
        quantity int NOT NULL CHECK (quantity > 0),
        amount_paise bigint NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
        tax_paise bigint NOT NULL DEFAULT 0,
        cost_paise bigint NOT NULL DEFAULT 0,
        restocked boolean NOT NULL
      );

      CREATE TABLE payments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_id uuid NOT NULL REFERENCES invoices(id),
        direction varchar(3) NOT NULL CHECK (direction IN ('IN','OUT')),
        method varchar(5) NOT NULL CHECK (method IN ('CASH','UPI','CARD','OTHER')),
        amount_paise bigint NOT NULL CHECK (amount_paise > 0),
        reference varchar(60),
        note varchar(200),
        received_by_id uuid NOT NULL REFERENCES users(id),
        return_id uuid REFERENCES returns(id),
        idempotency_key uuid,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_payments_invoice ON payments(invoice_id);
      CREATE INDEX idx_payments_created ON payments(created_at);
      CREATE INDEX idx_payments_method_created ON payments(method, created_at);
      CREATE INDEX idx_payments_receiver ON payments(received_by_id, created_at);
      CREATE INDEX idx_payments_idem ON payments(idempotency_key) WHERE idempotency_key IS NOT NULL;

      -- ---------------- purchasing ----------------
      CREATE TABLE purchases (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        purchase_number varchar(30) NOT NULL UNIQUE,
        supplier_id uuid REFERENCES suppliers(id),
        purchase_date date NOT NULL,
        subtotal_paise bigint NOT NULL DEFAULT 0 CHECK (subtotal_paise >= 0),
        amount_paid_paise bigint NOT NULL DEFAULT 0 CHECK (amount_paid_paise >= 0),
        notes text,
        created_by_id uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK (amount_paid_paise <= subtotal_paise)
      );
      CREATE INDEX idx_purchases_supplier ON purchases(supplier_id);
      CREATE INDEX idx_purchases_date ON purchases(purchase_date);

      CREATE TABLE purchase_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        purchase_id uuid NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
        product_id uuid NOT NULL REFERENCES products(id),
        quantity int NOT NULL CHECK (quantity > 0),
        unit_cost_paise bigint NOT NULL CHECK (unit_cost_paise >= 0),
        line_total_paise bigint NOT NULL CHECK (line_total_paise >= 0)
      );

      CREATE TABLE supplier_payments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        supplier_id uuid NOT NULL REFERENCES suppliers(id),
        purchase_id uuid REFERENCES purchases(id),
        amount_paise bigint NOT NULL CHECK (amount_paise > 0),
        method varchar(5) NOT NULL CHECK (method IN ('CASH','UPI','CARD','OTHER')),
        note varchar(200),
        paid_at timestamptz NOT NULL DEFAULT now(),
        created_by_id uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_supplier_payments_supplier ON supplier_payments(supplier_id);

      -- ---------------- cash ----------------
      CREATE TABLE cash_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_date date NOT NULL UNIQUE,
        status varchar(6) NOT NULL CHECK (status IN ('OPEN','CLOSED')),
        opening_cash_paise bigint NOT NULL DEFAULT 0 CHECK (opening_cash_paise >= 0),
        opened_by_id uuid NOT NULL REFERENCES users(id),
        opened_at timestamptz NOT NULL DEFAULT now(),
        closed_by_id uuid REFERENCES users(id),
        closed_at timestamptz,
        expected_cash_paise bigint,
        counted_cash_paise bigint CHECK (counted_cash_paise >= 0),
        difference_paise bigint,
        notes text,
        summary jsonb
      );

      CREATE TABLE cash_movements (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        cash_session_id uuid NOT NULL REFERENCES cash_sessions(id),
        type varchar(15) NOT NULL CHECK (type IN ('PAYOUT','EXPENSE','OTHER_RECEIPT')),
        amount_paise bigint NOT NULL CHECK (amount_paise > 0),
        reason varchar(200) NOT NULL,
        created_by_id uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_cash_movements_session ON cash_movements(cash_session_id);
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TABLE IF EXISTS cash_movements, cash_sessions, supplier_payments, purchase_items, purchases,
        payments, return_items, returns, invoice_item_components, invoice_items, invoices, customers,
        stock_count_items, stock_counts, stock_adjustments, stock_movements, stock_balances,
        product_bundle_items, products, suppliers, product_categories, document_sequences, audit_logs,
        seasons, shop_settings, user_sessions, users CASCADE;
    `);
  }
}
