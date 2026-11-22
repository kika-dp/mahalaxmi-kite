import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  DashboardSummary,
  EmployeePerformance,
  PAYMENT_METHODS,
  PaymentMethodSummary,
  SalesTrendPoint,
  StockOverview,
  TopProduct,
} from '@kite/shared';
import { resolveRange, ResolvedRange } from '../../common/utils/dates';

const n = (v: unknown) => Number(v ?? 0);

/**
 * Accounting definitions (specification.md §15):
 *  - Sales = invoices (FINALIZED) created in range − return values recorded in range. Void invoices excluded.
 *  - Collections come only from the payment ledger (IN rows). Unpaid bills are never "collected".
 *  - Estimated gross profit = revenue ex-tax − snapshotted cost, net of returns. Excludes expenses & taxes.
 */
@Injectable()
export class DashboardService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  private async salesFor(r: { start: Date; end: Date }) {
    const [x] = await this.ds.query(
      `SELECT
         (SELECT COALESCE(sum(total_paise), 0) FROM invoices WHERE status = 'FINALIZED' AND created_at >= $1 AND created_at < $2) AS invoiced,
         (SELECT count(*) FROM invoices WHERE status = 'FINALIZED' AND created_at >= $1 AND created_at < $2) AS bills,
         (SELECT COALESCE(sum(discount_total_paise), 0) FROM invoices WHERE status = 'FINALIZED' AND created_at >= $1 AND created_at < $2) AS discount,
         (SELECT COALESCE(sum(r.total_paise), 0) FROM returns r JOIN invoices i ON i.id = r.invoice_id
            WHERE i.status = 'FINALIZED' AND r.created_at >= $1 AND r.created_at < $2) AS returns`,
      [r.start, r.end],
    );
    return { invoiced: n(x.invoiced), bills: n(x.bills), discount: n(x.discount), returns: n(x.returns) };
  }

  async summary(from?: string, to?: string): Promise<DashboardSummary> {
    const r = resolveRange(from, to);
    const sales = await this.salesFor(r);
    const [season] = await this.ds.query(
      `SELECT id, name, to_char(starts_on, 'YYYY-MM-DD') AS from, to_char(ends_on, 'YYYY-MM-DD') AS to FROM seasons WHERE is_active LIMIT 1`,
    );
    let seasonSales = 0;
    if (season) {
      const sr = resolveRange(season.from, season.to);
      const s = await this.salesFor(sr);
      seasonSales = s.invoiced - s.returns;
    }
    const pays: { method: string; direction: string; total: string }[] = await this.ds.query(
      `SELECT method, direction, COALESCE(sum(amount_paise), 0) AS total FROM payments
       WHERE created_at >= $1 AND created_at < $2 GROUP BY method, direction`,
      [r.start, r.end],
    );
    const inBy = (m: string) => n(pays.find((p) => p.method === m && p.direction === 'IN')?.total);
    const refunds = pays.filter((p) => p.direction === 'OUT').reduce((s, p) => s + n(p.total), 0);
    const [out] = await this.ds.query(
      `SELECT COALESCE(sum(outstanding_paise), 0) AS amount, count(*) FILTER (WHERE outstanding_paise > 0) AS invoices
       FROM invoices WHERE status = 'FINALIZED'`,
    );
    const [inv] = await this.ds.query(
      `SELECT count(*) AS products, COALESCE(sum(sb.quantity), 0) AS units,
              count(*) FILTER (WHERE sb.quantity <= p.min_stock_alert) AS low,
              count(*) FILTER (WHERE sb.quantity = 0) AS out,
              COALESCE(sum(sb.quantity * p.purchase_price_paise), 0) AS cost_value,
              COALESCE(sum(sb.quantity * p.selling_price_paise), 0) AS retail_value
       FROM products p JOIN stock_balances sb ON sb.product_id = p.id WHERE p.kind = 'STANDARD' AND p.is_active`,
    );
    const profit = await this.profit(r);
    const totalCollected = PAYMENT_METHODS.reduce((s, m) => s + inBy(m), 0);
    return {
      range: { from: r.from, to: r.to },
      salesPaise: sales.invoiced - sales.returns,
      grossInvoicedPaise: sales.invoiced,
      returnsPaise: sales.returns,
      seasonSalesPaise: seasonSales,
      season: season ? { id: season.id, name: season.name, from: season.from, to: season.to } : null,
      cashCollectedPaise: inBy('CASH'),
      upiCollectedPaise: inBy('UPI'),
      cardCollectedPaise: inBy('CARD'),
      otherCollectedPaise: inBy('OTHER'),
      totalCollectedPaise: totalCollected,
      refundsPaise: refunds,
      outstandingPaise: n(out.amount),
      outstandingInvoices: n(out.invoices),
      billsCount: sales.bills,
      productsInInventory: n(inv.products),
      unitsInInventory: n(inv.units),
      lowStockCount: n(inv.low),
      outOfStockCount: n(inv.out),
      inventoryCostValuePaise: n(inv.cost_value),
      inventoryRetailValuePaise: n(inv.retail_value),
      estimatedGrossProfitPaise: profit,
      averageBillValuePaise: sales.bills ? Math.round(sales.invoiced / sales.bills) : 0,
      discountGivenPaise: sales.discount,
    };
  }

  async profit(r: { start: Date; end: Date }): Promise<number> {
    const [x] = await this.ds.query(
      `SELECT
         (SELECT COALESCE(sum(ii.line_total_paise - ii.tax_alloc_paise - ii.unit_cost_paise * ii.quantity), 0)
            FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
            WHERE i.status = 'FINALIZED' AND i.created_at >= $1 AND i.created_at < $2) AS sold,
         (SELECT COALESCE(sum(r.total_paise - r.tax_paise - r.cost_paise), 0)
            FROM returns r JOIN invoices i ON i.id = r.invoice_id
            WHERE i.status = 'FINALIZED' AND r.created_at >= $1 AND r.created_at < $2) AS returned`,
      [r.start, r.end],
    );
    return n(x.sold) - n(x.returned);
  }

  async salesTrend(from?: string, to?: string): Promise<SalesTrendPoint[]> {
    const r: ResolvedRange = resolveRange(from, to, 400);
    const rows = await this.ds.query(
      `WITH days AS (SELECT d::date AS day FROM generate_series($1::date, $2::date, interval '1 day') d)
       SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
         COALESCE((SELECT sum(total_paise) FROM invoices i WHERE i.status = 'FINALIZED'
                    AND (i.created_at AT TIME ZONE 'Asia/Kolkata')::date = d.day), 0)
         - COALESCE((SELECT sum(rt.total_paise) FROM returns rt JOIN invoices i ON i.id = rt.invoice_id WHERE i.status = 'FINALIZED'
                    AND (rt.created_at AT TIME ZONE 'Asia/Kolkata')::date = d.day), 0) AS sales,
         COALESCE((SELECT sum(amount_paise) FROM payments p WHERE p.direction = 'IN'
                    AND (p.created_at AT TIME ZONE 'Asia/Kolkata')::date = d.day), 0) AS collected,
         (SELECT count(*) FROM invoices i WHERE i.status = 'FINALIZED'
                    AND (i.created_at AT TIME ZONE 'Asia/Kolkata')::date = d.day) AS bills
       FROM days d ORDER BY d.day`,
      [r.from, r.to],
    );
    return rows.map((x: Record<string, unknown>) => ({
      date: x.date as string,
      salesPaise: n(x.sales),
      collectedPaise: n(x.collected),
      bills: n(x.bills),
    }));
  }

  async paymentSummary(from?: string, to?: string): Promise<PaymentMethodSummary[]> {
    const r = resolveRange(from, to);
    const rows: { method: string; direction: string; total: string; cnt: string }[] = await this.ds.query(
      `SELECT method, direction, sum(amount_paise) AS total, count(*) AS cnt FROM payments
       WHERE created_at >= $1 AND created_at < $2 GROUP BY method, direction`,
      [r.start, r.end],
    );
    return PAYMENT_METHODS.map((m) => {
      const inn = rows.find((x) => x.method === m && x.direction === 'IN');
      const out = rows.find((x) => x.method === m && x.direction === 'OUT');
      return { method: m, inPaise: n(inn?.total), outPaise: n(out?.total), count: n(inn?.cnt) };
    });
  }

  async topProducts(from?: string, to?: string, limit = 10): Promise<TopProduct[]> {
    const r = resolveRange(from, to);
    const rows = await this.ds.query(
      `SELECT ii.product_id, max(ii.product_name) AS name, max(ii.sku) AS sku,
              sum(ii.quantity - ii.returned_quantity) AS qty,
              sum(ii.line_total_paise - COALESCE(rv.v, 0)) AS revenue
       FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
       LEFT JOIN LATERAL (SELECT sum(ri.amount_paise) AS v FROM return_items ri WHERE ri.invoice_item_id = ii.id) rv ON true
       WHERE i.status = 'FINALIZED' AND i.created_at >= $1 AND i.created_at < $2
       GROUP BY ii.product_id ORDER BY revenue DESC, qty DESC LIMIT $3`,
      [r.start, r.end, Math.min(Math.max(limit, 1), 50)],
    );
    return rows.map((x: Record<string, unknown>) => ({
      productId: x.product_id as string,
      name: x.name as string,
      sku: x.sku as string,
      quantity: n(x.qty),
      revenuePaise: n(x.revenue),
    }));
  }

  async employeePerformance(from?: string, to?: string): Promise<EmployeePerformance[]> {
    const r = resolveRange(from, to);
    const rows = await this.ds.query(
      `SELECT u.id, u.full_name, u.username::text AS username,
         (SELECT count(*) FROM invoices i WHERE i.salesperson_id = u.id AND i.status = 'FINALIZED' AND i.created_at >= $1 AND i.created_at < $2) AS bills,
         (SELECT COALESCE(sum(i.total_paise - i.returned_amount_paise), 0) FROM invoices i
            WHERE i.salesperson_id = u.id AND i.status = 'FINALIZED' AND i.created_at >= $1 AND i.created_at < $2) AS sales,
         (SELECT COALESCE(sum(p.amount_paise), 0) FROM payments p WHERE p.received_by_id = u.id AND p.direction = 'IN'
            AND p.created_at >= $1 AND p.created_at < $2) AS collected,
         (SELECT COALESCE(sum(i.discount_total_paise), 0) FROM invoices i
            WHERE i.salesperson_id = u.id AND i.status = 'FINALIZED' AND i.created_at >= $1 AND i.created_at < $2) AS discount,
         (SELECT count(*) FROM invoices i WHERE i.salesperson_id = u.id AND i.status = 'VOID' AND i.voided_at >= $1 AND i.voided_at < $2) AS voids
       FROM users u
       WHERE u.role = 'SALESPERSON' OR EXISTS (SELECT 1 FROM invoices i WHERE i.salesperson_id = u.id AND i.created_at >= $1 AND i.created_at < $2)
       ORDER BY sales DESC, u.full_name`,
      [r.start, r.end],
    );
    return rows.map((x: Record<string, unknown>) => ({
      userId: x.id as string,
      fullName: x.full_name as string,
      username: x.username as string,
      bills: n(x.bills),
      salesPaise: n(x.sales),
      collectedPaise: n(x.collected),
      discountPaise: n(x.discount),
      voids: n(x.voids),
    }));
  }

  async stockOverview(): Promise<StockOverview> {
    const [x] = await this.ds.query(
      `SELECT count(*) FILTER (WHERE sb.quantity > p.min_stock_alert) AS available,
              count(*) FILTER (WHERE sb.quantity <= p.min_stock_alert AND sb.quantity > 0) AS low,
              count(*) FILTER (WHERE sb.quantity = 0) AS out,
              COALESCE(sum(sb.quantity * p.purchase_price_paise), 0) AS cost_value,
              COALESCE(sum(sb.quantity * p.selling_price_paise), 0) AS retail_value
       FROM products p JOIN stock_balances sb ON sb.product_id = p.id WHERE p.kind = 'STANDARD' AND p.is_active`,
    );
    const low = await this.ds.query(
      `SELECT p.id, p.name, sb.quantity, p.min_stock_alert FROM products p JOIN stock_balances sb ON sb.product_id = p.id
       WHERE p.kind = 'STANDARD' AND p.is_active AND sb.quantity <= p.min_stock_alert
       ORDER BY sb.quantity::float / GREATEST(p.min_stock_alert, 1), p.name LIMIT 10`,
    );
    return {
      available: n(x.available),
      lowStock: n(x.low),
      outOfStock: n(x.out),
      costValuePaise: n(x.cost_value),
      retailValuePaise: n(x.retail_value),
      lowStockItems: low.map((l: Record<string, unknown>) => ({
        productId: l.id as string,
        name: l.name as string,
        quantity: n(l.quantity),
        minStockAlert: n(l.min_stock_alert),
      })),
    };
  }
}
