import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  computeInvoiceBalance,
  Customer,
  ErrorCode,
  formatIstDate,
  normalizeIndianPhone,
  PaymentMethod,
  Permission,
} from '@kite/shared';
import { AuthContext, RequestMeta } from '../../common/decorators';
import { AppException, Errors, pgCode, PG_UNIQUE_VIOLATION } from '../../common/errors';
import { resolveRange } from '../../common/utils/dates';
import { offset, paged } from '../../common/utils/pagination';
import { AuditService } from '../audit/audit.service';
import { StatementData } from '../documents/pdf.service';
import { InvoicesQueryService } from '../invoices/invoices.query';

@Injectable()
export class CustomersService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesQueryService,
  ) {}

  /** Aggregates are limited to the salesperson's own invoices for salespeople. */
  private select(actor: AuthContext, params: unknown[]): string {
    const own = this.invoices.ownScope(actor);
    let scope = '';
    if (own) {
      params.push(own);
      scope = `AND i.salesperson_id = $${params.length}`;
    }
    return `
      SELECT c.*,
        (SELECT count(*)::int FROM invoices i WHERE i.customer_id = c.id AND i.status = 'FINALIZED' ${scope}) AS invoice_count,
        (SELECT COALESCE(sum(i.total_paise - i.returned_amount_paise), 0)::bigint FROM invoices i
           WHERE i.customer_id = c.id AND i.status = 'FINALIZED' ${scope}) AS total_spent,
        (SELECT COALESCE(sum(i.outstanding_paise), 0)::bigint FROM invoices i
           WHERE i.customer_id = c.id AND i.status = 'FINALIZED' ${scope}) AS outstanding
      FROM customers c`;
  }

  private map(r: Record<string, any>): Customer {
    return {
      id: r.id,
      name: r.name,
      phone: r.phone,
      address: r.address,
      notes: r.notes,
      lastPurchaseAt: r.last_purchase_at ? new Date(r.last_purchase_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
      invoiceCount: r.invoice_count,
      totalSpentPaise: Number(r.total_spent),
      outstandingPaise: Number(r.outstanding),
    };
  }

  async list(q: { page: number; pageSize: number; q?: string; hasOutstanding?: boolean }, actor: AuthContext) {
    const params: unknown[] = [];
    const base = this.select(actor, params);
    const conds: string[] = [];
    if (q.q) {
      const digits = q.q.replace(/\D/g, '');
      params.push(`%${q.q.trim()}%`);
      const nameIdx = params.length;
      if (digits.length >= 3) {
        params.push(`%${digits}%`);
        conds.push(`(x.name ILIKE $${nameIdx} OR x.phone LIKE $${params.length})`);
      } else {
        conds.push(`x.name ILIKE $${nameIdx}`);
      }
    }
    if (q.hasOutstanding) conds.push('x.outstanding > 0');
    // Salespeople only see customers they have billed.
    if (this.invoices.ownScope(actor)) conds.push('x.invoice_count > 0');
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM (${base}) x ${where}`, params);
    const rows = await this.ds.query(
      `SELECT * FROM (${base}) x ${where} ORDER BY x.outstanding DESC, x.last_purchase_at DESC NULLS LAST, x.name
       LIMIT ${q.pageSize} OFFSET ${offset(q)}`,
      params,
    );
    return paged(rows.map((r: Record<string, any>) => this.map(r)), total, q);
  }

  async lookup(phone: string, actor: AuthContext): Promise<Customer | null> {
    const n = normalizeIndianPhone(phone);
    if (!n) throw Errors.validation('Enter a valid 10-digit mobile number');
    const params: unknown[] = [];
    const base = this.select(actor, params);
    params.push(n);
    const [r] = await this.ds.query(`${base} WHERE c.phone = $${params.length}`, params);
    return r ? this.map(r) : null;
  }

  async get(id: string, actor: AuthContext): Promise<Customer> {
    const params: unknown[] = [];
    const base = this.select(actor, params);
    params.push(id);
    const [r] = await this.ds.query(`${base} WHERE c.id = $${params.length}`, params);
    if (!r) throw Errors.notFound('Customer');
    const c = this.map(r);
    if (this.invoices.ownScope(actor) && c.invoiceCount === 0) throw Errors.notFound('Customer');
    return c;
  }

  async create(dto: { name: string; phone?: string | null; address?: string | null; notes?: string | null }, actor: AuthContext, meta: RequestMeta) {
    const phone = dto.phone ? normalizeIndianPhone(dto.phone) : null;
    if (dto.phone && !phone) throw Errors.validation('Enter a valid 10-digit mobile number', [{ field: 'phone', message: 'Invalid' }]);
    try {
      const [row] = await this.ds.query(
        `INSERT INTO customers (name, phone, address, notes) VALUES ($1, $2, $3, $4) RETURNING id`,
        [dto.name.trim(), phone, dto.address ?? null, dto.notes ?? null],
      );
      this.audit.logAsync({ actorId: actor.userId, actorUsername: actor.username, action: 'CUSTOMER_CREATED', entityType: 'customer', entityId: row.id, ip: meta.ip });
      return this.getUnscoped(row.id);
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION) throw Errors.duplicate('A customer with this mobile number already exists', [{ field: 'phone', message: 'Already exists' }]);
      throw err;
    }
  }

  private async getUnscoped(id: string): Promise<Customer> {
    const params: unknown[] = [id];
    const [r] = await this.ds.query(
      `SELECT c.*, 0 AS invoice_count, 0 AS total_spent, 0 AS outstanding FROM customers c WHERE c.id = $1`,
      params,
    );
    return this.map(r);
  }

  async update(
    id: string,
    dto: { name?: string; phone?: string | null; address?: string | null; notes?: string | null },
    actor: AuthContext,
    meta: RequestMeta,
  ) {
    const [existing] = await this.ds.query(`SELECT * FROM customers WHERE id = $1`, [id]);
    if (!existing) throw Errors.notFound('Customer');
    let phone = existing.phone;
    if (dto.phone !== undefined) {
      phone = dto.phone ? normalizeIndianPhone(dto.phone) : null;
      if (dto.phone && !phone) throw Errors.validation('Enter a valid 10-digit mobile number');
    }
    try {
      await this.ds.query(
        `UPDATE customers SET name = $2, phone = $3, address = $4, notes = $5, updated_at = now() WHERE id = $1`,
        [id, dto.name?.trim() ?? existing.name, phone, dto.address !== undefined ? dto.address : existing.address, dto.notes !== undefined ? dto.notes : existing.notes],
      );
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION) throw Errors.duplicate('A customer with this mobile number already exists');
      throw err;
    }
    this.audit.logAsync({
      actorId: actor.userId,
      actorUsername: actor.username,
      action: 'CUSTOMER_UPDATED',
      entityType: 'customer',
      entityId: id,
      before: { name: existing.name, phone: existing.phone },
      after: dto,
      ip: meta.ip,
    });
    return this.get(id, actor);
  }

  /**
   * Collect a payment from a customer, allocated oldest-first across their outstanding invoices
   * (optionally restricted to `invoiceIds`). One payment row per invoice; never touches stock.
   */
  async collect(
    id: string,
    dto: { amountPaise: number; method: PaymentMethod; invoiceIds?: string[]; reference?: string; note?: string; idempotencyKey: string },
    actor: AuthContext,
    meta: RequestMeta,
  ) {
    const own = this.invoices.ownScope(actor);
    const allocations = await this.ds.transaction(async (m) => {
      const [prior] = await m.query(`SELECT 1 FROM payments WHERE idempotency_key = $1 LIMIT 1`, [dto.idempotencyKey]);
      if (prior) return null; // replay
      const params: unknown[] = [id];
      let extra = '';
      if (own) {
        params.push(own);
        extra += ` AND salesperson_id = $${params.length}`;
      }
      if (dto.invoiceIds?.length) {
        params.push(dto.invoiceIds);
        extra += ` AND id = ANY($${params.length}::uuid[])`;
      }
      const invs: Record<string, any>[] = await m.query(
        `SELECT * FROM invoices WHERE customer_id = $1 AND status = 'FINALIZED' AND outstanding_paise > 0 ${extra}
         ORDER BY created_at, id FOR UPDATE`,
        params,
      );
      const totalDue = invs.reduce((s, i) => s + Number(i.outstanding_paise), 0);
      if (totalDue === 0) throw Errors.invalidState('This customer has no outstanding bills');
      if (dto.amountPaise > totalDue) {
        throw new AppException(ErrorCode.OVERPAYMENT, `Only ${totalDue / 100} is outstanding`, HttpStatus.UNPROCESSABLE_ENTITY, {
          outstandingPaise: totalDue,
        });
      }
      let left = dto.amountPaise;
      const out: { invoiceId: string; invoiceNumber: string; amountPaise: number }[] = [];
      for (const inv of invs) {
        if (left <= 0) break;
        const take = Math.min(left, Number(inv.outstanding_paise));
        left -= take;
        await m.query(
          `INSERT INTO payments (invoice_id, direction, method, amount_paise, reference, note, received_by_id, idempotency_key)
           VALUES ($1, 'IN', $2, $3, $4, $5, $6, $7)`,
          [inv.id, dto.method, take, dto.reference ?? null, dto.note ?? 'Customer payment', actor.userId, dto.idempotencyKey],
        );
        const paid = Number(inv.amount_paid_paise) + take;
        const bal = computeInvoiceBalance({
          totalPaise: Number(inv.total_paise),
          returnedAmountPaise: Number(inv.returned_amount_paise),
          amountPaidPaise: paid,
          amountRefundedPaise: Number(inv.amount_refunded_paise),
        });
        await m.query(
          `UPDATE invoices SET amount_paid_paise = $2, outstanding_paise = $3, payment_status = $4, updated_at = now() WHERE id = $1`,
          [inv.id, paid, bal.outstandingPaise, bal.paymentStatus],
        );
        await this.audit.log(
          {
            actorId: actor.userId,
            actorUsername: actor.username,
            action: 'PAYMENT_RECORDED',
            entityType: 'invoice',
            entityId: inv.id,
            metadata: { invoiceNumber: inv.invoice_number, amountPaise: take, method: dto.method, via: 'customer_collection' },
            ip: meta.ip,
            requestId: meta.requestId,
          },
          m,
        );
        out.push({ invoiceId: inv.id, invoiceNumber: inv.invoice_number, amountPaise: take });
      }
      return out;
    });
    return { customer: await this.get(id, actor), allocations: allocations ?? [], replayed: allocations === null };
  }

  async statement(id: string, from: string | undefined, to: string | undefined, actor: AuthContext): Promise<StatementData> {
    if (!actor.permissions.has(Permission.REPORTS_FINANCIAL)) throw Errors.forbidden();
    const [c] = await this.ds.query(`SELECT * FROM customers WHERE id = $1`, [id]);
    if (!c) throw Errors.notFound('Customer');
    const r = resolveRange(from ?? '2000-01-01', to);
    const [{ opening }] = await this.ds.query(
      `SELECT (COALESCE((SELECT sum(total_paise) FROM invoices WHERE customer_id = $1 AND status = 'FINALIZED' AND created_at < $2), 0)
             - COALESCE((SELECT sum(r.total_paise) FROM returns r JOIN invoices i ON i.id = r.invoice_id
                          WHERE i.customer_id = $1 AND i.status = 'FINALIZED' AND r.created_at < $2), 0)
             - COALESCE((SELECT sum(CASE WHEN p.direction = 'IN' THEN p.amount_paise ELSE -p.amount_paise END)
                          FROM payments p JOIN invoices i ON i.id = p.invoice_id
                          WHERE i.customer_id = $1 AND i.status = 'FINALIZED' AND p.created_at < $2), 0))::bigint AS opening`,
      [id, r.start],
    );
    const rows: { at: Date; description: string; debit: string; credit: string }[] = await this.ds.query(
      `SELECT * FROM (
         SELECT i.created_at AS at, 'Bill ' || i.invoice_number AS description, i.total_paise AS debit, 0 AS credit
         FROM invoices i WHERE i.customer_id = $1 AND i.status = 'FINALIZED' AND i.created_at >= $2 AND i.created_at < $3
         UNION ALL
         SELECT r.created_at, 'Return ' || r.return_number || ' (' || i.invoice_number || ')', 0, r.total_paise
         FROM returns r JOIN invoices i ON i.id = r.invoice_id
         WHERE i.customer_id = $1 AND i.status = 'FINALIZED' AND r.created_at >= $2 AND r.created_at < $3
         UNION ALL
         SELECT p.created_at,
                CASE WHEN p.direction = 'IN' THEN 'Payment (' || p.method || ') ' ELSE 'Refund (' || p.method || ') ' END || i.invoice_number,
                CASE WHEN p.direction = 'OUT' THEN p.amount_paise ELSE 0 END,
                CASE WHEN p.direction = 'IN' THEN p.amount_paise ELSE 0 END
         FROM payments p JOIN invoices i ON i.id = p.invoice_id
         WHERE i.customer_id = $1 AND i.status = 'FINALIZED' AND p.created_at >= $2 AND p.created_at < $3
       ) x ORDER BY at`,
      [id, r.start, r.end],
    );
    return {
      customer: { name: c.name, phone: c.phone, address: c.address },
      from: r.from,
      to: r.to,
      openingBalancePaise: Number(opening),
      entries: rows.map((x) => ({
        date: formatIstDate(new Date(x.at)),
        description: x.description,
        debitPaise: Number(x.debit),
        creditPaise: Number(x.credit),
      })),
    };
  }
}
