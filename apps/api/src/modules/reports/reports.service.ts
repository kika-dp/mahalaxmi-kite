import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { stringify } from 'csv-stringify/sync';
import ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import { istDateString, paiseToDecimalString, Permission, ReportColumn, ReportResult } from '@kite/shared';
import { AuthContext } from '../../common/decorators';
import { Errors } from '../../common/errors';
import { resolveRange } from '../../common/utils/dates';

export interface ReportFilters {
  from?: string;
  to?: string;
  salespersonId?: string;
  productId?: string;
  categoryId?: string;
  supplierId?: string;
  method?: string;
  type?: string;
  seasonIds?: string;
  asOf?: string;
}

type Def = {
  title: string;
  permission: Permission;
  columns: ReportColumn[];
  run: (f: ReportFilters) => Promise<Record<string, string | number | null>[]>;
  totals?: string[];
};

const money = (key: string, label: string): ReportColumn => ({ key, label, type: 'money' });
const num = (key: string, label: string): ReportColumn => ({ key, label, type: 'number' });
const text = (key: string, label: string): ReportColumn => ({ key, label, type: 'text' });
const date = (key: string, label: string): ReportColumn => ({ key, label, type: 'date' });
const dt = (key: string, label: string): ReportColumn => ({ key, label, type: 'datetime' });

export const REPORT_TYPES = [
  'daily-sales',
  'weekly-sales',
  'seasonal-sales',
  'product-sales',
  'category-sales',
  'salesperson-sales',
  'payments',
  'outstanding',
  'discounts',
  'stock-movements',
  'low-stock',
  'inventory-valuation',
  'purchases',
  'profit',
  'returns',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

@Injectable()
export class ReportsService {
  private readonly defs: Record<ReportType, Def>;

  constructor(@InjectDataSource() private readonly ds: DataSource) {
    const q = (sql: string, params: unknown[]) => this.ds.query(sql, params) as Promise<Record<string, any>[]>;
    const numify = (rows: Record<string, any>[], keys: string[]) =>
      rows.map((r) => {
        for (const k of keys) if (r[k] !== null && r[k] !== undefined) r[k] = Number(r[k]);
        return r;
      });

    const salesByPeriod = async (f: ReportFilters, unit: 'day' | 'week') => {
      const r = resolveRange(f.from, f.to, 400);
      const sp = f.salespersonId ?? null;
      const rows = await q(
        `WITH periods AS (
           SELECT DISTINCT date_trunc('${unit}', d)::date AS p FROM generate_series($1::date, $2::date, interval '1 day') d),
         inv AS (
           SELECT date_trunc('${unit}', (created_at AT TIME ZONE 'Asia/Kolkata')::date)::date AS p, count(*) AS bills,
                  sum(gross_subtotal_paise) AS gross, sum(discount_total_paise) AS discount, sum(total_paise) AS total
           FROM invoices WHERE status = 'FINALIZED' AND created_at >= $3 AND created_at < $4 AND ($5::uuid IS NULL OR salesperson_id = $5)
           GROUP BY 1),
         ret AS (
           SELECT date_trunc('${unit}', (r.created_at AT TIME ZONE 'Asia/Kolkata')::date)::date AS p, sum(r.total_paise) AS returns
           FROM returns r JOIN invoices i ON i.id = r.invoice_id
           WHERE i.status = 'FINALIZED' AND r.created_at >= $3 AND r.created_at < $4 AND ($5::uuid IS NULL OR i.salesperson_id = $5)
           GROUP BY 1),
         pay AS (
           SELECT date_trunc('${unit}', (p.created_at AT TIME ZONE 'Asia/Kolkata')::date)::date AS p,
                  sum(amount_paise) FILTER (WHERE direction = 'IN' AND method = 'CASH') AS cash,
                  sum(amount_paise) FILTER (WHERE direction = 'IN' AND method = 'UPI') AS upi,
                  sum(amount_paise) FILTER (WHERE direction = 'IN' AND method = 'CARD') AS card,
                  sum(amount_paise) FILTER (WHERE direction = 'IN' AND method = 'OTHER') AS other,
                  sum(amount_paise) FILTER (WHERE direction = 'OUT') AS refunds
           FROM payments p WHERE p.created_at >= $3 AND p.created_at < $4 AND ($5::uuid IS NULL OR p.received_by_id = $5)
           GROUP BY 1)
         SELECT to_char(pe.p, 'YYYY-MM-DD') AS period, COALESCE(inv.bills, 0) AS bills, COALESCE(inv.gross, 0) AS gross,
                COALESCE(inv.discount, 0) AS discount, COALESCE(inv.total, 0) AS invoiced, COALESCE(ret.returns, 0) AS returns,
                COALESCE(inv.total, 0) - COALESCE(ret.returns, 0) AS net_sales,
                COALESCE(pay.cash, 0) AS cash, COALESCE(pay.upi, 0) AS upi, COALESCE(pay.card, 0) AS card,
                COALESCE(pay.other, 0) AS other, COALESCE(pay.refunds, 0) AS refunds
         FROM periods pe LEFT JOIN inv ON inv.p = pe.p LEFT JOIN ret ON ret.p = pe.p LEFT JOIN pay ON pay.p = pe.p
         ORDER BY pe.p`,
        [r.from, r.to, r.start, r.end, sp],
      );
      return numify(rows, ['bills', 'gross', 'discount', 'invoiced', 'returns', 'net_sales', 'cash', 'upi', 'card', 'other', 'refunds']);
    };
    const periodCols = (label: string): ReportColumn[] => [
      date('period', label),
      num('bills', 'Bills'),
      money('gross', 'Gross'),
      money('discount', 'Discounts'),
      money('invoiced', 'Invoiced'),
      money('returns', 'Returns'),
      money('net_sales', 'Net sales'),
      money('cash', 'Cash recd'),
      money('upi', 'UPI recd'),
      money('card', 'Card recd'),
      money('other', 'Other recd'),
      money('refunds', 'Refunds paid'),
    ];
    const periodTotals = ['bills', 'gross', 'discount', 'invoiced', 'returns', 'net_sales', 'cash', 'upi', 'card', 'other', 'refunds'];

    const productSales = async (f: ReportFilters, groupBy: 'product' | 'category') => {
      const r = resolveRange(f.from, f.to, 1100);
      const key = groupBy === 'product' ? 'ii.product_id' : 'p.category_id';
      const rows = await q(
        `SELECT ${groupBy === 'product' ? `max(ii.sku) AS sku, max(ii.product_name) AS name,` : ''} max(c.name::text) AS category,
                sum(ii.quantity) AS qty_sold, sum(ii.returned_quantity) AS qty_returned,
                sum(ii.gross_paise) AS gross, sum(ii.line_discount_paise + ii.bill_discount_alloc_paise) AS discount,
                sum(ii.line_total_paise - ii.tax_alloc_paise) AS revenue_ex_tax,
                COALESCE(sum(rv.amount - rv.tax), 0) AS returned_ex_tax,
                sum(ii.unit_cost_paise * ii.quantity) - COALESCE(sum(rv.cost), 0) AS cost
         FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
         JOIN products p ON p.id = ii.product_id JOIN product_categories c ON c.id = p.category_id
         LEFT JOIN LATERAL (SELECT sum(amount_paise) AS amount, sum(tax_paise) AS tax, sum(cost_paise) AS cost
                            FROM return_items ri WHERE ri.invoice_item_id = ii.id) rv ON true
         WHERE i.status = 'FINALIZED' AND i.created_at >= $1 AND i.created_at < $2
           AND ($3::uuid IS NULL OR p.category_id = $3) AND ($4::uuid IS NULL OR ii.product_id = $4)
         GROUP BY ${key} ORDER BY revenue_ex_tax DESC`,
        [r.start, r.end, f.categoryId ?? null, f.productId ?? null],
      );
      return numify(rows, ['qty_sold', 'qty_returned', 'gross', 'discount', 'revenue_ex_tax', 'returned_ex_tax', 'cost']).map((x) => {
        const net = (x.revenue_ex_tax as number) - (x.returned_ex_tax as number);
        return { ...x, net_qty: (x.qty_sold as number) - (x.qty_returned as number), net_revenue: net, profit: net - (x.cost as number) };
      });
    };
    const productCols: ReportColumn[] = [
      num('qty_sold', 'Qty sold'),
      num('qty_returned', 'Qty returned'),
      num('net_qty', 'Net qty'),
      money('gross', 'Gross'),
      money('discount', 'Discount'),
      money('net_revenue', 'Net revenue (ex tax)'),
      money('cost', 'Cost'),
      money('profit', 'Est. gross profit'),
    ];

    this.defs = {
      'daily-sales': {
        title: 'Daily sales',
        permission: Permission.REPORTS_FINANCIAL,
        columns: periodCols('Date'),
        totals: periodTotals,
        run: (f) => salesByPeriod(f, 'day'),
      },
      'weekly-sales': {
        title: 'Weekly sales (weeks start Monday)',
        permission: Permission.REPORTS_FINANCIAL,
        columns: periodCols('Week of'),
        totals: periodTotals,
        run: (f) => salesByPeriod(f, 'week'),
      },
      'seasonal-sales': {
        title: 'Season comparison',
        permission: Permission.REPORTS_FINANCIAL,
        columns: [
          text('season', 'Season'),
          date('starts_on', 'From'),
          date('ends_on', 'To'),
          num('bills', 'Bills'),
          money('net_sales', 'Net sales'),
          money('discount', 'Discounts'),
          money('avg_bill', 'Avg bill'),
          num('units', 'Units sold'),
          text('top_product', 'Best seller'),
        ],
        run: async (f) => {
          const ids = f.seasonIds ? f.seasonIds.split(',').filter(Boolean) : null;
          const rows = await q(
            `SELECT s.name AS season, to_char(s.starts_on, 'YYYY-MM-DD') AS starts_on, to_char(s.ends_on, 'YYYY-MM-DD') AS ends_on,
                    (SELECT count(*) FROM invoices i WHERE i.season_id = s.id AND i.status = 'FINALIZED') AS bills,
                    (SELECT COALESCE(sum(i.total_paise - i.returned_amount_paise), 0) FROM invoices i WHERE i.season_id = s.id AND i.status = 'FINALIZED') AS net_sales,
                    (SELECT COALESCE(sum(i.discount_total_paise), 0) FROM invoices i WHERE i.season_id = s.id AND i.status = 'FINALIZED') AS discount,
                    (SELECT COALESCE(sum(ii.quantity - ii.returned_quantity), 0) FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
                       WHERE i.season_id = s.id AND i.status = 'FINALIZED') AS units,
                    (SELECT ii.product_name FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
                       WHERE i.season_id = s.id AND i.status = 'FINALIZED' GROUP BY ii.product_name
                       ORDER BY sum(ii.quantity - ii.returned_quantity) DESC LIMIT 1) AS top_product
             FROM seasons s WHERE ($1::uuid[] IS NULL OR s.id = ANY($1::uuid[])) ORDER BY s.starts_on DESC`,
            [ids],
          );
          return numify(rows, ['bills', 'net_sales', 'discount', 'units']).map((x) => ({
            ...x,
            avg_bill: x.bills ? Math.round((x.net_sales as number) / (x.bills as number)) : 0,
          }));
        },
      },
      'product-sales': {
        title: 'Product-wise sales',
        permission: Permission.REPORTS_FINANCIAL,
        columns: [text('sku', 'SKU'), text('name', 'Product'), text('category', 'Category'), ...productCols],
        totals: ['qty_sold', 'qty_returned', 'net_qty', 'gross', 'discount', 'net_revenue', 'cost', 'profit'],
        run: (f) => productSales(f, 'product'),
      },
      'category-sales': {
        title: 'Category-wise sales',
        permission: Permission.REPORTS_FINANCIAL,
        columns: [text('category', 'Category'), ...productCols],
        totals: ['qty_sold', 'qty_returned', 'net_qty', 'gross', 'discount', 'net_revenue', 'cost', 'profit'],
        run: (f) => productSales(f, 'category'),
      },
      'salesperson-sales': {
        title: 'Salesperson-wise sales',
        permission: Permission.REPORTS_FINANCIAL,
        columns: [
          text('name', 'Salesperson'),
          text('username', 'Username'),
          num('bills', 'Bills'),
          money('net_sales', 'Net sales'),
          money('discount', 'Discounts'),
          money('collected', 'Collected'),
          money('outstanding', 'Outstanding (their bills)'),
          num('voids', 'Voids'),
          money('avg_bill', 'Avg bill'),
        ],
        totals: ['bills', 'net_sales', 'discount', 'collected', 'outstanding', 'voids'],
        run: async (f) => {
          const r = resolveRange(f.from, f.to, 1100);
          const rows = await q(
            `SELECT u.full_name AS name, u.username::text AS username,
               (SELECT count(*) FROM invoices i WHERE i.salesperson_id = u.id AND i.status = 'FINALIZED' AND i.created_at >= $1 AND i.created_at < $2) AS bills,
               (SELECT COALESCE(sum(i.total_paise - i.returned_amount_paise), 0) FROM invoices i WHERE i.salesperson_id = u.id AND i.status = 'FINALIZED' AND i.created_at >= $1 AND i.created_at < $2) AS net_sales,
               (SELECT COALESCE(sum(i.discount_total_paise), 0) FROM invoices i WHERE i.salesperson_id = u.id AND i.status = 'FINALIZED' AND i.created_at >= $1 AND i.created_at < $2) AS discount,
               (SELECT COALESCE(sum(p.amount_paise), 0) FROM payments p WHERE p.received_by_id = u.id AND p.direction = 'IN' AND p.created_at >= $1 AND p.created_at < $2) AS collected,
               (SELECT COALESCE(sum(i.outstanding_paise), 0) FROM invoices i WHERE i.salesperson_id = u.id AND i.status = 'FINALIZED' AND i.created_at >= $1 AND i.created_at < $2) AS outstanding,
               (SELECT count(*) FROM invoices i WHERE i.salesperson_id = u.id AND i.status = 'VOID' AND i.created_at >= $1 AND i.created_at < $2) AS voids
             FROM users u WHERE ($3::uuid IS NULL OR u.id = $3)
               AND (u.role = 'SALESPERSON' OR EXISTS (SELECT 1 FROM invoices i WHERE i.salesperson_id = u.id))
             ORDER BY net_sales DESC`,
            [r.start, r.end, f.salespersonId ?? null],
          );
          return numify(rows, ['bills', 'net_sales', 'discount', 'collected', 'outstanding', 'voids']).map((x) => ({
            ...x,
            avg_bill: x.bills ? Math.round((x.net_sales as number) / (x.bills as number)) : 0,
          }));
        },
      },
      payments: {
        title: 'Payment collections',
        permission: Permission.REPORTS_FINANCIAL,
        columns: [
          dt('created_at', 'Date & time'),
          text('invoice_number', 'Bill'),
          text('customer', 'Customer'),
          text('direction', 'Type'),
          text('method', 'Method'),
          money('amount', 'Amount'),
          text('received_by', 'Received by'),
          text('reference', 'Reference'),
        ],
        totals: ['amount'],
        run: async (f) => {
          const r = resolveRange(f.from, f.to, 1100);
          const rows = await q(
            `SELECT p.created_at, i.invoice_number, i.customer_name AS customer,
                    CASE WHEN p.direction = 'IN' THEN 'Payment' ELSE 'Refund' END AS direction, p.method,
                    CASE WHEN p.direction = 'IN' THEN p.amount_paise ELSE -p.amount_paise END AS amount,
                    u.full_name AS received_by, p.reference
             FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN users u ON u.id = p.received_by_id
             WHERE p.created_at >= $1 AND p.created_at < $2 AND ($3::text IS NULL OR p.method = $3)
               AND ($4::uuid IS NULL OR p.received_by_id = $4)
             ORDER BY p.created_at`,
            [r.start, r.end, f.method ?? null, f.salespersonId ?? null],
          );
          return numify(rows, ['amount']).map((x) => ({ ...x, created_at: new Date(x.created_at as string).toISOString() }));
        },
      },
      outstanding: {
        title: 'Pending customer payments',
        permission: Permission.REPORTS_FINANCIAL,
        columns: [
          text('invoice_number', 'Bill'),
          dt('created_at', 'Billed on'),
          text('customer', 'Customer'),
          text('phone', 'Mobile'),
          text('salesperson', 'Salesperson'),
          money('total', 'Bill total'),
          money('paid', 'Paid'),
          money('outstanding', 'Outstanding'),
          num('age_days', 'Age (days)'),
          text('bucket', 'Ageing'),
        ],
        totals: ['total', 'paid', 'outstanding'],
        run: async (f) => {
          const rows = await q(
            `SELECT i.invoice_number, i.created_at, i.customer_name AS customer, i.customer_phone AS phone, u.full_name AS salesperson,
                    i.total_paise - i.returned_amount_paise AS total, i.amount_paid_paise - i.amount_refunded_paise AS paid, i.outstanding_paise AS outstanding,
                    (now() AT TIME ZONE 'Asia/Kolkata')::date - (i.created_at AT TIME ZONE 'Asia/Kolkata')::date AS age_days
             FROM invoices i JOIN users u ON u.id = i.salesperson_id
             WHERE i.status = 'FINALIZED' AND i.outstanding_paise > 0 AND ($1::uuid IS NULL OR i.salesperson_id = $1)
             ORDER BY i.created_at`,
            [f.salespersonId ?? null],
          );
          return numify(rows, ['total', 'paid', 'outstanding', 'age_days']).map((x) => ({
            ...x,
            created_at: new Date(x.created_at as string).toISOString(),
            bucket: (x.age_days as number) <= 7 ? '0–7 days' : (x.age_days as number) <= 30 ? '8–30 days' : '30+ days',
          }));
        },
      },
      discounts: {
        title: 'Discounts given',
        permission: Permission.REPORTS_FINANCIAL,
        columns: [
          text('invoice_number', 'Bill'),
          dt('created_at', 'Date'),
          text('salesperson', 'Applied by'),
          money('gross', 'Gross'),
          money('line_discount', 'Item discounts'),
          money('bill_discount', 'Bill discount'),
          money('discount', 'Total discount'),
          { key: 'percent', label: 'Discount %', type: 'percent' },
          text('reason', 'Reason'),
          text('approved_by', 'Approved by'),
        ],
        totals: ['gross', 'line_discount', 'bill_discount', 'discount'],
        run: async (f) => {
          const r = resolveRange(f.from, f.to, 1100);
          const rows = await q(
            `SELECT i.invoice_number, i.created_at, u.full_name AS salesperson, i.gross_subtotal_paise AS gross,
                    i.line_discount_total_paise AS line_discount, i.bill_discount_paise AS bill_discount, i.discount_total_paise AS discount,
                    i.discount_reason AS reason, a.full_name AS approved_by
             FROM invoices i JOIN users u ON u.id = i.salesperson_id LEFT JOIN users a ON a.id = i.discount_approved_by_id
             WHERE i.status = 'FINALIZED' AND i.discount_total_paise > 0 AND i.created_at >= $1 AND i.created_at < $2
               AND ($3::uuid IS NULL OR i.salesperson_id = $3)
             ORDER BY i.created_at`,
            [r.start, r.end, f.salespersonId ?? null],
          );
          return numify(rows, ['gross', 'line_discount', 'bill_discount', 'discount']).map((x) => ({
            ...x,
            created_at: new Date(x.created_at as string).toISOString(),
            percent: x.gross ? Math.round(((x.discount as number) * 10000) / (x.gross as number)) / 100 : 0,
          }));
        },
      },
      'stock-movements': {
        title: 'Stock movement summary',
        permission: Permission.REPORTS_INVENTORY,
        columns: [
          text('sku', 'SKU'),
          text('name', 'Product'),
          text('category', 'Category'),
          num('opening', 'Opening'),
          num('received', 'Received'),
          num('sold', 'Sold'),
          num('returned', 'Returned / restored'),
          num('adjusted', 'Adjustments (net)'),
          num('closing', 'Closing'),
        ],
        totals: ['opening', 'received', 'sold', 'returned', 'adjusted', 'closing'],
        run: async (f) => {
          const r = resolveRange(f.from, f.to, 1100);
          const rows = await q(
            `SELECT p.sku::text AS sku, p.name, c.name::text AS category,
               COALESCE((SELECT m.new_quantity FROM stock_movements m WHERE m.product_id = p.id AND m.created_at < $1 ORDER BY m.seq DESC LIMIT 1), 0) AS opening,
               COALESCE((SELECT sum(quantity_change) FROM stock_movements m WHERE m.product_id = p.id AND m.created_at >= $1 AND m.created_at < $2
                         AND m.movement_type IN ('OPENING','PURCHASE_RECEIPT')), 0) AS received,
               COALESCE((SELECT -sum(quantity_change) FROM stock_movements m WHERE m.product_id = p.id AND m.created_at >= $1 AND m.created_at < $2
                         AND m.movement_type = 'SALE'), 0) AS sold,
               COALESCE((SELECT sum(quantity_change) FROM stock_movements m WHERE m.product_id = p.id AND m.created_at >= $1 AND m.created_at < $2
                         AND m.movement_type IN ('SALE_RETURN','VOID_RESTORE')), 0) AS returned,
               COALESCE((SELECT sum(quantity_change) FROM stock_movements m WHERE m.product_id = p.id AND m.created_at >= $1 AND m.created_at < $2
                         AND m.movement_type IN ('ADJUSTMENT_IN','ADJUSTMENT_OUT','DAMAGED','LOST','COUNT_CORRECTION','TRANSFER_IN','TRANSFER_OUT')), 0) AS adjusted,
               COALESCE((SELECT m.new_quantity FROM stock_movements m WHERE m.product_id = p.id AND m.created_at < $2 ORDER BY m.seq DESC LIMIT 1), 0) AS closing
             FROM products p JOIN product_categories c ON c.id = p.category_id
             WHERE p.kind = 'STANDARD' AND ($3::uuid IS NULL OR p.id = $3) AND ($4::uuid IS NULL OR p.category_id = $4)
             ORDER BY c.sort_order, p.name`,
            [r.start, r.end, f.productId ?? null, f.categoryId ?? null],
          );
          return numify(rows, ['opening', 'received', 'sold', 'returned', 'adjusted', 'closing']);
        },
      },
      'low-stock': {
        title: 'Low stock',
        permission: Permission.REPORTS_INVENTORY,
        columns: [text('sku', 'SKU'), text('name', 'Product'), text('category', 'Category'), num('quantity', 'In stock'), num('min_alert', 'Alert level'), num('shortfall', 'Shortfall')],
        run: async (f) =>
          numify(
            await q(
              `SELECT p.sku::text AS sku, p.name, c.name::text AS category, sb.quantity, p.min_stock_alert AS min_alert,
                      p.min_stock_alert - sb.quantity AS shortfall
               FROM products p JOIN stock_balances sb ON sb.product_id = p.id JOIN product_categories c ON c.id = p.category_id
               WHERE p.kind = 'STANDARD' AND p.is_active AND sb.quantity <= p.min_stock_alert AND ($1::uuid IS NULL OR p.category_id = $1)
               ORDER BY sb.quantity, p.name`,
              [f.categoryId ?? null],
            ),
            ['quantity', 'min_alert', 'shortfall'],
          ),
      },
      'inventory-valuation': {
        title: 'Inventory valuation',
        permission: Permission.CATALOG_VIEW_COST,
        columns: [
          text('sku', 'SKU'),
          text('name', 'Product'),
          text('category', 'Category'),
          num('quantity', 'Qty'),
          money('unit_cost', 'Unit cost'),
          money('cost_value', 'Cost value'),
          money('unit_price', 'Selling price'),
          money('retail_value', 'Retail value'),
        ],
        totals: ['quantity', 'cost_value', 'retail_value'],
        run: async (f) =>
          numify(
            await q(
              `SELECT p.sku::text AS sku, p.name, c.name::text AS category, sb.quantity, p.purchase_price_paise AS unit_cost,
                      sb.quantity * p.purchase_price_paise AS cost_value, p.selling_price_paise AS unit_price,
                      sb.quantity * p.selling_price_paise AS retail_value
               FROM products p JOIN stock_balances sb ON sb.product_id = p.id JOIN product_categories c ON c.id = p.category_id
               WHERE p.kind = 'STANDARD' AND p.is_active AND ($1::uuid IS NULL OR p.category_id = $1)
               ORDER BY c.sort_order, p.name`,
              [f.categoryId ?? null],
            ),
            ['quantity', 'unit_cost', 'cost_value', 'unit_price', 'retail_value'],
          ),
      },
      purchases: {
        title: 'Purchases',
        permission: Permission.REPORTS_INVENTORY,
        columns: [
          text('purchase_number', 'Purchase'),
          date('purchase_date', 'Date'),
          text('supplier', 'Supplier'),
          num('items', 'Lines'),
          num('units', 'Units'),
          money('total', 'Total'),
          money('paid', 'Paid'),
          money('balance', 'Balance'),
        ],
        totals: ['items', 'units', 'total', 'paid', 'balance'],
        run: async (f) => {
          const r = resolveRange(f.from, f.to, 1100);
          const rows = await q(
            `SELECT p.purchase_number, to_char(p.purchase_date, 'YYYY-MM-DD') AS purchase_date, s.name AS supplier,
                    (SELECT count(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS items,
                    (SELECT sum(quantity) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS units,
                    p.subtotal_paise AS total,
                    COALESCE((SELECT sum(amount_paise) FROM supplier_payments sp WHERE sp.purchase_id = p.id), 0) AS paid
             FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
             WHERE p.purchase_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR p.supplier_id = $3)
             ORDER BY p.purchase_date, p.purchase_number`,
            [r.from, r.to, f.supplierId ?? null],
          );
          return numify(rows, ['items', 'units', 'total', 'paid']).map((x) => ({ ...x, balance: (x.total as number) - (x.paid as number) }));
        },
      },
      profit: {
        title: 'Estimated gross profit (excludes expenses and taxes)',
        permission: Permission.REPORTS_FINANCIAL,
        columns: [
          date('day', 'Date'),
          money('revenue', 'Revenue (ex tax)'),
          money('returns', 'Returns (ex tax)'),
          money('net_revenue', 'Net revenue'),
          money('cost', 'Cost of goods'),
          money('profit', 'Gross profit'),
          { key: 'margin', label: 'Margin %', type: 'percent' },
        ],
        totals: ['revenue', 'returns', 'net_revenue', 'cost', 'profit'],
        run: async (f) => {
          const r = resolveRange(f.from, f.to, 400);
          const rows = await q(
            `WITH days AS (SELECT d::date AS day FROM generate_series($1::date, $2::date, interval '1 day') d),
             s AS (SELECT (i.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
                          sum(ii.line_total_paise - ii.tax_alloc_paise) AS revenue, sum(ii.unit_cost_paise * ii.quantity) AS cost
                   FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id JOIN products p ON p.id = ii.product_id
                   WHERE i.status = 'FINALIZED' AND i.created_at >= $3 AND i.created_at < $4 AND ($5::uuid IS NULL OR p.category_id = $5)
                   GROUP BY 1),
             rt AS (SELECT (r.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
                           sum(ri.amount_paise - ri.tax_paise) AS returns, sum(ri.cost_paise) AS cost
                    FROM return_items ri JOIN returns r ON r.id = ri.return_id JOIN invoices i ON i.id = r.invoice_id
                    JOIN products p ON p.id = ri.product_id
                    WHERE i.status = 'FINALIZED' AND r.created_at >= $3 AND r.created_at < $4 AND ($5::uuid IS NULL OR p.category_id = $5)
                    GROUP BY 1)
             SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(s.revenue, 0) AS revenue, COALESCE(rt.returns, 0) AS returns,
                    COALESCE(s.cost, 0) - COALESCE(rt.cost, 0) AS cost
             FROM days d LEFT JOIN s ON s.day = d.day LEFT JOIN rt ON rt.day = d.day ORDER BY d.day`,
            [r.from, r.to, r.start, r.end, f.categoryId ?? null],
          );
          return numify(rows, ['revenue', 'returns', 'cost']).map((x) => {
            const net = (x.revenue as number) - (x.returns as number);
            const profit = net - (x.cost as number);
            return { ...x, net_revenue: net, profit, margin: net ? Math.round((profit * 10000) / net) / 100 : 0 };
          });
        },
      },
      returns: {
        title: 'Returns and refunds',
        permission: Permission.REPORTS_FINANCIAL,
        columns: [
          dt('created_at', 'Date'),
          text('kind', 'Type'),
          text('number', 'Return / bill'),
          text('invoice_number', 'Bill'),
          num('units', 'Units'),
          money('amount', 'Return value'),
          money('refund', 'Refunded'),
          text('method', 'Refund method'),
          text('reason', 'Reason'),
          text('by', 'By'),
        ],
        totals: ['units', 'amount', 'refund'],
        run: async (f) => {
          const r = resolveRange(f.from, f.to, 1100);
          const rows = await q(
            `SELECT * FROM (
               SELECT r.created_at, 'Return' AS kind, r.return_number AS number, i.invoice_number,
                      (SELECT sum(quantity) FROM return_items ri WHERE ri.return_id = r.id) AS units, r.total_paise AS amount,
                      COALESCE((SELECT sum(amount_paise) FROM payments p WHERE p.return_id = r.id), 0) AS refund,
                      (SELECT string_agg(DISTINCT method, ', ') FROM payments p WHERE p.return_id = r.id) AS method,
                      r.reason, u.full_name AS by
               FROM returns r JOIN invoices i ON i.id = r.invoice_id JOIN users u ON u.id = r.created_by_id
               WHERE r.created_at >= $1 AND r.created_at < $2
               UNION ALL
               SELECT p.created_at, CASE WHEN i.status = 'VOID' THEN 'Void refund' ELSE 'Refund' END, i.invoice_number, i.invoice_number,
                      NULL, 0, p.amount_paise, p.method, COALESCE(p.note, i.void_reason), u.full_name
               FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN users u ON u.id = p.received_by_id
               WHERE p.direction = 'OUT' AND p.return_id IS NULL AND p.created_at >= $1 AND p.created_at < $2
             ) x ORDER BY created_at`,
            [r.start, r.end],
          );
          return numify(rows, ['units', 'amount', 'refund']).map((x) => ({ ...x, created_at: new Date(x.created_at as string).toISOString() }));
        },
      },
    };
  }

  async run(type: string, f: ReportFilters, actor: AuthContext): Promise<ReportResult> {
    const def = this.defs[type as ReportType];
    if (!def) throw Errors.notFound('Report');
    if (!actor.permissions.has(def.permission)) throw Errors.forbidden();
    const rows = await def.run(f);
    const totals = def.totals
      ? Object.fromEntries(def.totals.map((k) => [k, rows.reduce((s, r) => s + (Number(r[k]) || 0), 0)]))
      : undefined;
    return { type, title: def.title, filters: { ...f }, columns: def.columns, rows, totals };
  }

  private cell(col: ReportColumn, v: unknown): string | number {
    if (v === null || v === undefined) return '';
    if (col.type === 'money') return paiseToDecimalString(Number(v));
    if (col.type === 'datetime') {
      const d = new Date(String(v));
      return new Date(d.getTime() + 330 * 60_000).toISOString().replace('T', ' ').slice(0, 16);
    }
    return v as string | number;
  }

  toCsv(report: ReportResult): string {
    const header = report.columns.map((c) => (c.type === 'money' ? `${c.label} (₹)` : c.label));
    const body = report.rows.map((r) => report.columns.map((c) => this.cell(c, r[c.key])));
    const out: (string | number)[][] = [header, ...body];
    if (report.totals) out.push(report.columns.map((c, i) => (i === 0 ? 'TOTAL' : c.key in report.totals! ? this.cell(c, report.totals![c.key]) : '')));
    return '﻿' + stringify(out);
  }

  async toXlsx(report: ReportResult): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Kite Shop Platform';
    const ws = wb.addWorksheet(report.title.slice(0, 31));
    ws.addRow([report.title]).font = { bold: true, size: 14 };
    const f = report.filters as ReportFilters;
    ws.addRow([`Generated ${istDateString()}${f.from ? ` · ${f.from} to ${f.to ?? f.from}` : ''}`]);
    ws.addRow([]);
    const head = ws.addRow(report.columns.map((c) => (c.type === 'money' ? `${c.label} (₹)` : c.label)));
    head.font = { bold: true };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    const val = (c: ReportColumn, v: unknown) => {
      if (v === null || v === undefined) return null;
      if (c.type === 'money') return Number(v) / 100;
      if (c.type === 'datetime') return this.cell(c, v);
      return v as string | number;
    };
    for (const r of report.rows) ws.addRow(report.columns.map((c) => val(c, r[c.key])));
    if (report.totals) {
      const t = ws.addRow(report.columns.map((c, i) => (i === 0 ? 'TOTAL' : c.key in report.totals! ? val(c, report.totals![c.key]) : null)));
      t.font = { bold: true };
    }
    report.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = Math.max(12, Math.min(40, c.label.length + 4));
      if (c.type === 'money') col.numFmt = '#,##0.00';
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
