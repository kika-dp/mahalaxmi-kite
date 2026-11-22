import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  normalizeIndianPhone,
  PaymentMethod,
  Purchase,
  StockMovementType,
  StockReferenceType,
  Supplier as SupplierDto,
  SupplierPayment,
} from '@kite/shared';
import { AuthContext, RequestMeta } from '../../common/decorators';
import { Errors } from '../../common/errors';
import { resolveRange } from '../../common/utils/dates';
import { offset, paged } from '../../common/utils/pagination';
import { Product, PurchaseEntity, PurchaseItemEntity, Supplier, SupplierPaymentEntity } from '../../database/entities';
import { AuditService } from '../audit/audit.service';
import { SequenceService } from '../audit/sequence.service';
import { StockService } from '../inventory/stock.service';

const ref = (id: string, name: string, username: string) => ({ id, fullName: name, username });

@Injectable()
export class SuppliersService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly stock: StockService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
  ) {}

  private supplierSelect = `
    SELECT s.*,
      COALESCE((SELECT sum(subtotal_paise) FROM purchases p WHERE p.supplier_id = s.id), 0)::bigint AS purchased,
      COALESCE((SELECT sum(amount_paise) FROM supplier_payments sp WHERE sp.supplier_id = s.id), 0)::bigint AS paid
    FROM suppliers s`;

  private mapSupplier(r: Record<string, any>): SupplierDto {
    const purchased = Number(r.purchased);
    const paid = Number(r.paid);
    return {
      id: r.id,
      name: r.name,
      phone: r.phone,
      address: r.address,
      notes: r.notes,
      isActive: r.is_active,
      totalPurchasedPaise: purchased,
      totalPaidPaise: paid,
      balancePaise: purchased - paid,
      createdAt: r.created_at.toISOString(),
    };
  }

  async list(q: { page: number; pageSize: number; q?: string }) {
    const where = q.q ? `WHERE s.name ILIKE $1 OR s.phone LIKE $1` : '';
    const params = q.q ? [`%${q.q}%`] : [];
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM suppliers s ${where}`, params);
    const rows = await this.ds.query(`${this.supplierSelect} ${where} ORDER BY s.name LIMIT ${q.pageSize} OFFSET ${offset(q)}`, params);
    return paged(rows.map((r: Record<string, any>) => this.mapSupplier(r)), total, q);
  }

  async get(id: string) {
    const [r] = await this.ds.query(`${this.supplierSelect} WHERE s.id = $1`, [id]);
    if (!r) throw Errors.notFound('Supplier');
    const purchases = await this.listPurchases({ page: 1, pageSize: 100, supplierId: id });
    const payments = await this.payments(id);
    return { ...this.mapSupplier(r), purchases: purchases.data, payments };
  }

  private cleanPhone(phone: string | null | undefined): string | null {
    if (!phone) return null;
    const n = normalizeIndianPhone(phone);
    if (!n) throw Errors.validation('Invalid phone number', [{ field: 'phone', message: 'Enter a valid 10-digit mobile number' }]);
    return n;
  }

  async create(dto: { name: string; phone?: string | null; address?: string | null; notes?: string | null }, actor: AuthContext, meta: RequestMeta) {
    const saved = await this.ds.getRepository(Supplier).save({
      name: dto.name.trim(),
      phone: this.cleanPhone(dto.phone),
      address: dto.address ?? null,
      notes: dto.notes ?? null,
    });
    this.audit.logAsync({ actorId: actor.userId, actorUsername: actor.username, action: 'SUPPLIER_CREATED', entityType: 'supplier', entityId: saved.id, after: dto, ip: meta.ip });
    return this.get(saved.id);
  }

  async update(
    id: string,
    dto: { name?: string; phone?: string | null; address?: string | null; notes?: string | null; isActive?: boolean },
    actor: AuthContext,
    meta: RequestMeta,
  ) {
    const repo = this.ds.getRepository(Supplier);
    const s = await repo.findOneBy({ id });
    if (!s) throw Errors.notFound('Supplier');
    if (dto.name !== undefined) s.name = dto.name.trim();
    if (dto.phone !== undefined) s.phone = this.cleanPhone(dto.phone);
    if (dto.address !== undefined) s.address = dto.address;
    if (dto.notes !== undefined) s.notes = dto.notes;
    if (dto.isActive !== undefined) s.isActive = dto.isActive;
    await repo.save(s);
    this.audit.logAsync({ actorId: actor.userId, actorUsername: actor.username, action: 'SUPPLIER_UPDATED', entityType: 'supplier', entityId: id, after: dto, ip: meta.ip });
    return this.get(id);
  }

  // -------------------------------------------------------------- purchases
  async createPurchase(
    dto: {
      supplierId?: string | null;
      purchaseDate: string;
      items: { productId: string; quantity: number; unitCostPaise: number }[];
      amountPaidPaise?: number;
      paymentMethod?: PaymentMethod;
      notes?: string;
      updateCostPrice?: boolean;
    },
    actor: AuthContext,
    meta: RequestMeta,
  ): Promise<Purchase> {
    const ids = dto.items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length) throw Errors.validation('A product is listed twice');
    const subtotal = dto.items.reduce((s, i) => s + i.quantity * i.unitCostPaise, 0);
    const paid = dto.amountPaidPaise ?? 0;
    if (paid > subtotal) throw Errors.validation('Amount paid cannot exceed the purchase total');
    if (paid > 0 && !dto.supplierId) throw Errors.validation('Select a supplier to record a payment');

    const id = await this.ds.transaction(async (m) => {
      if (dto.supplierId) {
        const s = await m.getRepository(Supplier).findOneBy({ id: dto.supplierId });
        if (!s) throw Errors.validation('Supplier not found');
      }
      const products = await m.getRepository(Product).findBy(ids.map((id) => ({ id })));
      if (products.length !== ids.length) throw Errors.validation('Some products were not found');
      const bundle = products.find((p) => p.kind !== 'STANDARD');
      if (bundle) throw Errors.validation(`"${bundle.name}" is a bundle; purchase its components instead`);

      const purchaseNumber = await this.sequences.next(m, 'PUR', this.sequences.currentYearSeries());
      const purchase = await m.getRepository(PurchaseEntity).save({
        purchaseNumber,
        supplierId: dto.supplierId ?? null,
        purchaseDate: dto.purchaseDate,
        subtotalPaise: subtotal,
        amountPaidPaise: paid,
        notes: dto.notes ?? null,
        createdById: actor.userId,
      });
      await m.getRepository(PurchaseItemEntity).insert(
        dto.items.map((i) => ({
          purchaseId: purchase.id,
          productId: i.productId,
          quantity: i.quantity,
          unitCostPaise: i.unitCostPaise,
          lineTotalPaise: i.quantity * i.unitCostPaise,
        })),
      );
      await this.stock.apply(
        m,
        dto.items.map((i) => ({
          productId: i.productId,
          change: i.quantity,
          type: StockMovementType.PURCHASE_RECEIPT,
          referenceType: StockReferenceType.PURCHASE,
          referenceId: purchase.id,
          referenceNumber: purchaseNumber,
          reason: 'Purchase receipt',
          unitCostPaise: i.unitCostPaise,
        })),
        actor.userId,
      );
      if (dto.updateCostPrice !== false) {
        for (const i of dto.items) {
          await m.getRepository(Product).update(i.productId, { purchasePricePaise: i.unitCostPaise, updatedBy: actor.userId });
        }
      }
      if (paid > 0) {
        await m.getRepository(SupplierPaymentEntity).insert({
          supplierId: dto.supplierId!,
          purchaseId: purchase.id,
          amountPaise: paid,
          method: dto.paymentMethod ?? 'CASH',
          note: 'Paid at purchase',
          paidAt: new Date(),
          createdById: actor.userId,
        });
      }
      await this.audit.log(
        {
          actorId: actor.userId,
          actorUsername: actor.username,
          action: 'PURCHASE_CREATED',
          entityType: 'purchase',
          entityId: purchase.id,
          after: { purchaseNumber, ...dto },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        m,
      );
      return purchase.id;
    });
    return this.getPurchase(id);
  }

  private purchaseSelect = `
    SELECT p.id, p.purchase_number, p.supplier_id, s.name AS supplier_name, to_char(p.purchase_date, 'YYYY-MM-DD') AS purchase_date,
           p.subtotal_paise::bigint AS subtotal,
           COALESCE((SELECT sum(amount_paise) FROM supplier_payments sp WHERE sp.purchase_id = p.id), 0)::bigint AS paid,
           p.notes, p.created_by_id, u.full_name, u.username::text AS username, p.created_at,
           (SELECT count(*)::int FROM purchase_items pi WHERE pi.purchase_id = p.id) AS item_count
    FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id JOIN users u ON u.id = p.created_by_id`;

  private mapPurchase(r: Record<string, any>): Purchase {
    return {
      id: r.id,
      purchaseNumber: r.purchase_number,
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      purchaseDate: r.purchase_date,
      subtotalPaise: Number(r.subtotal),
      amountPaidPaise: Number(r.paid),
      balancePaise: Number(r.subtotal) - Number(r.paid),
      notes: r.notes,
      createdBy: ref(r.created_by_id, r.full_name, r.username),
      createdAt: r.created_at.toISOString(),
      itemCount: r.item_count,
    };
  }

  async listPurchases(q: { page: number; pageSize: number; supplierId?: string; from?: string; to?: string }) {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (q.supplierId) {
      params.push(q.supplierId);
      conds.push(`p.supplier_id = $${params.length}`);
    }
    if (q.from || q.to) {
      const r = resolveRange(q.from, q.to);
      params.push(r.from, r.to);
      conds.push(`p.purchase_date BETWEEN $${params.length - 1} AND $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM purchases p ${where}`, params);
    const rows = await this.ds.query(
      `${this.purchaseSelect} ${where} ORDER BY p.purchase_date DESC, p.created_at DESC LIMIT ${q.pageSize} OFFSET ${offset(q)}`,
      params,
    );
    return paged(rows.map((r: Record<string, any>) => this.mapPurchase(r)), total, q);
  }

  async getPurchase(id: string): Promise<Purchase> {
    const [r] = await this.ds.query(`${this.purchaseSelect} WHERE p.id = $1`, [id]);
    if (!r) throw Errors.notFound('Purchase');
    const items = await this.ds.query(
      `SELECT pi.id, pi.product_id, pr.name, pr.sku::text AS sku, pi.quantity, pi.unit_cost_paise::bigint AS cost, pi.line_total_paise::bigint AS total
       FROM purchase_items pi JOIN products pr ON pr.id = pi.product_id WHERE pi.purchase_id = $1 ORDER BY pr.name`,
      [id],
    );
    return {
      ...this.mapPurchase(r),
      items: items.map((i: Record<string, any>) => ({
        id: i.id,
        productId: i.product_id,
        productName: i.name,
        sku: i.sku,
        quantity: i.quantity,
        unitCostPaise: Number(i.cost),
        lineTotalPaise: Number(i.total),
      })),
    };
  }

  // ------------------------------------------------------ supplier payments
  async payments(supplierId: string): Promise<SupplierPayment[]> {
    const rows = await this.ds.query(
      `SELECT sp.*, p.purchase_number, u.full_name, u.username::text AS username
       FROM supplier_payments sp LEFT JOIN purchases p ON p.id = sp.purchase_id JOIN users u ON u.id = sp.created_by_id
       WHERE sp.supplier_id = $1 ORDER BY sp.paid_at DESC`,
      [supplierId],
    );
    return rows.map((r: Record<string, any>) => ({
      id: r.id,
      supplierId: r.supplier_id,
      purchaseId: r.purchase_id,
      purchaseNumber: r.purchase_number,
      amountPaise: Number(r.amount_paise),
      method: r.method,
      note: r.note,
      paidAt: r.paid_at.toISOString(),
      createdBy: ref(r.created_by_id, r.full_name, r.username),
    }));
  }

  async paySupplier(
    supplierId: string,
    dto: { purchaseId?: string; amountPaise: number; method: PaymentMethod; note?: string },
    actor: AuthContext,
    meta: RequestMeta,
  ) {
    await this.ds.transaction(async (m) => {
      const supplier = await m.getRepository(Supplier).findOne({ where: { id: supplierId }, lock: { mode: 'pessimistic_write' } });
      if (!supplier) throw Errors.notFound('Supplier');
      const [{ balance }] = await m.query(
        `SELECT (COALESCE((SELECT sum(subtotal_paise) FROM purchases WHERE supplier_id = $1), 0)
               - COALESCE((SELECT sum(amount_paise) FROM supplier_payments WHERE supplier_id = $1), 0))::bigint AS balance`,
        [supplierId],
      );
      if (dto.amountPaise > Number(balance)) throw Errors.validation('Payment exceeds the amount owed to this supplier');
      if (dto.purchaseId) {
        const [p] = await m.query(
          `SELECT p.supplier_id, p.subtotal_paise - COALESCE((SELECT sum(amount_paise) FROM supplier_payments WHERE purchase_id = p.id), 0) AS due
           FROM purchases p WHERE p.id = $1`,
          [dto.purchaseId],
        );
        if (!p || p.supplier_id !== supplierId) throw Errors.validation('Purchase does not belong to this supplier');
        if (dto.amountPaise > Number(p.due)) throw Errors.validation('Payment exceeds the balance of this purchase');
        await m.query(`UPDATE purchases SET amount_paid_paise = amount_paid_paise + $2 WHERE id = $1`, [dto.purchaseId, dto.amountPaise]);
      }
      await m.getRepository(SupplierPaymentEntity).insert({
        supplierId,
        purchaseId: dto.purchaseId ?? null,
        amountPaise: dto.amountPaise,
        method: dto.method,
        note: dto.note ?? null,
        paidAt: new Date(),
        createdById: actor.userId,
      });
      await this.audit.log(
        {
          actorId: actor.userId,
          actorUsername: actor.username,
          action: 'SUPPLIER_PAYMENT',
          entityType: 'supplier',
          entityId: supplierId,
          after: dto,
          ip: meta.ip,
          requestId: meta.requestId,
        },
        m,
      );
    });
    return this.get(supplierId);
  }
}
