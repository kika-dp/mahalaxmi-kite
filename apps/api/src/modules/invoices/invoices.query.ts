import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  computeInvoiceBalance,
  Invoice,
  InvoiceSummary,
  normalizeIndianPhone,
  Payment,
  Permission,
  RepeatCartLine,
} from '@kite/shared';
import { AuthContext } from '../../common/decorators';
import { Errors } from '../../common/errors';
import { resolveRange } from '../../common/utils/dates';
import { offset, paged } from '../../common/utils/pagination';
import { AVAILABLE_SQL } from '../catalog/product-queries';
import { mapMovement, MOVEMENT_SELECT, MovementRow } from '../inventory/inventory.service';
import type { InvoicesQuery } from './dto';

const n = (v: unknown) => Number(v ?? 0);
const ref = (id: string | null, fullName: string | null, username: string | null) =>
  id ? { id, fullName: fullName ?? '', username: username ?? '' } : null;

export const SUMMARY_SELECT = `
  SELECT i.id, i.invoice_number, i.status, i.payment_status, i.salesperson_id, su.full_name AS sp_name, su.username::text AS sp_username,
         i.customer_id, i.customer_name, i.customer_phone, i.gross_subtotal_paise, i.discount_total_paise, i.total_paise,
         i.returned_amount_paise, i.amount_paid_paise, i.amount_refunded_paise, i.outstanding_paise, i.created_at,
         (SELECT count(*)::int FROM invoice_items ii WHERE ii.invoice_id = i.id) AS item_count,
         (SELECT array_agg(DISTINCT p.method) FROM payments p WHERE p.invoice_id = i.id AND p.direction = 'IN') AS methods
  FROM invoices i JOIN users su ON su.id = i.salesperson_id`;

export function mapSummary(r: Record<string, any>): InvoiceSummary {
  return {
    id: r.id,
    invoiceNumber: r.invoice_number,
    status: r.status,
    paymentStatus: r.payment_status,
    salesperson: ref(r.salesperson_id, r.sp_name, r.sp_username)!,
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    itemCount: r.item_count,
    grossSubtotalPaise: n(r.gross_subtotal_paise),
    discountTotalPaise: n(r.discount_total_paise),
    totalPaise: n(r.total_paise),
    returnedAmountPaise: n(r.returned_amount_paise),
    amountPaidPaise: n(r.amount_paid_paise),
    amountRefundedPaise: n(r.amount_refunded_paise),
    outstandingPaise: n(r.outstanding_paise),
    paymentMethods: Array.isArray(r.methods) ? r.methods : typeof r.methods === 'string' ? r.methods.replace(/[{}]/g, '').split(',').filter(Boolean) : [],
    createdAt: new Date(r.created_at).toISOString(),
  };
}

const SORTS: Record<string, string> = {
  newest: 'i.created_at DESC',
  oldest: 'i.created_at ASC',
  total_desc: 'i.total_paise DESC, i.created_at DESC',
  total_asc: 'i.total_paise ASC, i.created_at DESC',
  outstanding_desc: 'i.outstanding_paise DESC, i.created_at ASC',
};

/** Read side of invoices: lists and detail views with ownership scoping. */
@Injectable()
export class InvoicesQueryService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Salespeople only see their own invoices (specification.md §3). */
  ownScope(actor: AuthContext): string | null {
    return actor.permissions.has(Permission.INVOICES_READ_ALL) ? null : actor.userId;
  }

  buildFilter(q: Partial<InvoicesQuery>, actor: AuthContext) {
    const conds: string[] = [];
    const params: unknown[] = [];
    const p = (v: unknown) => (params.push(v), `$${params.length}`);
    const own = this.ownScope(actor);
    if (own) conds.push(`i.salesperson_id = ${p(own)}`);
    else if (q.mine) conds.push(`i.salesperson_id = ${p(actor.userId)}`);
    if (q.from || q.to) {
      const r = resolveRange(q.from, q.to);
      conds.push(`i.created_at >= ${p(r.start)} AND i.created_at < ${p(r.end)}`);
    }
    if (q.salespersonId) conds.push(`i.salesperson_id = ${p(q.salespersonId)}`);
    if (q.paymentStatus) conds.push(`i.payment_status = ${p(q.paymentStatus)}`);
    if (q.status) conds.push(`i.status = ${p(q.status)}`);
    if (q.paymentMethod) {
      conds.push(`EXISTS (SELECT 1 FROM payments px WHERE px.invoice_id = i.id AND px.direction = 'IN' AND px.method = ${p(q.paymentMethod)})`);
    }
    if (q.number) conds.push(`i.invoice_number ILIKE ${p(`%${q.number.trim()}%`)}`);
    if (q.customerPhone) {
      const phone = normalizeIndianPhone(q.customerPhone) ?? q.customerPhone.replace(/\D/g, '');
      conds.push(`i.customer_phone LIKE ${p(`%${phone}%`)}`);
    }
    if (q.customerId) conds.push(`i.customer_id = ${p(q.customerId)}`);
    if (q.minTotalPaise !== undefined) conds.push(`i.total_paise >= ${p(q.minTotalPaise)}`);
    if (q.maxTotalPaise !== undefined) conds.push(`i.total_paise <= ${p(q.maxTotalPaise)}`);
    if (q.hasOutstanding) conds.push(`i.status = 'FINALIZED' AND i.outstanding_paise > 0`);
    if (q.q) {
      const term = q.q.trim();
      conds.push(
        `(i.invoice_number ILIKE ${p(`%${term}%`)} OR i.customer_name ILIKE ${p(`%${term}%`)} OR i.customer_phone LIKE ${p(`%${term.replace(/\D/g, '') || term}%`)})`,
      );
    }
    return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
  }

  async list(q: InvoicesQuery, actor: AuthContext) {
    const { where, params } = this.buildFilter(q, actor);
    const [agg] = await this.ds.query(
      `SELECT count(*)::int AS total,
              COALESCE(sum(i.total_paise) FILTER (WHERE i.status = 'FINALIZED'), 0)::bigint AS total_paise,
              COALESCE(sum(i.amount_paid_paise - i.amount_refunded_paise) FILTER (WHERE i.status = 'FINALIZED'), 0)::bigint AS paid_paise,
              COALESCE(sum(i.outstanding_paise) FILTER (WHERE i.status = 'FINALIZED'), 0)::bigint AS outstanding_paise,
              COALESCE(sum(i.discount_total_paise) FILTER (WHERE i.status = 'FINALIZED'), 0)::bigint AS discount_paise
       FROM invoices i ${where}`,
      params,
    );
    const rows = await this.ds.query(
      `${SUMMARY_SELECT} ${where} ORDER BY ${SORTS[q.sort ?? 'newest']} LIMIT ${q.pageSize} OFFSET ${offset(q)}`,
      params,
    );
    const env = paged(rows.map(mapSummary), agg.total, q);
    return Object.assign(env, {
      meta: {
        ...env.meta,
        totals: {
          totalPaise: n(agg.total_paise),
          paidPaise: n(agg.paid_paise),
          outstandingPaise: n(agg.outstanding_paise),
          discountPaise: n(agg.discount_paise),
        },
      },
    });
  }

  /** Full detail. Throws 404 when a salesperson asks for someone else's invoice. */
  async get(id: string, actor: AuthContext | null, m: EntityManager = this.ds.manager): Promise<Invoice> {
    const [r] = await m.query(
      `SELECT i.*, su.full_name AS sp_name, su.username::text AS sp_username,
              da.full_name AS da_name, da.username::text AS da_username,
              dp.full_name AS dp_name, dp.username::text AS dp_username,
              vu.full_name AS vu_name, vu.username::text AS vu_username,
              (SELECT count(*)::int FROM invoice_items ii WHERE ii.invoice_id = i.id) AS item_count,
              (SELECT array_agg(DISTINCT p.method) FROM payments p WHERE p.invoice_id = i.id AND p.direction = 'IN') AS methods
       FROM invoices i JOIN users su ON su.id = i.salesperson_id
       LEFT JOIN users da ON da.id = i.discount_applied_by_id
       LEFT JOIN users dp ON dp.id = i.discount_approved_by_id
       LEFT JOIN users vu ON vu.id = i.voided_by_id
       WHERE i.id = $1`,
      [id],
    );
    if (!r) throw Errors.notFound('Invoice');
    const own = actor ? this.ownScope(actor) : null;
    if (own && r.salesperson_id !== own) throw Errors.notFound('Invoice');
    const viewCost = !actor || actor.permissions.has(Permission.CATALOG_VIEW_COST);
    const admin = !actor || actor.permissions.has(Permission.INVOICES_READ_ALL);

    const items = await m.query(`SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY line_no`, [id]);
    const comps = await m.query(
      `SELECT c.* FROM invoice_item_components c JOIN invoice_items ii ON ii.id = c.invoice_item_id WHERE ii.invoice_id = $1`,
      [id],
    );
    const payments = await this.payments(m, id);
    const returns = await m.query(
      `SELECT r.*, u.full_name, u.username::text AS username FROM returns r JOIN users u ON u.id = r.created_by_id
       WHERE r.invoice_id = $1 ORDER BY r.created_at`,
      [id],
    );
    const returnItems = returns.length
      ? await m.query(
          `SELECT ri.*, ii.product_name FROM return_items ri JOIN invoice_items ii ON ii.id = ri.invoice_item_id
           WHERE ri.return_id = ANY($1::uuid[])`,
          [returns.map((x: { id: string }) => x.id)],
        )
      : [];
    const bal = computeInvoiceBalance({
      totalPaise: n(r.total_paise),
      returnedAmountPaise: n(r.returned_amount_paise),
      amountPaidPaise: n(r.amount_paid_paise),
      amountRefundedPaise: n(r.amount_refunded_paise),
    });

    const invoice: Invoice = {
      ...mapSummary(r),
      seasonId: r.season_id,
      lineDiscountTotalPaise: n(r.line_discount_total_paise),
      billDiscountType: r.bill_discount_type,
      billDiscountValue: n(r.bill_discount_value),
      billDiscountPaise: n(r.bill_discount_paise),
      taxableAmountPaise: n(r.taxable_amount_paise),
      taxRateBps: r.tax_rate_bps,
      taxPaise: n(r.tax_paise),
      ...(viewCost ? { costTotalPaise: n(r.cost_total_paise) } : {}),
      creditDuePaise: r.status === 'VOID' ? 0 : bal.creditDuePaise,
      discountReason: r.discount_reason,
      discountAppliedBy: ref(r.discount_applied_by_id, r.da_name, r.da_username),
      discountApprovedBy: ref(r.discount_approved_by_id, r.dp_name, r.dp_username),
      notes: r.notes,
      voidedAt: r.voided_at ? new Date(r.voided_at).toISOString() : null,
      voidedBy: ref(r.voided_by_id, r.vu_name, r.vu_username),
      voidReason: r.void_reason,
      items: items.map((it: Record<string, any>) => ({
        id: it.id,
        lineNo: it.line_no,
        productId: it.product_id,
        productName: it.product_name,
        sku: it.sku,
        unitType: it.unit_type,
        kind: it.kind,
        quantity: it.quantity,
        unitPricePaise: n(it.unit_price_paise),
        ...(viewCost ? { unitCostPaise: n(it.unit_cost_paise) } : {}),
        grossPaise: n(it.gross_paise),
        lineDiscountType: it.line_discount_type,
        lineDiscountValue: n(it.line_discount_value),
        lineDiscountPaise: n(it.line_discount_paise),
        billDiscountAllocPaise: n(it.bill_discount_alloc_paise),
        taxAllocPaise: n(it.tax_alloc_paise),
        lineTotalPaise: n(it.line_total_paise),
        returnedQuantity: it.returned_quantity,
        note: it.note,
        components: comps
          .filter((c: { invoice_item_id: string }) => c.invoice_item_id === it.id)
          .map((c: Record<string, any>) => ({ productId: c.product_id, productName: c.product_name, quantityPerUnit: c.quantity_per_unit })),
      })),
      payments,
      returns: returns.map((rt: Record<string, any>) => ({
        id: rt.id,
        returnNumber: rt.return_number,
        reason: rt.reason,
        totalPaise: n(rt.total_paise),
        createdBy: ref(rt.created_by_id, rt.full_name, rt.username)!,
        createdAt: new Date(rt.created_at).toISOString(),
        items: returnItems
          .filter((ri: { return_id: string }) => ri.return_id === rt.id)
          .map((ri: Record<string, any>) => ({
            invoiceItemId: ri.invoice_item_id,
            productName: ri.product_name,
            quantity: ri.quantity,
            amountPaise: n(ri.amount_paise),
            restocked: ri.restocked,
          })),
      })),
    };

    if (admin) {
      const refIds = [id, ...returns.map((x: { id: string }) => x.id)];
      const mv: MovementRow[] = await m.query(`${MOVEMENT_SELECT} WHERE m.reference_id = ANY($1::uuid[]) ORDER BY m.seq`, [refIds]);
      invoice.stockMovements = mv.map((x) => mapMovement(x, viewCost));
      invoice.auditTrail = (
        await m.query(
          `SELECT id::text, actor_id, actor_username, action, entity_type, entity_id, before, after, metadata, ip, created_at
           FROM audit_logs WHERE entity_type = 'invoice' AND entity_id = $1 ORDER BY created_at, id`,
          [id],
        )
      ).map((a: Record<string, any>) => ({
        id: a.id,
        actorId: a.actor_id,
        actorUsername: a.actor_username,
        action: a.action,
        entityType: a.entity_type,
        entityId: a.entity_id,
        before: a.before,
        after: a.after,
        metadata: a.metadata,
        ip: a.ip,
        createdAt: new Date(a.created_at).toISOString(),
      }));
    }
    return invoice;
  }

  async payments(m: EntityManager, invoiceId: string): Promise<Payment[]> {
    const rows = await m.query(
      `SELECT p.*, u.full_name, u.username::text AS username FROM payments p JOIN users u ON u.id = p.received_by_id
       WHERE p.invoice_id = $1 ORDER BY p.created_at, p.direction`,
      [invoiceId],
    );
    return rows.map((p: Record<string, any>) => ({
      id: p.id,
      invoiceId: p.invoice_id,
      direction: p.direction,
      method: p.method,
      amountPaise: n(p.amount_paise),
      reference: p.reference,
      note: p.note,
      receivedBy: ref(p.received_by_id, p.full_name, p.username)!,
      createdAt: new Date(p.created_at).toISOString(),
    }));
  }

  /** Lines for "repeat bill": current price/stock, never old payments or discounts. */
  async repeat(id: string, actor: AuthContext): Promise<RepeatCartLine[]> {
    const inv = await this.get(id, actor);
    const ids = [...new Set(inv.items.map((i) => i.productId))];
    const rows: { id: string; name: string; sku: string; selling_price_paise: string; is_active: boolean; available: number }[] =
      await this.ds.query(
        `SELECT p.id, p.name, p.sku::text AS sku, p.selling_price_paise, p.is_active, (${AVAILABLE_SQL('p')})::int AS available
         FROM products p WHERE p.id = ANY($1::uuid[])`,
        [ids],
      );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return inv.items.map((i) => {
      const p = byId.get(i.productId)!;
      return {
        productId: i.productId,
        name: p.name,
        sku: p.sku,
        quantity: i.quantity,
        sellingPricePaise: n(p.selling_price_paise),
        availableQuantity: p.available,
        isActive: p.is_active,
      };
    });
  }
}
