import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  AdjustmentStatus,
  AdjustmentType,
  DailyStockRow,
  INCREASING_ADJUSTMENTS,
  InventoryRow,
  InventorySummary,
  Permission,
  StockAdjustment,
  StockCount,
  StockCountStatus,
  StockMovement,
  StockMovementType,
  StockReferenceType,
} from '@kite/shared';
import { AuthContext, RequestMeta } from '../../common/decorators';
import { Errors } from '../../common/errors';
import { resolveRange } from '../../common/utils/dates';
import { offset, paged } from '../../common/utils/pagination';
import { Product, StockAdjustmentEntity, StockCountEntity, StockCountItemEntity } from '../../database/entities';
import { AuditService } from '../audit/audit.service';
import { SequenceService } from '../audit/sequence.service';
import { StockChange, StockService } from './stock.service';

export interface StockLineInput {
  productId: string;
  quantity: number;
  unitCostPaise?: number;
}

const userRef = (id: string | null, name: string | null, username: string | null) =>
  id ? { id, fullName: name ?? '', username: username ?? '' } : null;

@Injectable()
export class InventoryService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly stock: StockService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
  ) {}

  // ------------------------------------------------------------------ views
  async list(
    q: { page: number; pageSize: number; q?: string; categoryId?: string; stock?: 'in' | 'low' | 'out' },
    viewCost: boolean,
  ) {
    const where = [`p.kind = 'STANDARD'`, 'p.is_active'];
    const params: unknown[] = [];
    const p = (v: unknown) => (params.push(v), `$${params.length}`);
    if (q.q) where.push(`(p.name ILIKE ${p(`%${q.q}%`)} OR p.sku ILIKE ${p(`%${q.q}%`)})`);
    if (q.categoryId) where.push(`p.category_id = ${p(q.categoryId)}`);
    if (q.stock === 'out') where.push('sb.quantity = 0');
    if (q.stock === 'low') where.push('sb.quantity <= p.min_stock_alert');
    if (q.stock === 'in') where.push('sb.quantity > 0');
    const from = `FROM products p JOIN stock_balances sb ON sb.product_id = p.id JOIN product_categories c ON c.id = p.category_id WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total ${from}`, params);
    const rows = await this.ds.query(
      `SELECT p.id, p.sku::text AS sku, p.name, c.name::text AS category_name, p.unit_type, sb.quantity, p.min_stock_alert,
              p.purchase_price_paise::bigint AS cost, p.selling_price_paise::bigint AS price,
              (SELECT max(created_at) FROM stock_movements m WHERE m.product_id = p.id) AS last_movement_at,
              (SELECT max(created_at) FROM stock_movements m WHERE m.product_id = p.id AND m.movement_type IN ('PURCHASE_RECEIPT','OPENING')) AS last_receipt_at,
              (SELECT max(created_at) FROM stock_movements m WHERE m.product_id = p.id AND m.movement_type = 'SALE') AS last_sale_at
       ${from} ORDER BY (sb.quantity <= p.min_stock_alert) DESC, p.name LIMIT ${q.pageSize} OFFSET ${offset(q)}`,
      params,
    );
    return paged<InventoryRow>(
      rows.map((r: Record<string, any>) => ({
        productId: r.id,
        sku: r.sku,
        name: r.name,
        categoryName: r.category_name,
        unitType: r.unit_type,
        quantity: r.quantity,
        minStockAlert: r.min_stock_alert,
        isLowStock: r.quantity <= r.min_stock_alert,
        isOutOfStock: r.quantity === 0,
        ...(viewCost ? { purchasePricePaise: Number(r.cost), costValuePaise: Number(r.cost) * r.quantity } : {}),
        sellingPricePaise: Number(r.price),
        retailValuePaise: Number(r.price) * r.quantity,
        lastMovementAt: r.last_movement_at?.toISOString() ?? null,
        lastReceiptAt: r.last_receipt_at?.toISOString() ?? null,
        lastSaleAt: r.last_sale_at?.toISOString() ?? null,
      })),
      total,
      q,
    );
  }

  async summary(viewCost: boolean): Promise<InventorySummary> {
    const [r] = await this.ds.query(
      `SELECT count(*)::int AS products, COALESCE(sum(sb.quantity), 0)::bigint AS units,
              count(*) FILTER (WHERE sb.quantity > p.min_stock_alert)::int AS in_stock,
              count(*) FILTER (WHERE sb.quantity <= p.min_stock_alert AND sb.quantity > 0)::int AS low,
              count(*) FILTER (WHERE sb.quantity = 0)::int AS out_of_stock,
              COALESCE(sum(sb.quantity * p.purchase_price_paise), 0)::bigint AS cost_value,
              COALESCE(sum(sb.quantity * p.selling_price_paise), 0)::bigint AS retail_value
       FROM products p JOIN stock_balances sb ON sb.product_id = p.id
       WHERE p.kind = 'STANDARD' AND p.is_active`,
    );
    return {
      standardProducts: r.products,
      totalUnits: Number(r.units),
      inStock: r.in_stock,
      lowStock: r.low + r.out_of_stock,
      outOfStock: r.out_of_stock,
      ...(viewCost ? { costValuePaise: Number(r.cost_value) } : {}),
      retailValuePaise: Number(r.retail_value),
    };
  }

  async lowStock(viewCost: boolean) {
    return (await this.list({ page: 1, pageSize: 200, stock: 'low' }, viewCost)).data;
  }

  async movements(
    q: {
      page: number;
      pageSize: number;
      productId?: string;
      type?: StockMovementType;
      referenceType?: StockReferenceType;
      referenceId?: string;
      userId?: string;
      from?: string;
      to?: string;
    },
    viewCost: boolean,
  ) {
    const { where, params } = this.movementFilter(q);
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM stock_movements m ${where}`, params);
    const rows = await this.ds.query(
      `${MOVEMENT_SELECT} ${where} ORDER BY m.seq DESC LIMIT ${q.pageSize} OFFSET ${offset(q)}`,
      params,
    );
    return paged(rows.map((r: MovementRow) => mapMovement(r, viewCost)), total, q);
  }

  movementFilter(q: { productId?: string; type?: string; referenceType?: string; referenceId?: string; userId?: string; from?: string; to?: string }) {
    const conds: string[] = [];
    const params: unknown[] = [];
    const p = (v: unknown) => (params.push(v), `$${params.length}`);
    if (q.productId) conds.push(`m.product_id = ${p(q.productId)}`);
    if (q.type) conds.push(`m.movement_type = ${p(q.type)}`);
    if (q.referenceType) conds.push(`m.reference_type = ${p(q.referenceType)}`);
    if (q.referenceId) conds.push(`m.reference_id = ${p(q.referenceId)}`);
    if (q.userId) conds.push(`m.created_by_id = ${p(q.userId)}`);
    if (q.from || q.to) {
      const r = resolveRange(q.from, q.to);
      conds.push(`m.created_at >= ${p(r.start)} AND m.created_at < ${p(r.end)}`);
    }
    return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
  }

  async dailyStock(q: { from?: string; to?: string; productId?: string }): Promise<DailyStockRow[]> {
    const r = resolveRange(q.from, q.to, 62);
    const rows = await this.ds.query(
      `WITH days AS (SELECT d::date AS day FROM generate_series($1::date, $2::date, interval '1 day') d),
            prods AS (SELECT id, name FROM products WHERE kind = 'STANDARD' AND ($3::uuid IS NULL OR id = $3::uuid)),
            grid AS (
              SELECT p.id, p.name, d.day,
                     (d.day::timestamp AT TIME ZONE 'Asia/Kolkata') AS s,
                     ((d.day + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS e
              FROM prods p CROSS JOIN days d)
       SELECT to_char(g.day, 'YYYY-MM-DD') AS date, g.id AS "productId", g.name AS "productName",
              COALESCE((SELECT m.new_quantity FROM stock_movements m WHERE m.product_id = g.id AND m.created_at < g.s
                        ORDER BY m.seq DESC LIMIT 1), 0) AS "openingQuantity",
              COALESCE((SELECT sum(m.quantity_change) FROM stock_movements m WHERE m.product_id = g.id
                        AND m.created_at >= g.s AND m.created_at < g.e AND m.quantity_change > 0), 0)::int AS "inQuantity",
              COALESCE((SELECT -sum(m.quantity_change) FROM stock_movements m WHERE m.product_id = g.id
                        AND m.created_at >= g.s AND m.created_at < g.e AND m.quantity_change < 0), 0)::int AS "outQuantity",
              COALESCE((SELECT m.new_quantity FROM stock_movements m WHERE m.product_id = g.id AND m.created_at < g.e
                        ORDER BY m.seq DESC LIMIT 1), 0) AS "closingQuantity"
       FROM grid g ORDER BY g.name, g.day`,
      [r.from, r.to, q.productId ?? null],
    );
    return rows;
  }

  // -------------------------------------------------------- receipts/opening
  private async ensureStandard(m: EntityManager, ids: string[]): Promise<Map<string, Product>> {
    const products = await m.getRepository(Product).findBy(ids.map((id) => ({ id })));
    const map = new Map(products.map((p) => [p.id, p]));
    for (const id of ids) {
      const p = map.get(id);
      if (!p) throw Errors.validation(`Product ${id} not found`);
      if (p.kind !== 'STANDARD') throw Errors.validation(`"${p.name}" is a bundle; receive stock for its components`);
    }
    return map;
  }

  async receive(
    items: StockLineInput[],
    opts: { opening: boolean; reason?: string },
    actor: AuthContext,
    meta: RequestMeta,
  ) {
    const ids = items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length) throw Errors.validation('A product is listed twice');
    return this.ds.transaction(async (m) => {
      const products = await this.ensureStandard(m, ids);
      if (opts.opening) {
        const already = items.filter((i) => products.get(i.productId)!.hasOpeningStock);
        if (already.length) {
          throw Errors.invalidState(
            `Opening stock already recorded for: ${already.map((i) => products.get(i.productId)!.name).join(', ')}. Use a stock receipt.`,
          );
        }
      }
      const number = opts.opening ? null : await this.sequences.next(m, 'RCV', this.sequences.currentYearSeries());
      const changes: StockChange[] = items.map((i) => ({
        productId: i.productId,
        change: i.quantity,
        type: opts.opening ? StockMovementType.OPENING : StockMovementType.PURCHASE_RECEIPT,
        referenceType: opts.opening ? StockReferenceType.OPENING : StockReferenceType.RECEIPT,
        referenceNumber: number,
        reason: opts.reason ?? (opts.opening ? 'Opening stock' : 'Stock receipt'),
        unitCostPaise: i.unitCostPaise ?? products.get(i.productId)!.purchasePricePaise,
      }));
      const applied = await this.stock.apply(m, changes, actor.userId);
      if (opts.opening) {
        await m.getRepository(Product).update(ids, { hasOpeningStock: true });
      }
      await this.audit.log(
        {
          actorId: actor.userId,
          actorUsername: actor.username,
          action: opts.opening ? 'STOCK_OPENING' : 'STOCK_RECEIVED',
          entityType: 'stock',
          entityId: number,
          metadata: { items, reason: opts.reason },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        m,
      );
      return { referenceNumber: number, movements: applied };
    });
  }

  // ------------------------------------------------------------ adjustments
  async createAdjustment(
    dto: { productId: string; type: AdjustmentType; quantity: number; reason: string },
    actor: AuthContext,
    meta: RequestMeta,
  ): Promise<StockAdjustment> {
    const increasing = INCREASING_ADJUSTMENTS.includes(dto.type);
    const autoApply = increasing || actor.permissions.has(Permission.INVENTORY_APPROVE);
    const id = await this.ds.transaction(async (m) => {
      await this.ensureStandard(m, [dto.productId]);
      const adj = await m.getRepository(StockAdjustmentEntity).save({
        productId: dto.productId,
        adjustmentType: dto.type,
        quantity: dto.quantity,
        reason: dto.reason.trim(),
        status: AdjustmentStatus.PENDING,
        requestedById: actor.userId,
      });
      if (autoApply) await this.applyAdjustment(m, adj, actor.userId);
      await this.audit.log(
        {
          actorId: actor.userId,
          actorUsername: actor.username,
          action: autoApply ? 'STOCK_ADJUSTED' : 'STOCK_ADJUSTMENT_REQUESTED',
          entityType: 'stock_adjustment',
          entityId: adj.id,
          after: dto,
          ip: meta.ip,
          requestId: meta.requestId,
        },
        m,
      );
      return adj.id;
    });
    return this.getAdjustment(id);
  }

  private async applyAdjustment(m: EntityManager, adj: StockAdjustmentEntity, deciderId: string): Promise<void> {
    const sign = INCREASING_ADJUSTMENTS.includes(adj.adjustmentType) ? 1 : -1;
    const [mv] = await this.stock.apply(
      m,
      [
        {
          productId: adj.productId,
          change: sign * adj.quantity,
          type: adj.adjustmentType as StockMovementType,
          referenceType: StockReferenceType.ADJUSTMENT,
          referenceId: adj.id,
          reason: adj.reason,
        },
      ],
      adj.requestedById,
    );
    await m.getRepository(StockAdjustmentEntity).update(adj.id, {
      status: AdjustmentStatus.APPLIED,
      decidedById: deciderId,
      decidedAt: new Date(),
      movementId: mv.id,
    });
  }

  async decideAdjustment(id: string, approve: boolean, note: string | undefined, actor: AuthContext, meta: RequestMeta) {
    await this.ds.transaction(async (m) => {
      const adj = await m.getRepository(StockAdjustmentEntity).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!adj) throw Errors.notFound('Adjustment');
      if (adj.status !== AdjustmentStatus.PENDING) throw Errors.invalidState(`Adjustment is already ${adj.status.toLowerCase()}`);
      if (approve) {
        await this.applyAdjustment(m, adj, actor.userId);
        if (note) await m.getRepository(StockAdjustmentEntity).update(id, { decisionNote: note });
      } else {
        await m.getRepository(StockAdjustmentEntity).update(id, {
          status: AdjustmentStatus.REJECTED,
          decidedById: actor.userId,
          decidedAt: new Date(),
          decisionNote: note ?? null,
        });
      }
      await this.audit.log(
        {
          actorId: actor.userId,
          actorUsername: actor.username,
          action: approve ? 'ADJUSTMENT_APPROVED' : 'ADJUSTMENT_REJECTED',
          entityType: 'stock_adjustment',
          entityId: id,
          metadata: { note },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        m,
      );
    });
    return this.getAdjustment(id);
  }

  private adjustmentSelect = `
    SELECT a.id, a.product_id, p.name AS product_name, p.sku::text AS sku, a.adjustment_type, a.quantity, a.reason, a.status,
           a.requested_by_id, ru.full_name AS req_name, ru.username::text AS req_username,
           a.decided_by_id, du.full_name AS dec_name, du.username::text AS dec_username,
           a.decided_at, a.decision_note, a.created_at
    FROM stock_adjustments a JOIN products p ON p.id = a.product_id
    JOIN users ru ON ru.id = a.requested_by_id LEFT JOIN users du ON du.id = a.decided_by_id`;

  private mapAdjustment(r: Record<string, any>): StockAdjustment {
    return {
      id: r.id,
      productId: r.product_id,
      productName: r.product_name,
      sku: r.sku,
      adjustmentType: r.adjustment_type,
      quantity: r.quantity,
      reason: r.reason,
      status: r.status,
      requestedBy: userRef(r.requested_by_id, r.req_name, r.req_username)!,
      decidedBy: userRef(r.decided_by_id, r.dec_name, r.dec_username),
      decidedAt: r.decided_at?.toISOString() ?? null,
      decisionNote: r.decision_note,
      createdAt: r.created_at.toISOString(),
    };
  }

  async getAdjustment(id: string): Promise<StockAdjustment> {
    const rows = await this.ds.query(`${this.adjustmentSelect} WHERE a.id = $1`, [id]);
    if (!rows[0]) throw Errors.notFound('Adjustment');
    return this.mapAdjustment(rows[0]);
  }

  async listAdjustments(q: { page: number; pageSize: number; status?: AdjustmentStatus }) {
    const where = q.status ? 'WHERE a.status = $1' : '';
    const params = q.status ? [q.status] : [];
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM stock_adjustments a ${where}`, params);
    const rows = await this.ds.query(
      `${this.adjustmentSelect} ${where} ORDER BY a.created_at DESC LIMIT ${q.pageSize} OFFSET ${offset(q)}`,
      params,
    );
    return paged(rows.map((r: Record<string, any>) => this.mapAdjustment(r)), total, q);
  }

  // ----------------------------------------------------------- stock counts
  async openCount(notes: string | undefined, actor: AuthContext, meta: RequestMeta): Promise<StockCount> {
    const id = await this.ds.transaction(async (m) => {
      const countNumber = await this.sequences.next(m, 'SC', this.sequences.currentYearSeries());
      const c = await m.getRepository(StockCountEntity).save({
        countNumber,
        status: StockCountStatus.OPEN,
        notes: notes ?? null,
        createdById: actor.userId,
      });
      await this.audit.log(
        { actorId: actor.userId, actorUsername: actor.username, action: 'STOCK_COUNT_OPENED', entityType: 'stock_count', entityId: c.id, ip: meta.ip },
        m,
      );
      return c.id;
    });
    return this.getCount(id);
  }

  async recordCountItems(id: string, items: { productId: string; countedQuantity: number }[], actor: AuthContext) {
    await this.ds.transaction(async (m) => {
      const c = await m.getRepository(StockCountEntity).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!c) throw Errors.notFound('Stock count');
      if (c.status !== StockCountStatus.OPEN) throw Errors.invalidState('This stock count is closed');
      const ids = items.map((i) => i.productId);
      if (new Set(ids).size !== ids.length) throw Errors.validation('A product is listed twice');
      await this.ensureStandard(m, ids);
      const balances = await this.stock.balances(m, ids);
      for (const i of items) {
        const system = balances.get(i.productId) ?? 0;
        await m.query(
          `INSERT INTO stock_count_items (stock_count_id, product_id, system_quantity, counted_quantity, variance, counted_by_id, counted_at)
           VALUES ($1, $2, $3, $4, $5, $6, now())
           ON CONFLICT (stock_count_id, product_id) DO UPDATE
             SET system_quantity = EXCLUDED.system_quantity, counted_quantity = EXCLUDED.counted_quantity,
                 variance = EXCLUDED.variance, counted_by_id = EXCLUDED.counted_by_id, counted_at = now()`,
          [id, i.productId, system, i.countedQuantity, i.countedQuantity - system, actor.userId],
        );
      }
    });
    return this.getCount(id);
  }

  async completeCount(id: string, actor: AuthContext, meta: RequestMeta) {
    await this.ds.transaction(async (m) => {
      const c = await m.getRepository(StockCountEntity).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!c) throw Errors.notFound('Stock count');
      if (c.status !== StockCountStatus.OPEN) throw Errors.invalidState('This stock count is closed');
      const items = await m.getRepository(StockCountItemEntity).findBy({ stockCountId: id });
      if (!items.length) throw Errors.validation('Count at least one product before completing');
      const changes: StockChange[] = items
        .filter((i) => i.variance !== 0)
        .map((i) => ({
          productId: i.productId,
          change: i.variance,
          type: StockMovementType.COUNT_CORRECTION,
          referenceType: StockReferenceType.STOCK_COUNT,
          referenceId: id,
          referenceNumber: c.countNumber,
          reason: `Physical count ${c.countNumber}: counted ${i.countedQuantity}, system ${i.systemQuantity}`,
        }));
      await this.stock.apply(m, changes, actor.userId);
      await m.getRepository(StockCountEntity).update(id, {
        status: StockCountStatus.COMPLETED,
        completedById: actor.userId,
        completedAt: new Date(),
      });
      await this.audit.log(
        {
          actorId: actor.userId,
          actorUsername: actor.username,
          action: 'STOCK_COUNT_COMPLETED',
          entityType: 'stock_count',
          entityId: id,
          metadata: { corrections: changes.length, netVariance: changes.reduce((s, x) => s + x.change, 0) },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        m,
      );
    });
    return this.getCount(id);
  }

  async cancelCount(id: string, actor: AuthContext, meta: RequestMeta) {
    const res = await this.ds
      .getRepository(StockCountEntity)
      .update({ id, status: StockCountStatus.OPEN }, { status: StockCountStatus.CANCELLED, completedById: actor.userId, completedAt: new Date() });
    if (!res.affected) throw Errors.invalidState('Only an open stock count can be cancelled');
    this.audit.logAsync({ actorId: actor.userId, action: 'STOCK_COUNT_CANCELLED', entityType: 'stock_count', entityId: id, ip: meta.ip });
    return this.getCount(id);
  }

  async getCount(id: string): Promise<StockCount> {
    const [c] = await this.ds.query(
      `SELECT sc.*, cu.full_name AS c_name, cu.username::text AS c_username, du.full_name AS d_name, du.username::text AS d_username
       FROM stock_counts sc JOIN users cu ON cu.id = sc.created_by_id LEFT JOIN users du ON du.id = sc.completed_by_id
       WHERE sc.id = $1`,
      [id],
    );
    if (!c) throw Errors.notFound('Stock count');
    const items = await this.ds.query(
      `SELECT i.product_id, p.name, p.sku::text AS sku, i.system_quantity, i.counted_quantity, i.variance, i.counted_at, sb.quantity AS current
       FROM stock_count_items i JOIN products p ON p.id = i.product_id JOIN stock_balances sb ON sb.product_id = i.product_id
       WHERE i.stock_count_id = $1 ORDER BY p.name`,
      [id],
    );
    return {
      id: c.id,
      countNumber: c.count_number,
      status: c.status,
      notes: c.notes,
      createdBy: userRef(c.created_by_id, c.c_name, c.c_username)!,
      completedBy: userRef(c.completed_by_id, c.d_name, c.d_username),
      createdAt: c.created_at.toISOString(),
      completedAt: c.completed_at?.toISOString() ?? null,
      itemCount: items.length,
      totalVariance: items.reduce((s: number, i: { variance: number }) => s + i.variance, 0),
      items: items.map((i: Record<string, any>) => ({
        productId: i.product_id,
        productName: i.name,
        sku: i.sku,
        systemQuantity: i.system_quantity,
        countedQuantity: i.counted_quantity,
        variance: i.variance,
        currentQuantity: i.current,
        countedAt: i.counted_at.toISOString(),
      })),
    };
  }

  async listCounts(q: { page: number; pageSize: number }) {
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM stock_counts`);
    const rows = await this.ds.query(
      `SELECT sc.id, sc.count_number, sc.status, sc.notes, sc.created_at, sc.completed_at,
              sc.created_by_id, cu.full_name AS c_name, cu.username::text AS c_username,
              sc.completed_by_id, du.full_name AS d_name, du.username::text AS d_username,
              (SELECT count(*)::int FROM stock_count_items i WHERE i.stock_count_id = sc.id) AS item_count,
              (SELECT COALESCE(sum(variance), 0)::int FROM stock_count_items i WHERE i.stock_count_id = sc.id) AS total_variance
       FROM stock_counts sc JOIN users cu ON cu.id = sc.created_by_id LEFT JOIN users du ON du.id = sc.completed_by_id
       ORDER BY sc.created_at DESC LIMIT ${q.pageSize} OFFSET ${offset(q)}`,
    );
    return paged<StockCount>(
      rows.map((c: Record<string, any>) => ({
        id: c.id,
        countNumber: c.count_number,
        status: c.status,
        notes: c.notes,
        createdBy: userRef(c.created_by_id, c.c_name, c.c_username)!,
        completedBy: userRef(c.completed_by_id, c.d_name, c.d_username),
        createdAt: c.created_at.toISOString(),
        completedAt: c.completed_at?.toISOString() ?? null,
        itemCount: c.item_count,
        totalVariance: c.total_variance,
      })),
      total,
      q,
    );
  }
}

export const MOVEMENT_SELECT = `
  SELECT m.id, m.product_id, p.name AS product_name, p.sku::text AS sku, m.movement_type, m.quantity_change,
         m.previous_quantity, m.new_quantity, m.unit_cost_paise, m.reference_type, m.reference_id, m.reference_number,
         m.reason, m.created_by_id, u.full_name AS user_name, u.username::text AS user_username, m.created_at
  FROM stock_movements m JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.created_by_id`;

export interface MovementRow {
  id: string;
  product_id: string;
  product_name: string;
  sku: string;
  movement_type: StockMovementType;
  quantity_change: number;
  previous_quantity: number;
  new_quantity: number;
  unit_cost_paise: string | null;
  reference_type: StockReferenceType | null;
  reference_id: string | null;
  reference_number: string | null;
  reason: string | null;
  created_by_id: string | null;
  user_name: string | null;
  user_username: string | null;
  created_at: Date;
}

export function mapMovement(r: MovementRow, viewCost: boolean): StockMovement {
  return {
    id: r.id,
    productId: r.product_id,
    productName: r.product_name,
    sku: r.sku,
    movementType: r.movement_type,
    quantityChange: r.quantity_change,
    previousQuantity: r.previous_quantity,
    newQuantity: r.new_quantity,
    ...(viewCost ? { unitCostPaise: r.unit_cost_paise === null ? null : Number(r.unit_cost_paise) } : {}),
    referenceType: r.reference_type,
    referenceId: r.reference_id,
    referenceNumber: r.reference_number,
    reason: r.reason,
    createdBy: userRef(r.created_by_id, r.user_name, r.user_username),
    createdAt: r.created_at.toISOString(),
  };
}
