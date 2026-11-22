import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { StockMovementType, StockReferenceType } from '@kite/shared';
import { Errors } from '../../common/errors';

export interface StockChange {
  productId: string;
  /** signed quantity in base units; never 0 */
  change: number;
  type: StockMovementType;
  referenceType?: StockReferenceType | null;
  referenceId?: string | null;
  referenceNumber?: string | null;
  reason?: string | null;
  unitCostPaise?: number | null;
}

export interface AppliedMovement {
  id: string;
  productId: string;
  previousQuantity: number;
  newQuantity: number;
  quantityChange: number;
}

/**
 * The ONLY writer of stock_balances (specification.md §7.1–7.2).
 * Must be called inside a transaction. Locks balance rows in ascending product-id order
 * (deadlock-free), validates non-negativity, updates balances and writes one ledger row per change.
 */
@Injectable()
export class StockService {
  async apply(m: EntityManager, changes: StockChange[], actorId: string | null): Promise<AppliedMovement[]> {
    const effective = changes.filter((c) => c.change !== 0);
    if (effective.length === 0) return [];
    for (const c of effective) {
      if (!Number.isInteger(c.change)) throw Errors.validation('Stock quantities must be whole numbers');
    }
    const ids = [...new Set(effective.map((c) => c.productId))].sort();

    const locked: { product_id: string; quantity: number; name: string; kind: string }[] = await m.query(
      `SELECT sb.product_id, sb.quantity, p.name, p.kind
       FROM stock_balances sb JOIN products p ON p.id = sb.product_id
       WHERE sb.product_id = ANY($1::uuid[])
       ORDER BY sb.product_id
       FOR UPDATE OF sb`,
      [ids],
    );
    if (locked.length !== ids.length) {
      throw Errors.validation('Stock can only be tracked for standard (non-bundle) products');
    }
    const current = new Map(locked.map((r) => [r.product_id, r.quantity]));
    const names = new Map(locked.map((r) => [r.product_id, r.name]));

    // Net requirement check first so the error lists every short product at once.
    const net = new Map<string, number>();
    for (const c of effective) net.set(c.productId, (net.get(c.productId) ?? 0) + c.change);
    const short = [...net.entries()]
      .filter(([id, delta]) => (current.get(id) ?? 0) + delta < 0)
      .map(([id, delta]) => ({
        productId: id,
        name: names.get(id) ?? id,
        requested: -delta,
        available: current.get(id) ?? 0,
      }));
    if (short.length) throw Errors.insufficientStock(short);

    const rows: unknown[] = [];
    const params: unknown[] = [];
    const applied: Omit<AppliedMovement, 'id'>[] = [];
    for (const c of effective) {
      const prev = current.get(c.productId)!;
      const next = prev + c.change;
      current.set(c.productId, next);
      applied.push({ productId: c.productId, previousQuantity: prev, newQuantity: next, quantityChange: c.change });
      const base = params.length;
      params.push(
        c.productId,
        c.type,
        c.change,
        prev,
        next,
        c.unitCostPaise ?? null,
        c.referenceType ?? null,
        c.referenceId ?? null,
        c.referenceNumber ?? null,
        c.reason ?? null,
        actorId,
      );
      rows.push(`(${Array.from({ length: 11 }, (_, i) => `$${base + i + 1}`).join(',')})`);
    }

    for (const id of ids) {
      await m.query(`UPDATE stock_balances SET quantity = $2, updated_at = now() WHERE product_id = $1`, [
        id,
        current.get(id),
      ]);
    }
    const inserted: { id: string }[] = await m.query(
      `INSERT INTO stock_movements
         (product_id, movement_type, quantity_change, previous_quantity, new_quantity, unit_cost_paise,
          reference_type, reference_id, reference_number, reason, created_by_id)
       VALUES ${rows.join(',')}
       RETURNING id`,
      params,
    );
    return applied.map((a, i) => ({ ...a, id: inserted[i].id }));
  }

  /** Current balances (no lock) for display/preview. */
  async balances(m: EntityManager, productIds: string[]): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const rows: { product_id: string; quantity: number }[] = await m.query(
      `SELECT product_id, quantity FROM stock_balances WHERE product_id = ANY($1::uuid[])`,
      [productIds],
    );
    return new Map(rows.map((r) => [r.product_id, r.quantity]));
  }
}
