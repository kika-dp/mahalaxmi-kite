import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  BillingError,
  BillResult,
  calculateBill,
  computeInvoiceBalance,
  DiscountType,
  ErrorCode,
  Invoice,
  InvoicePreview,
  InvoiceStatus,
  normalizeIndianPhone,
  PaymentDirection,
  PaymentMethod,
  PaymentStatus,
  Permission,
  ProductKind,
  returnLineValue,
  roleHas,
  StockMovementType,
  StockReferenceType,
  UnitType,
} from '@kite/shared';
import { AuthContext, RequestMeta } from '../../common/decorators';
import { AppException, Errors, pgCode, pgConstraint, PG_DEADLOCK, PG_SERIALIZATION, PG_UNIQUE_VIOLATION } from '../../common/errors';
import { ShopSettingsEntity, User } from '../../database/entities';
import { AuditService } from '../audit/audit.service';
import { SequenceService } from '../audit/sequence.service';
import { PasswordService } from '../auth/password.service';
import { StockChange, StockService } from '../inventory/stock.service';
import { SettingsService } from '../settings/settings.service';
import type { CreateInvoiceDto, PaymentInputDto, RecordPaymentsDto, ReturnDto } from './dto';
import { InvoicesQueryService } from './invoices.query';

interface LoadedProduct {
  id: string;
  name: string;
  sku: string;
  kind: ProductKind;
  unit_type: UnitType;
  is_active: boolean;
  selling_price_paise: number;
  purchase_price_paise: number;
  components: { productId: string; name: string; quantity: number; costPaise: number; isActive: boolean }[];
}

interface PricedBill {
  products: Map<string, LoadedProduct>;
  calc: BillResult;
  unitCosts: number[];
  settings: ShopSettingsEntity;
  maxDiscountBps: number | null;
  requiresApproval: boolean;
}

/** Deterministic JSON (sorted keys) for request hashing. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
}

export function requestHash(dto: CreateInvoiceDto): string {
  const { items, billDiscount, customer, payments, notes } = dto;
  return createHash('sha256').update(stableStringify({ items, billDiscount, customer, payments, notes })).digest('hex');
}

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly stock: StockService,
    private readonly sequences: SequenceService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly query: InvoicesQueryService,
  ) {}

  // ================================================================ pricing
  private async loadProducts(m: EntityManager, ids: string[]): Promise<Map<string, LoadedProduct>> {
    const rows: Omit<LoadedProduct, 'components'>[] = await m.query(
      `SELECT id, name, sku::text AS sku, kind, unit_type, is_active,
              selling_price_paise::bigint::float8 AS selling_price_paise, purchase_price_paise::bigint::float8 AS purchase_price_paise
       FROM products WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    const comps: { bundle_product_id: string; component_product_id: string; name: string; quantity: number; cost: number; is_active: boolean }[] =
      await m.query(
        `SELECT bi.bundle_product_id, bi.component_product_id, cp.name, bi.quantity,
                cp.purchase_price_paise::bigint::float8 AS cost, cp.is_active
         FROM product_bundle_items bi JOIN products cp ON cp.id = bi.component_product_id
         WHERE bi.bundle_product_id = ANY($1::uuid[])`,
        [ids],
      );
    const map = new Map<string, LoadedProduct>();
    for (const r of rows) {
      map.set(r.id, {
        ...r,
        selling_price_paise: Number(r.selling_price_paise),
        purchase_price_paise: Number(r.purchase_price_paise),
        components: comps
          .filter((c) => c.bundle_product_id === r.id)
          .map((c) => ({ productId: c.component_product_id, name: c.name, quantity: c.quantity, costPaise: Number(c.cost), isActive: c.is_active })),
      });
    }
    return map;
  }

  private assertAvailable(dto: { items: { productId: string }[] }, products: Map<string, LoadedProduct>): void {
    const bad = [...new Set(dto.items.map((i) => i.productId))]
      .map((id) => ({ id, p: products.get(id) }))
      .filter(({ p }) => !p || !p.is_active || (p.kind === 'BUNDLE' && (p.components.length === 0 || p.components.some((c) => !c.isActive))));
    if (bad.length) {
      throw Errors.rule(
        ErrorCode.PRODUCT_UNAVAILABLE,
        bad.length === 1 && bad[0].p ? `"${bad[0].p.name}" is no longer available` : 'Some products are no longer available',
        bad.map(({ id, p }) => ({ productId: id, name: p?.name ?? null })),
      );
    }
  }

  private async price(m: EntityManager, dto: CreateInvoiceDto, actor: AuthContext): Promise<PricedBill> {
    const settings = await this.settings.getEntity(m);
    const products = await this.loadProducts(m, [...new Set(dto.items.map((i) => i.productId))]);
    this.assertAvailable(dto, products);
    let calc: BillResult;
    try {
      calc = calculateBill({
        lines: dto.items.map((i) => ({
          unitPricePaise: products.get(i.productId)!.selling_price_paise,
          quantity: i.quantity,
          discount: i.discount ? { type: i.discount.type as DiscountType, value: i.discount.value } : null,
        })),
        billDiscount: dto.billDiscount ? { type: dto.billDiscount.type as DiscountType, value: dto.billDiscount.value } : null,
        taxRateBps: settings.taxEnabled ? settings.taxRateBps : 0,
      });
    } catch (err) {
      if (err instanceof BillingError) {
        if (err.code === 'DISCOUNT_EXCEEDS_AMOUNT') throw Errors.rule(ErrorCode.DISCOUNT_EXCEEDS_AMOUNT, err.message, err.details);
        throw Errors.validation(err.message, err.details);
      }
      throw err;
    }
    const unitCosts = dto.items.map((i) => {
      const p = products.get(i.productId)!;
      return p.kind === 'BUNDLE' ? p.components.reduce((s, c) => s + c.costPaise * c.quantity, 0) : p.purchase_price_paise;
    });
    let maxDiscountBps: number | null = null;
    if (!actor.permissions.has(Permission.DISCOUNTS_UNLIMITED)) {
      const user = await m.getRepository(User).findOneBy({ id: actor.userId });
      maxDiscountBps = user?.maxDiscountBps ?? settings.salespersonMaxDiscountBps;
    }
    const requiresApproval = maxDiscountBps !== null && calc.discountTotalPaise > 0 && calc.discountBpsOfGross > maxDiscountBps;
    return { products, calc, unitCosts, settings, maxDiscountBps, requiresApproval };
  }

  /** Expand lines (bundles → components) into net stock requirements per standard product. */
  private stockRequirements(dto: { items: { productId: string; quantity: number }[] }, products: Map<string, LoadedProduct>) {
    const req = new Map<string, number>();
    for (const i of dto.items) {
      const p = products.get(i.productId)!;
      if (p.kind === 'STANDARD') req.set(p.id, (req.get(p.id) ?? 0) + i.quantity);
      else for (const c of p.components) req.set(c.productId, (req.get(c.productId) ?? 0) + c.quantity * i.quantity);
    }
    return req;
  }

  // ================================================================ preview
  async preview(dto: CreateInvoiceDto, actor: AuthContext): Promise<InvoicePreview> {
    const priced = await this.price(this.ds.manager, dto, actor);
    const req = this.stockRequirements(dto, priced.products);
    const balances = await this.stock.balances(this.ds.manager, [...req.keys()]);
    const names = new Map<string, string>();
    for (const p of priced.products.values()) {
      names.set(p.id, p.name);
      for (const c of p.components) names.set(c.productId, c.name);
    }
    const stockIssues = [...req.entries()]
      .filter(([id, qty]) => (balances.get(id) ?? 0) < qty)
      .map(([id, qty]) => ({ productId: id, name: names.get(id) ?? id, requested: qty, available: balances.get(id) ?? 0 }));
    const avail = (p: LoadedProduct) =>
      p.kind === 'STANDARD'
        ? balances.get(p.id) ?? 0
        : Math.min(...p.components.map((c) => Math.floor((balances.get(c.productId) ?? 0) / c.quantity)));
    return {
      lines: dto.items.map((i, idx) => {
        const p = priced.products.get(i.productId)!;
        const l = priced.calc.lines[idx];
        return {
          productId: p.id,
          productName: p.name,
          sku: p.sku,
          quantity: i.quantity,
          unitPricePaise: p.selling_price_paise,
          grossPaise: l.grossPaise,
          lineDiscountPaise: l.lineDiscountPaise,
          lineTotalPaise: l.lineTotalPaise,
          availableQuantity: avail(p),
        };
      }),
      grossSubtotalPaise: priced.calc.grossSubtotalPaise,
      lineDiscountTotalPaise: priced.calc.lineDiscountTotalPaise,
      billDiscountPaise: priced.calc.billDiscountPaise,
      discountTotalPaise: priced.calc.discountTotalPaise,
      taxPaise: priced.calc.taxPaise,
      totalPaise: priced.calc.totalPaise,
      discountBpsOfGross: priced.calc.discountBpsOfGross,
      maxDiscountBps: priced.maxDiscountBps,
      requiresDiscountApproval: priced.requiresApproval,
      stockIssues,
    };
  }

  // ================================================================= create
  async create(dto: CreateInvoiceDto, actor: AuthContext, meta: RequestMeta): Promise<{ invoice: Invoice; replayed: boolean }> {
    const hash = requestHash(dto);
    const replay = await this.findReplay(dto.idempotencyKey, actor, hash);
    if (replay) return replay;

    // Verify manager credentials outside the transaction (Argon2 is slow; don't hold row locks).
    const approverId = dto.discountApproval ? await this.verifyApprover(dto.discountApproval, actor, meta) : null;

    for (let attempt = 1; ; attempt++) {
      try {
        const id = await this.ds.transaction('READ COMMITTED', (m) => this.createTx(m, dto, hash, approverId, actor, meta));
        return { invoice: await this.query.get(id, actor), replayed: false };
      } catch (err) {
        const code = pgCode(err);
        if (code === PG_UNIQUE_VIOLATION && (pgConstraint(err) ?? '').includes('idempotency')) {
          const winner = await this.findReplay(dto.idempotencyKey, actor, hash);
          if (winner) return winner;
        }
        if ((code === PG_DEADLOCK || code === PG_SERIALIZATION) && attempt < 3) {
          this.logger.warn({ attempt, code }, 'Retrying invoice transaction');
          continue;
        }
        throw err;
      }
    }
  }

  private async findReplay(key: string, actor: AuthContext, hash: string) {
    const [row] = await this.ds.query(`SELECT id, salesperson_id, request_hash FROM invoices WHERE idempotency_key = $1`, [key]);
    if (!row) return null;
    if (row.salesperson_id !== actor.userId || row.request_hash !== hash) {
      throw new AppException(
        ErrorCode.IDEMPOTENCY_KEY_CONFLICT,
        'This bill was already submitted with different contents. Start a new bill.',
        HttpStatus.CONFLICT,
      );
    }
    return { invoice: await this.query.get(row.id, actor), replayed: true };
  }

  private async verifyApprover(cred: { username: string; password: string }, actor: AuthContext, meta: RequestMeta): Promise<string> {
    const ident = cred.username.trim().toLowerCase();
    const approver = await this.ds
      .getRepository(User)
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.username = :ident OR u.email = :ident', { ident })
      .getOne();
    const ok = await this.passwords.verify(approver?.passwordHash, cred.password);
    if (!approver || !ok || !approver.isActive || !roleHas(approver.role, Permission.DISCOUNTS_APPROVE)) {
      this.audit.logAsync({
        actorId: actor.userId,
        actorUsername: actor.username,
        action: 'DISCOUNT_APPROVAL_FAILED',
        metadata: { approver: ident },
        ip: meta.ip,
      });
      throw new AppException(ErrorCode.DISCOUNT_APPROVAL_INVALID, 'Manager approval failed: check the admin username and password', HttpStatus.FORBIDDEN);
    }
    return approver.id;
  }

  private async createTx(
    m: EntityManager,
    dto: CreateInvoiceDto,
    hash: string,
    approverId: string | null,
    actor: AuthContext,
    meta: RequestMeta,
  ): Promise<string> {
    const priced = await this.price(m, dto, actor);
    const { calc, products, settings } = priced;

    // ---- discount authorization (spec §8.3)
    if (priced.requiresApproval && !approverId) {
      throw new AppException(
        ErrorCode.DISCOUNT_APPROVAL_REQUIRED,
        `Discount above ${(priced.maxDiscountBps ?? 0) / 100}% needs manager approval`,
        HttpStatus.FORBIDDEN,
        { maxDiscountBps: priced.maxDiscountBps, requestedBps: calc.discountBpsOfGross },
      );
    }
    if (priced.requiresApproval && !dto.billDiscount?.reason?.trim()) {
      throw Errors.validation('Enter a reason for the discount', [{ field: 'billDiscount.reason', message: 'Required for approved discounts' }]);
    }

    // ---- payments (spec §9)
    const payments = dto.payments ?? [];
    const paid = payments.reduce((s, p) => s + p.amountPaise, 0);
    if (paid > calc.totalPaise) {
      throw Errors.rule(ErrorCode.OVERPAYMENT, 'Payment is more than the bill total', { totalPaise: calc.totalPaise, paidPaise: paid });
    }
    const outstanding = calc.totalPaise - paid;

    // ---- customer
    const custIn = dto.customer ?? {};
    let phone: string | null = null;
    if (custIn.phone) {
      phone = normalizeIndianPhone(custIn.phone);
      if (!phone) throw Errors.validation('Enter a valid 10-digit mobile number', [{ field: 'customer.phone', message: 'Invalid mobile number' }]);
    }
    let customerId: string | null = null;
    let customerName = custIn.name?.trim() || null;
    if (custIn.customerId) {
      const [c] = await m.query(`SELECT id, name, phone FROM customers WHERE id = $1`, [custIn.customerId]);
      if (!c) throw Errors.validation('Customer not found');
      customerId = c.id;
      customerName = customerName ?? c.name;
      phone = phone ?? c.phone;
    } else if (phone) {
      const [c] = await m.query(
        `INSERT INTO customers (name, phone) VALUES ($1, $2)
         ON CONFLICT (phone) DO UPDATE SET updated_at = now()
         RETURNING id, name`,
        [customerName ?? `Customer ${phone.slice(-4)}`, phone],
      );
      customerId = c.id;
      customerName = customerName ?? c.name;
    }
    if (outstanding > 0) {
      if (!customerName) {
        throw Errors.rule(ErrorCode.CUSTOMER_REQUIRED_FOR_CREDIT, 'Enter the customer name for an unpaid or partly paid bill', [
          { field: 'customer.name', message: 'Required when payment is pending' },
        ]);
      }
      if (settings.requireCustomerPhoneForCredit && !phone) {
        throw Errors.rule(ErrorCode.CUSTOMER_REQUIRED_FOR_CREDIT, 'Enter the customer mobile number for an unpaid or partly paid bill', [
          { field: 'customer.phone', message: 'Required when payment is pending' },
        ]);
      }
    }

    // ---- number + stock. The number is allocated first so ledger rows carry it (the ledger is append-only).
    // Both roll back together if anything fails, so numbering stays gap-free.
    const invoiceId = randomUUID();
    const { series, seasonId } = await this.settings.invoiceSeries(m);
    const invoiceNumber = await this.sequences.next(m, settings.invoicePrefix, series);
    const changes: StockChange[] = [];
    for (const i of dto.items) {
      const p = products.get(i.productId)!;
      const parts = p.kind === 'STANDARD' ? [{ productId: p.id, qty: i.quantity }] : p.components.map((c) => ({ productId: c.productId, qty: c.quantity * i.quantity }));
      for (const part of parts) {
        changes.push({
          productId: part.productId,
          change: -part.qty,
          type: StockMovementType.SALE,
          referenceType: StockReferenceType.INVOICE,
          referenceId: invoiceId,
          referenceNumber: invoiceNumber,
          reason: p.kind === 'BUNDLE' ? `Sold as part of ${p.name}` : null,
        });
      }
    }
    await this.stock.apply(m, changes, actor.userId);

    const bal = computeInvoiceBalance({ totalPaise: calc.totalPaise, returnedAmountPaise: 0, amountPaidPaise: paid, amountRefundedPaise: 0 });
    const costTotal = dto.items.reduce((s, i, idx) => s + priced.unitCosts[idx] * i.quantity, 0);
    await m.query(
      `INSERT INTO invoices (id, invoice_number, idempotency_key, request_hash, season_id, status, payment_status, salesperson_id,
         customer_id, customer_name, customer_phone, gross_subtotal_paise, line_discount_total_paise, bill_discount_type,
         bill_discount_value, bill_discount_paise, discount_total_paise, taxable_amount_paise, tax_rate_bps, tax_paise, total_paise,
         cost_total_paise, amount_paid_paise, outstanding_paise, discount_reason, discount_applied_by_id, discount_approved_by_id, notes)
       VALUES ($1,$2,$3,$4,$5,'FINALIZED',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
      [
        invoiceId,
        invoiceNumber,
        dto.idempotencyKey,
        hash,
        seasonId,
        bal.paymentStatus,
        actor.userId,
        customerId,
        customerName,
        phone,
        calc.grossSubtotalPaise,
        calc.lineDiscountTotalPaise,
        calc.billDiscountType,
        calc.billDiscountValue,
        calc.billDiscountPaise,
        calc.discountTotalPaise,
        calc.taxableAmountPaise,
        calc.taxRateBps,
        calc.taxPaise,
        calc.totalPaise,
        costTotal,
        paid,
        bal.outstandingPaise,
        dto.billDiscount?.reason?.trim() || null,
        calc.discountTotalPaise > 0 ? actor.userId : null,
        priced.requiresApproval ? approverId : null,
        dto.notes?.trim() || null,
      ],
    );

    for (const [idx, i] of dto.items.entries()) {
      const p = products.get(i.productId)!;
      const l = calc.lines[idx];
      const [{ id: itemId }] = await m.query(
        `INSERT INTO invoice_items (invoice_id, line_no, product_id, product_name, sku, unit_type, kind, quantity, unit_price_paise,
           unit_cost_paise, gross_paise, line_discount_type, line_discount_value, line_discount_paise, bill_discount_alloc_paise,
           tax_alloc_paise, line_total_paise, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
        [
          invoiceId,
          idx + 1,
          p.id,
          p.name,
          p.sku,
          p.unit_type,
          p.kind,
          i.quantity,
          p.selling_price_paise,
          priced.unitCosts[idx],
          l.grossPaise,
          l.lineDiscountType,
          l.lineDiscountValue,
          l.lineDiscountPaise,
          l.billDiscountAllocPaise,
          l.taxAllocPaise,
          l.lineTotalPaise,
          i.note?.trim() || null,
        ],
      );
      for (const c of p.components) {
        await m.query(
          `INSERT INTO invoice_item_components (invoice_item_id, product_id, product_name, quantity_per_unit, unit_cost_paise)
           VALUES ($1,$2,$3,$4,$5)`,
          [itemId, c.productId, c.name, c.quantity, c.costPaise],
        );
      }
    }

    await this.insertPayments(m, invoiceId, payments, PaymentDirection.IN, actor.userId, dto.idempotencyKey, null);
    if (customerId) await m.query(`UPDATE customers SET last_purchase_at = now() WHERE id = $1`, [customerId]);

    await this.audit.log(
      {
        actorId: actor.userId,
        actorUsername: actor.username,
        action: 'INVOICE_CREATED',
        entityType: 'invoice',
        entityId: invoiceId,
        after: {
          invoiceNumber,
          totalPaise: calc.totalPaise,
          discountTotalPaise: calc.discountTotalPaise,
          paidPaise: paid,
          paymentStatus: bal.paymentStatus,
          lines: dto.items.length,
        },
        ip: meta.ip,
        requestId: meta.requestId,
      },
      m,
    );
    if (priced.requiresApproval) {
      await this.audit.log(
        {
          actorId: approverId,
          action: 'DISCOUNT_OVERRIDE',
          entityType: 'invoice',
          entityId: invoiceId,
          metadata: {
            requestedBy: actor.username,
            discountBps: calc.discountBpsOfGross,
            capBps: priced.maxDiscountBps,
            discountPaise: calc.discountTotalPaise,
            reason: dto.billDiscount?.reason,
          },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        m,
      );
    }
    return invoiceId;
  }

  private async insertPayments(
    m: EntityManager,
    invoiceId: string,
    payments: Pick<PaymentInputDto, 'method' | 'amountPaise' | 'reference' | 'note'>[],
    direction: PaymentDirection,
    userId: string,
    idempotencyKey: string | null,
    returnId: string | null,
  ): Promise<void> {
    for (const p of payments) {
      await m.query(
        `INSERT INTO payments (invoice_id, direction, method, amount_paise, reference, note, received_by_id, return_id, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [invoiceId, direction, p.method, p.amountPaise, p.reference?.trim() || null, p.note?.trim() || null, userId, returnId, idempotencyKey],
      );
    }
  }

  /** Recompute cached aggregates from the payment ledger (spec §9). Caller holds the invoice lock. */
  private async refreshBalances(m: EntityManager, invoiceId: string): Promise<void> {
    const [r] = await m.query(
      `SELECT i.status, i.total_paise, i.returned_amount_paise,
              COALESCE((SELECT sum(amount_paise) FROM payments WHERE invoice_id = i.id AND direction = 'IN'), 0) AS paid,
              COALESCE((SELECT sum(amount_paise) FROM payments WHERE invoice_id = i.id AND direction = 'OUT'), 0) AS refunded
       FROM invoices i WHERE i.id = $1`,
      [invoiceId],
    );
    const bal = computeInvoiceBalance({
      totalPaise: Number(r.total_paise),
      returnedAmountPaise: Number(r.returned_amount_paise),
      amountPaidPaise: Number(r.paid),
      amountRefundedPaise: Number(r.refunded),
    });
    const isVoid = r.status === InvoiceStatus.VOID;
    const status = isVoid ? (Number(r.refunded) > 0 ? PaymentStatus.REFUNDED : bal.paymentStatus) : bal.paymentStatus;
    await m.query(
      `UPDATE invoices SET amount_paid_paise = $2, amount_refunded_paise = $3, outstanding_paise = $4, payment_status = $5, updated_at = now()
       WHERE id = $1`,
      [invoiceId, Number(r.paid), Number(r.refunded), isVoid ? 0 : bal.outstandingPaise, status],
    );
  }

  /** Lock an invoice row and enforce visibility (404 for other salespeople's invoices). */
  private async lockInvoice(m: EntityManager, id: string, actor: AuthContext) {
    const [inv] = await m.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [id]);
    if (!inv) throw Errors.notFound('Invoice');
    const own = this.query.ownScope(actor);
    if (own && inv.salesperson_id !== own) throw Errors.notFound('Invoice');
    return inv as Record<string, any>;
  }

  private balanceOf(inv: Record<string, any>) {
    return computeInvoiceBalance({
      totalPaise: Number(inv.total_paise),
      returnedAmountPaise: Number(inv.returned_amount_paise),
      amountPaidPaise: Number(inv.amount_paid_paise),
      amountRefundedPaise: Number(inv.amount_refunded_paise),
    });
  }

  // =============================================================== payments
  /** Record payment(s) against an existing invoice. Never touches stock (spec rule 4). */
  async recordPayments(id: string, dto: RecordPaymentsDto, actor: AuthContext, meta: RequestMeta): Promise<{ invoice: Invoice; replayed: boolean }> {
    let replayed = false;
    await this.ds.transaction(async (m) => {
      const inv = await this.lockInvoice(m, id, actor);
      const [prior] = await m.query(`SELECT invoice_id FROM payments WHERE idempotency_key = $1 LIMIT 1`, [dto.idempotencyKey]);
      if (prior) {
        if (prior.invoice_id !== id) {
          throw new AppException(ErrorCode.IDEMPOTENCY_KEY_CONFLICT, 'This payment key was already used for another bill', HttpStatus.CONFLICT);
        }
        replayed = true;
        return;
      }
      if (inv.status !== InvoiceStatus.FINALIZED) throw Errors.invalidState('Cannot take payment on a void bill');
      const bal = this.balanceOf(inv);
      let payments: Pick<PaymentInputDto, 'method' | 'amountPaise' | 'reference' | 'note'>[];
      if (dto.markPaid) {
        if (!dto.method) throw Errors.validation('Choose a payment method');
        if (bal.outstandingPaise === 0) throw Errors.invalidState('This bill is already fully paid');
        payments = [{ method: dto.method, amountPaise: bal.outstandingPaise }];
      } else {
        if (!dto.payments?.length) throw Errors.validation('Enter at least one payment');
        payments = dto.payments;
      }
      const sum = payments.reduce((s, p) => s + p.amountPaise, 0);
      if (sum > bal.outstandingPaise) {
        throw Errors.rule(ErrorCode.OVERPAYMENT, `Only ${bal.outstandingPaise / 100} is outstanding on this bill`, {
          outstandingPaise: bal.outstandingPaise,
          paidPaise: sum,
        });
      }
      await this.insertPayments(m, id, payments, PaymentDirection.IN, actor.userId, dto.idempotencyKey, null);
      await this.refreshBalances(m, id);
      await this.audit.log(
        {
          actorId: actor.userId,
          actorUsername: actor.username,
          action: 'PAYMENT_RECORDED',
          entityType: 'invoice',
          entityId: id,
          metadata: { invoiceNumber: inv.invoice_number, payments, outstandingBefore: bal.outstandingPaise },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        m,
      );
    });
    return { invoice: await this.query.get(id, actor), replayed };
  }

  // ================================================================ returns
  async createReturn(id: string, dto: ReturnDto, actor: AuthContext, meta: RequestMeta): Promise<Invoice> {
    await this.ds.transaction(async (m) => {
      const inv = await this.lockInvoice(m, id, actor);
      if (inv.status !== InvoiceStatus.FINALIZED) throw Errors.invalidState('Cannot return items on a void bill');
      const ids = dto.items.map((i) => i.invoiceItemId);
      if (new Set(ids).size !== ids.length) throw Errors.validation('A bill line is listed twice');
      const items: Record<string, any>[] = await m.query(
        `SELECT ii.*, COALESCE((SELECT sum(ri.amount_paise) FROM return_items ri WHERE ri.invoice_item_id = ii.id), 0) AS returned_value,
                COALESCE((SELECT sum(ri.tax_paise) FROM return_items ri WHERE ri.invoice_item_id = ii.id), 0) AS returned_tax
         FROM invoice_items ii WHERE ii.invoice_id = $1 AND ii.id = ANY($2::uuid[])`,
        [id, ids],
      );
      if (items.length !== ids.length) throw Errors.validation('Some lines do not belong to this bill');
      const byId = new Map(items.map((x) => [x.id, x]));
      const comps: Record<string, any>[] = await m.query(`SELECT * FROM invoice_item_components WHERE invoice_item_id = ANY($1::uuid[])`, [ids]);

      const returnId = randomUUID();
      const returnNumber = await this.sequences.next(m, 'RET', this.sequences.currentYearSeries());
      const changes: StockChange[] = [];
      let total = 0;
      let tax = 0;
      let cost = 0;
      const lines: { item: Record<string, any>; qty: number; amount: number; tax: number; cost: number; restock: boolean }[] = [];
      for (const l of dto.items) {
        const it = byId.get(l.invoiceItemId)!;
        const remaining = it.quantity - it.returned_quantity;
        if (l.quantity > remaining) {
          throw Errors.rule(ErrorCode.RETURN_EXCEEDS_SOLD, `Only ${remaining} of "${it.product_name}" can be returned`, {
            invoiceItemId: it.id,
            remaining,
          });
        }
        const common = { soldQuantity: it.quantity, alreadyReturnedQuantity: it.returned_quantity, quantity: l.quantity };
        const amount = returnLineValue({ ...common, lineTotalPaise: Number(it.line_total_paise), alreadyReturnedValuePaise: Number(it.returned_value) });
        const lineTax = returnLineValue({ ...common, lineTotalPaise: Number(it.tax_alloc_paise), alreadyReturnedValuePaise: Number(it.returned_tax) });
        const lineCost = Number(it.unit_cost_paise) * l.quantity;
        total += amount;
        tax += lineTax;
        cost += lineCost;
        lines.push({ item: it, qty: l.quantity, amount, tax: lineTax, cost: lineCost, restock: l.restock });
        if (l.restock) {
          const parts =
            it.kind === 'STANDARD'
              ? [{ productId: it.product_id as string, qty: l.quantity }]
              : comps.filter((c) => c.invoice_item_id === it.id).map((c) => ({ productId: c.product_id as string, qty: c.quantity_per_unit * l.quantity }));
          for (const part of parts) {
            changes.push({
              productId: part.productId,
              change: part.qty,
              type: StockMovementType.SALE_RETURN,
              referenceType: StockReferenceType.RETURN,
              referenceId: returnId,
              referenceNumber: returnNumber,
              reason: `Return on ${inv.invoice_number}: ${dto.reason}`,
            });
          }
        }
      }

      await m.query(
        `INSERT INTO returns (id, return_number, invoice_id, reason, total_paise, tax_paise, cost_paise, created_by_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [returnId, returnNumber, id, dto.reason.trim(), total, tax, cost, actor.userId],
      );
      for (const l of lines) {
        await m.query(
          `INSERT INTO return_items (return_id, invoice_item_id, product_id, quantity, amount_paise, tax_paise, cost_paise, restocked)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [returnId, l.item.id, l.item.product_id, l.qty, l.amount, l.tax, l.cost, l.restock],
        );
        await m.query(`UPDATE invoice_items SET returned_quantity = returned_quantity + $2 WHERE id = $1`, [l.item.id, l.qty]);
      }
      await this.stock.apply(m, changes, actor.userId);
      await m.query(`UPDATE invoices SET returned_amount_paise = returned_amount_paise + $2 WHERE id = $1`, [id, total]);

      if (dto.refund) {
        const after = computeInvoiceBalance({
          totalPaise: Number(inv.total_paise),
          returnedAmountPaise: Number(inv.returned_amount_paise) + total,
          amountPaidPaise: Number(inv.amount_paid_paise),
          amountRefundedPaise: Number(inv.amount_refunded_paise),
        });
        if (dto.refund.amountPaise > after.creditDuePaise) {
          throw Errors.rule(ErrorCode.REFUND_EXCEEDS_CREDIT, `Refund cannot exceed ${after.creditDuePaise / 100}`, {
            creditDuePaise: after.creditDuePaise,
          });
        }
        await this.insertPayments(
          m,
          id,
          [{ method: dto.refund.method, amountPaise: dto.refund.amountPaise, note: `Refund for ${returnNumber}` }],
          PaymentDirection.OUT,
          actor.userId,
          null,
          returnId,
        );
      }
      await this.refreshBalances(m, id);
      await this.audit.log(
        {
          actorId: actor.userId,
          actorUsername: actor.username,
          action: 'RETURN_CREATED',
          entityType: 'invoice',
          entityId: id,
          metadata: { returnNumber, totalPaise: total, reason: dto.reason, items: dto.items, refund: dto.refund ?? null },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        m,
      );
    });
    return this.query.get(id, actor);
  }

  // ================================================================ refunds
  async refund(id: string, dto: { method: PaymentMethod; amountPaise: number; reason: string }, actor: AuthContext, meta: RequestMeta): Promise<Invoice> {
    await this.ds.transaction(async (m) => {
      const inv = await this.lockInvoice(m, id, actor);
      if (inv.status !== InvoiceStatus.FINALIZED) throw Errors.invalidState('Use void for cancelled bills');
      const bal = this.balanceOf(inv);
      if (dto.amountPaise > bal.netPaidPaise) {
        throw Errors.rule(ErrorCode.REFUND_EXCEEDS_CREDIT, `Refund cannot exceed the ${bal.netPaidPaise / 100} received`, {
          netPaidPaise: bal.netPaidPaise,
        });
      }
      await this.insertPayments(m, id, [{ method: dto.method, amountPaise: dto.amountPaise, note: dto.reason }], PaymentDirection.OUT, actor.userId, null, null);
      await this.refreshBalances(m, id);
      await this.audit.log(
        {
          actorId: actor.userId,
          actorUsername: actor.username,
          action: 'REFUND_RECORDED',
          entityType: 'invoice',
          entityId: id,
          metadata: dto,
          ip: meta.ip,
          requestId: meta.requestId,
        },
        m,
      );
    });
    return this.query.get(id, actor);
  }

  // =================================================================== void
  async voidInvoice(id: string, dto: { reason: string; refundMethod?: PaymentMethod }, actor: AuthContext, meta: RequestMeta): Promise<Invoice> {
    await this.ds.transaction(async (m) => {
      const inv = await this.lockInvoice(m, id, actor);
      if (inv.status === InvoiceStatus.VOID) throw Errors.invalidState('This bill is already void');
      const bal = this.balanceOf(inv);
      if (bal.netPaidPaise > 0 && !dto.refundMethod) {
        throw Errors.validation(`₹${bal.netPaidPaise / 100} was received on this bill. Choose how it is refunded.`, [
          { field: 'refundMethod', message: 'Required when money was received' },
        ]);
      }
      const items: Record<string, any>[] = await m.query(`SELECT * FROM invoice_items WHERE invoice_id = $1`, [id]);
      const comps: Record<string, any>[] = await m.query(
        `SELECT c.* FROM invoice_item_components c JOIN invoice_items ii ON ii.id = c.invoice_item_id WHERE ii.invoice_id = $1`,
        [id],
      );
      const changes: StockChange[] = [];
      for (const it of items) {
        const remaining = it.quantity - it.returned_quantity;
        if (remaining <= 0) continue;
        const parts =
          it.kind === 'STANDARD'
            ? [{ productId: it.product_id as string, qty: remaining }]
            : comps.filter((c) => c.invoice_item_id === it.id).map((c) => ({ productId: c.product_id as string, qty: c.quantity_per_unit * remaining }));
        for (const part of parts) {
          changes.push({
            productId: part.productId,
            change: part.qty,
            type: StockMovementType.VOID_RESTORE,
            referenceType: StockReferenceType.VOID,
            referenceId: id,
            referenceNumber: inv.invoice_number,
            reason: `Void: ${dto.reason}`,
          });
        }
      }
      await this.stock.apply(m, changes, actor.userId);
      if (bal.netPaidPaise > 0) {
        await this.insertPayments(
          m,
          id,
          [{ method: dto.refundMethod!, amountPaise: bal.netPaidPaise, note: `Refund on void: ${dto.reason}` }],
          PaymentDirection.OUT,
          actor.userId,
          null,
          null,
        );
      }
      await m.query(
        `UPDATE invoices SET status = 'VOID', voided_at = now(), voided_by_id = $2, void_reason = $3 WHERE id = $1`,
        [id, actor.userId, dto.reason.trim()],
      );
      await this.refreshBalances(m, id);
      await this.audit.log(
        {
          actorId: actor.userId,
          actorUsername: actor.username,
          action: 'INVOICE_VOIDED',
          entityType: 'invoice',
          entityId: id,
          before: { status: inv.status, paymentStatus: inv.payment_status, netPaidPaise: bal.netPaidPaise },
          metadata: { reason: dto.reason, refundMethod: dto.refundMethod ?? null, restoredLines: changes.length },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        m,
      );
    });
    return this.query.get(id, actor);
  }
}
