import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { DataSource, EntityManager } from 'typeorm';
import {
  BundleItem,
  normalizeSku,
  paiseToDecimalString,
  Permission,
  PosCatalog,
  Product as ProductDto,
  ProductKind,
  SKU_PATTERN,
  StockMovementType,
  StockReferenceType,
  tryRupeesToPaise,
  UNIT_TYPES,
  UnitType,
} from '@kite/shared';
import { AuthContext, RequestMeta } from '../../common/decorators';
import { Errors, pgCode, pgConstraint, PG_UNIQUE_VIOLATION } from '../../common/errors';
import { offset, paged } from '../../common/utils/pagination';
import { publicUrl } from '../../common/utils/uploads';
import { Product, ProductBundleItem, ProductCategory, StockBalance } from '../../database/entities';
import { AuditService } from '../audit/audit.service';
import { StockService } from '../inventory/stock.service';
import { SettingsService } from '../settings/settings.service';
import type { CreateProductDto, ProductsQuery, UpdateProductDto } from './dto';
import { AVAILABLE_SQL, mapProductRow, PRODUCT_FROM, PRODUCT_SELECT, ProductRow } from './product-queries';

const SORTS: Record<string, string> = {
  name: 'p.name',
  sku: 'p.sku',
  price: 'p.selling_price_paise',
  quantity: 'available_quantity',
  updated: 'p.updated_at',
};

export interface ImportRowError {
  row: number;
  field?: string;
  message: string;
}

@Injectable()
export class ProductsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly stock: StockService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  // ------------------------------------------------------------------ reads
  async list(q: ProductsQuery, viewCost: boolean) {
    const where: string[] = [];
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (q.q) {
      const term = q.q.trim();
      where.push(`(p.name ILIKE ${p(`%${term}%`)} OR p.sku ILIKE ${p(`%${term}%`)} OR p.barcode = ${p(term)})`);
    }
    if (q.categoryId) where.push(`p.category_id = ${p(q.categoryId)}`);
    if (q.kind) where.push(`p.kind = ${p(q.kind)}`);
    if (q.isActive !== undefined) where.push(`p.is_active = ${p(q.isActive)}`);
    if (q.isFavorite !== undefined) where.push(`p.is_favorite = ${p(q.isFavorite)}`);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    let stockFilter = '';
    if (q.stock === 'out') stockFilter = 'WHERE x.available_quantity = 0';
    if (q.stock === 'in') stockFilter = 'WHERE x.available_quantity > 0';
    if (q.stock === 'low') stockFilter = `WHERE x.kind = 'STANDARD' AND x.available_quantity <= x.min_stock_alert`;
    const sortCol = SORTS[q.sort ?? 'name'].replace('p.', 'x.');
    const dir = q.order === 'desc' ? 'DESC' : 'ASC';
    const base = `SELECT ${PRODUCT_SELECT} ${PRODUCT_FROM} ${whereSql}`;
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM (${base}) x ${stockFilter}`, params);
    const rows: ProductRow[] = await this.ds.query(
      `SELECT * FROM (${base}) x ${stockFilter} ORDER BY ${sortCol} ${dir}, x.name ASC LIMIT ${q.pageSize} OFFSET ${offset(q)}`,
      params,
    );
    return paged(rows.map((r) => mapProductRow(r, viewCost)), total, q);
  }

  async get(id: string, viewCost: boolean, m: EntityManager = this.ds.manager): Promise<ProductDto> {
    const rows: ProductRow[] = await m.query(`SELECT ${PRODUCT_SELECT} ${PRODUCT_FROM} WHERE p.id = $1`, [id]);
    if (!rows[0]) throw Errors.notFound('Product');
    const dto = mapProductRow(rows[0], viewCost);
    if (dto.kind === 'BUNDLE') dto.bundleItems = await this.bundleItems(id, m);
    return dto;
  }

  private async bundleItems(bundleId: string, m: EntityManager): Promise<BundleItem[]> {
    const rows: { component_product_id: string; name: string; sku: string; quantity: number; available: number }[] =
      await m.query(
        `SELECT bi.component_product_id, cp.name, cp.sku::text AS sku, bi.quantity, COALESCE(sb.quantity, 0) AS available
         FROM product_bundle_items bi
         JOIN products cp ON cp.id = bi.component_product_id
         LEFT JOIN stock_balances sb ON sb.product_id = cp.id
         WHERE bi.bundle_product_id = $1 ORDER BY cp.name`,
        [bundleId],
      );
    return rows.map((r) => ({
      componentProductId: r.component_product_id,
      componentName: r.name,
      componentSku: r.sku,
      quantity: r.quantity,
      componentAvailable: r.available,
    }));
  }

  async lookup(code: string, viewCost: boolean): Promise<ProductDto> {
    const rows: { id: string }[] = await this.ds.query(
      `SELECT id FROM products WHERE is_active AND (barcode = $1 OR sku = $1::citext) LIMIT 1`,
      [code.trim()],
    );
    if (!rows[0]) throw Errors.notFound('Product with this code');
    return this.get(rows[0].id, viewCost);
  }

  /** Compact, cacheable catalog for the POS app. */
  async posCatalog(): Promise<{ body: PosCatalog; etag: string }> {
    const categories: { id: string; name: string; sort_order: number; is_active: boolean }[] = await this.ds.query(
      `SELECT id, name::text AS name, sort_order, is_active FROM product_categories WHERE is_active ORDER BY sort_order, name`,
    );
    const products: (ProductRow & { available_quantity: number })[] = await this.ds.query(
      `SELECT ${PRODUCT_SELECT} ${PRODUCT_FROM} WHERE p.is_active ORDER BY p.is_favorite DESC, p.favorite_order, p.name`,
    );
    const items = products.map((r) => ({
      id: r.id,
      sku: r.sku,
      barcode: r.barcode,
      name: r.name,
      categoryId: r.category_id,
      kind: r.kind,
      unitType: r.unit_type,
      sellingPricePaise: Number(r.selling_price_paise),
      availableQuantity: Number(r.available_quantity),
      imageUrl: publicUrl(r.image_url),
      isFavorite: r.is_favorite,
      favoriteOrder: r.favorite_order,
    }));
    const cats = categories.map((c) => ({ id: c.id, name: c.name, sortOrder: c.sort_order, isActive: c.is_active }));
    const etag = `"${createHash('sha1').update(JSON.stringify([cats, items])).digest('hex')}"`;
    return { body: { generatedAt: new Date().toISOString(), categories: cats, products: items }, etag };
  }

  async salesHistory(id: string, q: { page: number; pageSize: number }) {
    const [{ total }] = await this.ds.query(
      `SELECT count(*)::int AS total FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE ii.product_id = $1`,
      [id],
    );
    const rows = await this.ds.query(
      `SELECT i.id AS "invoiceId", i.invoice_number AS "invoiceNumber", i.status, i.created_at AS "createdAt",
              u.full_name AS "salesperson", ii.quantity, ii.returned_quantity AS "returnedQuantity",
              ii.unit_price_paise::bigint AS "unitPricePaise", ii.line_total_paise::bigint AS "lineTotalPaise"
       FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id JOIN users u ON u.id = i.salesperson_id
       WHERE ii.product_id = $1 ORDER BY i.created_at DESC LIMIT ${q.pageSize} OFFSET ${offset(q)}`,
      [id],
    );
    return paged(
      rows.map((r: Record<string, unknown>) => ({
        ...r,
        unitPricePaise: Number(r.unitPricePaise),
        lineTotalPaise: Number(r.lineTotalPaise),
      })),
      total,
      q,
    );
  }

  // ----------------------------------------------------------------- writes
  private async nextSku(m: EntityManager): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const [{ last_value }] = await m.query(
        `INSERT INTO document_sequences(key, last_value) VALUES ('SKU:KT', 1)
         ON CONFLICT (key) DO UPDATE SET last_value = document_sequences.last_value + 1 RETURNING last_value`,
      );
      const sku = `KT-${String(last_value).padStart(6, '0')}`;
      const exists = await m.getRepository(Product).exist({ where: { sku } });
      if (!exists) return sku;
    }
    throw Errors.invalidState('Could not generate a unique SKU; please enter one');
  }

  private async validateCategory(m: EntityManager, categoryId: string): Promise<void> {
    const cat = await m.getRepository(ProductCategory).findOneBy({ id: categoryId });
    if (!cat) throw Errors.validation('Category not found', [{ field: 'categoryId', message: 'Category not found' }]);
    if (!cat.isActive) throw Errors.validation('Category is inactive', [{ field: 'categoryId', message: 'Category is inactive' }]);
  }

  private async replaceBundleItems(
    m: EntityManager,
    bundleId: string,
    items: { componentProductId: string; quantity: number }[],
  ): Promise<void> {
    const ids = items.map((i) => i.componentProductId);
    if (new Set(ids).size !== ids.length) throw Errors.validation('A component is listed twice');
    if (ids.includes(bundleId)) throw Errors.validation('A bundle cannot contain itself');
    const comps = await m.getRepository(Product).findBy(ids.map((id) => ({ id })));
    if (comps.length !== ids.length) throw Errors.validation('Some bundle components were not found');
    for (const c of comps) {
      if (c.kind !== 'STANDARD') throw Errors.validation(`"${c.name}" is a bundle; components must be standard products`);
      if (!c.isActive) throw Errors.validation(`"${c.name}" is inactive`);
    }
    await m.getRepository(ProductBundleItem).delete({ bundleProductId: bundleId });
    await m.getRepository(ProductBundleItem).insert(
      items.map((i) => ({ bundleProductId: bundleId, componentProductId: i.componentProductId, quantity: i.quantity })),
    );
  }

  private translateUnique(err: unknown): never {
    if (pgCode(err) === PG_UNIQUE_VIOLATION) {
      const c = pgConstraint(err) ?? '';
      if (c.includes('barcode')) throw Errors.duplicate('Another product already uses this barcode', [{ field: 'barcode', message: 'Already in use' }]);
      throw Errors.duplicate('Another product already uses this SKU', [{ field: 'sku', message: 'Already in use' }]);
    }
    throw err;
  }

  async create(dto: CreateProductDto, actor: AuthContext, meta: RequestMeta): Promise<ProductDto> {
    if (dto.kind === 'BUNDLE' && !dto.bundleItems?.length) {
      throw Errors.validation('A bundle needs at least one component', [{ field: 'bundleItems', message: 'Required' }]);
    }
    if (dto.kind === 'STANDARD' && dto.bundleItems?.length) throw Errors.validation('Only bundles can have components');
    if (dto.kind === 'BUNDLE' && dto.openingStock) throw Errors.validation('Bundles do not hold stock; stock their components');
    const settings = await this.settings.getEntity();
    try {
      const id = await this.ds.transaction(async (m) => {
        await this.validateCategory(m, dto.categoryId);
        const sku = dto.sku ? normalizeSku(dto.sku) : await this.nextSku(m);
        const product = await m.getRepository(Product).save(
          m.getRepository(Product).create({
            name: dto.name,
            sku,
            barcode: dto.barcode ?? null,
            description: dto.description ?? null,
            categoryId: dto.categoryId,
            kind: dto.kind,
            unitType: dto.unitType,
            purchasePricePaise: dto.kind === 'BUNDLE' ? 0 : dto.purchasePricePaise ?? 0,
            sellingPricePaise: dto.sellingPricePaise,
            mrpPaise: dto.mrpPaise ?? null,
            minStockAlert: dto.minStockAlert ?? settings.defaultMinStockAlert,
            supplierId: dto.supplierId ?? null,
            isActive: dto.isActive ?? true,
            isFavorite: dto.isFavorite ?? false,
            favoriteOrder: dto.favoriteOrder ?? 0,
            createdBy: actor.userId,
            updatedBy: actor.userId,
          }),
        );
        if (dto.kind === 'STANDARD') {
          await m.getRepository(StockBalance).insert({ productId: product.id, quantity: 0 });
          if (dto.openingStock && dto.openingStock > 0) {
            await this.stock.apply(
              m,
              [
                {
                  productId: product.id,
                  change: dto.openingStock,
                  type: StockMovementType.OPENING,
                  referenceType: StockReferenceType.OPENING,
                  reason: 'Opening stock (product created)',
                  unitCostPaise: product.purchasePricePaise,
                },
              ],
              actor.userId,
            );
            await m.getRepository(Product).update(product.id, { hasOpeningStock: true });
          }
        } else {
          await this.replaceBundleItems(m, product.id, dto.bundleItems!);
        }
        await this.audit.log(
          {
            actorId: actor.userId,
            actorUsername: actor.username,
            action: 'PRODUCT_CREATED',
            entityType: 'product',
            entityId: product.id,
            after: { ...dto, sku },
            ip: meta.ip,
            requestId: meta.requestId,
          },
          m,
        );
        return product.id;
      });
      return this.get(id, true);
    } catch (err) {
      this.translateUnique(err);
    }
  }

  async update(id: string, dto: UpdateProductDto, actor: AuthContext, meta: RequestMeta): Promise<ProductDto> {
    try {
      await this.ds.transaction(async (m) => {
        const product = await m.getRepository(Product).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
        if (!product) throw Errors.notFound('Product');
        const before = { ...product };
        if (dto.categoryId) await this.validateCategory(m, dto.categoryId);
        if (dto.bundleItems && product.kind !== 'BUNDLE') throw Errors.validation('Only bundles can have components');
        if (product.kind === 'BUNDLE' && dto.purchasePricePaise !== undefined) {
          throw Errors.validation('A bundle cost is derived from its components');
        }
        if (product.kind === 'STANDARD' && dto.isActive === false) {
          // Deactivating a component makes its bundles unavailable — allowed, but noted in the audit log.
        }
        const fields: (keyof UpdateProductDto)[] = [
          'name',
          'barcode',
          'categoryId',
          'unitType',
          'description',
          'purchasePricePaise',
          'sellingPricePaise',
          'mrpPaise',
          'minStockAlert',
          'supplierId',
          'isActive',
          'isFavorite',
          'favoriteOrder',
        ];
        for (const f of fields) {
          if (dto[f] !== undefined) (product as unknown as Record<string, unknown>)[f] = dto[f];
        }
        if (dto.sku) product.sku = normalizeSku(dto.sku);
        product.updatedBy = actor.userId;
        await m.getRepository(Product).save(product);
        if (dto.bundleItems) await this.replaceBundleItems(m, id, dto.bundleItems);

        const priceChanged =
          before.sellingPricePaise !== product.sellingPricePaise || before.purchasePricePaise !== product.purchasePricePaise;
        await this.audit.log(
          {
            actorId: actor.userId,
            actorUsername: actor.username,
            action: priceChanged ? 'PRODUCT_PRICE_CHANGED' : 'PRODUCT_UPDATED',
            entityType: 'product',
            entityId: id,
            before: this.auditView(before),
            after: { ...this.auditView(product), ...(dto.bundleItems ? { bundleItems: dto.bundleItems } : {}) },
            ip: meta.ip,
            requestId: meta.requestId,
          },
          m,
        );
      });
    } catch (err) {
      this.translateUnique(err);
    }
    return this.get(id, true);
  }

  private auditView(p: Product) {
    return {
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      categoryId: p.categoryId,
      sellingPricePaise: p.sellingPricePaise,
      purchasePricePaise: p.purchasePricePaise,
      mrpPaise: p.mrpPaise,
      minStockAlert: p.minStockAlert,
      isActive: p.isActive,
      isFavorite: p.isFavorite,
    };
  }

  /** Archive when referenced by history; hard-delete only an unused product. */
  async remove(id: string, actor: AuthContext, meta: RequestMeta): Promise<{ archived: boolean; deleted: boolean }> {
    return this.ds.transaction(async (m) => {
      const product = await m.getRepository(Product).findOneBy({ id });
      if (!product) throw Errors.notFound('Product');
      const [{ used }] = await m.query(
        `SELECT (EXISTS (SELECT 1 FROM invoice_items WHERE product_id = $1)
              OR EXISTS (SELECT 1 FROM invoice_item_components WHERE product_id = $1)
              OR EXISTS (SELECT 1 FROM stock_movements WHERE product_id = $1)
              OR EXISTS (SELECT 1 FROM purchase_items WHERE product_id = $1)
              OR EXISTS (SELECT 1 FROM product_bundle_items WHERE component_product_id = $1)) AS used`,
        [id],
      );
      if (used) {
        await m.getRepository(Product).update(id, { isActive: false, isFavorite: false, updatedBy: actor.userId });
      } else {
        await m.getRepository(ProductBundleItem).delete({ bundleProductId: id });
        await m.getRepository(StockBalance).delete({ productId: id });
        await m.getRepository(Product).delete(id);
      }
      await this.audit.log(
        {
          actorId: actor.userId,
          actorUsername: actor.username,
          action: used ? 'PRODUCT_ARCHIVED' : 'PRODUCT_DELETED',
          entityType: 'product',
          entityId: id,
          before: this.auditView(product),
          ip: meta.ip,
          requestId: meta.requestId,
        },
        m,
      );
      return { archived: !!used, deleted: !used };
    });
  }

  async setImage(id: string, relativePath: string, actor: AuthContext): Promise<ProductDto> {
    const res = await this.ds.getRepository(Product).update(id, { imageUrl: relativePath, updatedBy: actor.userId });
    if (!res.affected) throw Errors.notFound('Product');
    return this.get(id, actor.permissions.has(Permission.CATALOG_VIEW_COST));
  }

  async bulkPrice(
    items: { productId: string; sellingPricePaise?: number; purchasePricePaise?: number }[],
    actor: AuthContext,
    meta: RequestMeta,
  ): Promise<{ updated: number }> {
    const ids = items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length) throw Errors.validation('A product is listed twice');
    return this.ds.transaction(async (m) => {
      const products = await m.getRepository(Product).findBy(ids.map((id) => ({ id })));
      if (products.length !== ids.length) throw Errors.validation('Some products were not found');
      const byId = new Map(products.map((p) => [p.id, p]));
      let updated = 0;
      for (const item of items) {
        const p = byId.get(item.productId)!;
        const patch: Partial<Product> = {};
        if (item.sellingPricePaise !== undefined && item.sellingPricePaise !== p.sellingPricePaise) {
          patch.sellingPricePaise = item.sellingPricePaise;
        }
        if (item.purchasePricePaise !== undefined && p.kind === 'STANDARD' && item.purchasePricePaise !== p.purchasePricePaise) {
          patch.purchasePricePaise = item.purchasePricePaise;
        }
        if (!Object.keys(patch).length) continue;
        await m.getRepository(Product).update(p.id, { ...patch, updatedBy: actor.userId });
        await this.audit.log(
          {
            actorId: actor.userId,
            actorUsername: actor.username,
            action: 'PRODUCT_PRICE_CHANGED',
            entityType: 'product',
            entityId: p.id,
            before: { sellingPricePaise: p.sellingPricePaise, purchasePricePaise: p.purchasePricePaise },
            after: patch,
            metadata: { bulk: true },
            ip: meta.ip,
            requestId: meta.requestId,
          },
          m,
        );
        updated++;
      }
      return { updated };
    });
  }

  // ------------------------------------------------------------- CSV I/O
  static readonly CSV_COLUMNS = [
    'sku',
    'name',
    'category',
    'unitType',
    'sellingPrice',
    'purchasePrice',
    'mrp',
    'minStockAlert',
    'barcode',
    'isActive',
    'isFavorite',
    'description',
    'openingStock',
  ];

  async exportCsv(viewCost: boolean): Promise<string> {
    const rows: (ProductRow & { available_quantity: number })[] = await this.ds.query(
      `SELECT ${PRODUCT_SELECT} ${PRODUCT_FROM} ORDER BY c.sort_order, p.name`,
    );
    const header = ['sku', 'name', 'category', 'kind', 'unitType', 'sellingPrice', ...(viewCost ? ['purchasePrice'] : []), 'mrp', 'minStockAlert', 'barcode', 'isActive', 'isFavorite', 'availableQuantity', 'description'];
    const data = rows.map((r) => [
      r.sku,
      r.name,
      r.category_name,
      r.kind,
      r.unit_type,
      paiseToDecimalString(Number(r.selling_price_paise)),
      ...(viewCost ? [paiseToDecimalString(Number(r.cost_paise))] : []),
      r.mrp_paise === null ? '' : paiseToDecimalString(Number(r.mrp_paise)),
      r.min_stock_alert,
      r.barcode ?? '',
      r.is_active,
      r.is_favorite,
      r.available_quantity,
      r.description ?? '',
    ]);
    return stringify([header, ...data]);
  }

  /** All-or-nothing CSV import (create or update by SKU). Bundles cannot be imported. */
  async importCsv(buffer: Buffer, dryRun: boolean, actor: AuthContext, meta: RequestMeta) {
    let records: Record<string, string>[];
    try {
      records = parse(buffer, { columns: (h: string[]) => h.map((x) => x.trim()), skip_empty_lines: true, trim: true, bom: true });
    } catch (err) {
      throw Errors.validation(`Could not read CSV: ${(err as Error).message}`);
    }
    if (records.length === 0) throw Errors.validation('The CSV file has no rows');
    if (records.length > 5000) throw Errors.validation('Import at most 5000 rows at a time');
    const missing = ['sku', 'name', 'category', 'sellingPrice'].filter((c) => !(c in records[0]));
    if (missing.length) throw Errors.validation(`Missing required column(s): ${missing.join(', ')}`);

    const cats: { id: string; name: string; is_active: boolean }[] = await this.ds.query(
      `SELECT id, lower(name::text) AS name, is_active FROM product_categories`,
    );
    const catByName = new Map(cats.map((c) => [c.name, c]));
    const settings = await this.settings.getEntity();
    const errors: ImportRowError[] = [];
    const seen = new Set<string>();
    const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : ['true', '1', 'yes', 'y'].includes(v.toLowerCase()));

    type Parsed = {
      row: number;
      sku: string;
      name: string;
      categoryId: string;
      unitType: UnitType;
      sellingPricePaise: number;
      purchasePricePaise: number | null;
      mrpPaise: number | null;
      minStockAlert: number | null;
      barcode: string | null;
      isActive: boolean;
      isFavorite: boolean;
      description: string | null;
      openingStock: number;
    };
    const parsed: Parsed[] = [];
    records.forEach((r, i) => {
      const row = i + 2; // header is row 1
      const err = (field: string, message: string) => errors.push({ row, field, message });
      const sku = normalizeSku(r.sku ?? '');
      if (!SKU_PATTERN.test(sku)) err('sku', 'Invalid SKU');
      else if (seen.has(sku)) err('sku', 'Duplicate SKU in file');
      seen.add(sku);
      const name = (r.name ?? '').trim();
      if (name.length < 2 || name.length > 120) err('name', 'Name must be 2–120 characters');
      const cat = catByName.get((r.category ?? '').trim().toLowerCase());
      if (!cat) err('category', `Unknown category "${r.category}"`);
      else if (!cat.is_active) err('category', 'Category is inactive');
      const unitType = ((r.unitType ?? '').trim().toUpperCase() || 'PIECE') as UnitType;
      if (!UNIT_TYPES.includes(unitType)) err('unitType', `Unit must be one of ${UNIT_TYPES.join(', ')}`);
      const selling = tryRupeesToPaise(r.sellingPrice);
      if (selling === null) err('sellingPrice', 'Invalid selling price');
      const purchase = r.purchasePrice ? tryRupeesToPaise(r.purchasePrice) : null;
      if (r.purchasePrice && purchase === null) err('purchasePrice', 'Invalid purchase price');
      const mrp = r.mrp ? tryRupeesToPaise(r.mrp) : null;
      if (r.mrp && mrp === null) err('mrp', 'Invalid MRP');
      const minAlert = r.minStockAlert ? Number(r.minStockAlert) : null;
      if (minAlert !== null && (!Number.isInteger(minAlert) || minAlert < 0)) err('minStockAlert', 'Must be a whole number ≥ 0');
      const opening = r.openingStock ? Number(r.openingStock) : 0;
      if (!Number.isInteger(opening) || opening < 0) err('openingStock', 'Must be a whole number ≥ 0');
      const barcode = (r.barcode ?? '').trim() || null;
      if (barcode && barcode.length > 64) err('barcode', 'Barcode too long');
      parsed.push({
        row,
        sku,
        name,
        categoryId: cat?.id ?? '',
        unitType,
        sellingPricePaise: selling ?? 0,
        purchasePricePaise: purchase,
        mrpPaise: mrp,
        minStockAlert: minAlert,
        barcode,
        isActive: bool(r.isActive, true),
        isFavorite: bool(r.isFavorite, false),
        description: (r.description ?? '').trim() || null,
        openingStock: opening,
      });
    });

    const existing: { id: string; sku: string; kind: ProductKind; has_opening_stock: boolean }[] = await this.ds.query(
      `SELECT id, upper(sku::text) AS sku, kind, has_opening_stock FROM products WHERE sku = ANY($1::citext[])`,
      [parsed.map((p) => p.sku)],
    );
    const bySku = new Map(existing.map((e) => [e.sku, e]));
    for (const p of parsed) {
      const e = bySku.get(p.sku);
      if (e?.kind === 'BUNDLE') errors.push({ row: p.row, field: 'sku', message: 'This SKU is a bundle; bundles cannot be imported' });
      if (e && p.openingStock > 0 && e.has_opening_stock) {
        errors.push({ row: p.row, field: 'openingStock', message: 'Product already has opening stock; use a stock receipt' });
      }
    }

    const summary = {
      dryRun,
      rows: parsed.length,
      toCreate: parsed.filter((p) => !bySku.has(p.sku)).length,
      toUpdate: parsed.filter((p) => bySku.has(p.sku)).length,
      errors: errors.sort((a, b) => a.row - b.row),
      created: 0,
      updated: 0,
    };
    if (errors.length || dryRun) return summary;

    try {
      await this.ds.transaction(async (m) => {
        for (const p of parsed) {
          const e = bySku.get(p.sku);
          let productId: string;
          if (e) {
            productId = e.id;
            await m.getRepository(Product).update(e.id, {
              name: p.name,
              categoryId: p.categoryId,
              unitType: p.unitType,
              sellingPricePaise: p.sellingPricePaise,
              ...(p.purchasePricePaise !== null ? { purchasePricePaise: p.purchasePricePaise } : {}),
              mrpPaise: p.mrpPaise,
              ...(p.minStockAlert !== null ? { minStockAlert: p.minStockAlert } : {}),
              barcode: p.barcode,
              isActive: p.isActive,
              isFavorite: p.isFavorite,
              description: p.description,
              updatedBy: actor.userId,
            });
            summary.updated++;
          } else {
            const saved = await m.getRepository(Product).save(
              m.getRepository(Product).create({
                sku: p.sku,
                name: p.name,
                categoryId: p.categoryId,
                kind: 'STANDARD',
                unitType: p.unitType,
                sellingPricePaise: p.sellingPricePaise,
                purchasePricePaise: p.purchasePricePaise ?? 0,
                mrpPaise: p.mrpPaise,
                minStockAlert: p.minStockAlert ?? settings.defaultMinStockAlert,
                barcode: p.barcode,
                isActive: p.isActive,
                isFavorite: p.isFavorite,
                description: p.description,
                createdBy: actor.userId,
                updatedBy: actor.userId,
              }),
            );
            productId = saved.id;
            await m.getRepository(StockBalance).insert({ productId, quantity: 0 });
            summary.created++;
          }
          if (p.openingStock > 0) {
            await this.stock.apply(
              m,
              [
                {
                  productId,
                  change: p.openingStock,
                  type: StockMovementType.OPENING,
                  referenceType: StockReferenceType.OPENING,
                  reason: 'Opening stock (CSV import)',
                  unitCostPaise: p.purchasePricePaise,
                },
              ],
              actor.userId,
            );
            await m.getRepository(Product).update(productId, { hasOpeningStock: true });
          }
        }
        await this.audit.log(
          {
            actorId: actor.userId,
            actorUsername: actor.username,
            action: 'PRODUCTS_IMPORTED',
            entityType: 'product',
            metadata: { created: summary.created, updated: summary.updated, rows: parsed.length },
            ip: meta.ip,
            requestId: meta.requestId,
          },
          m,
        );
      });
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION) {
        throw Errors.duplicate('Import failed: a barcode or SKU conflicts with an existing product. Nothing was imported.');
      }
      throw err;
    }
    return summary;
  }

  /** Exposed for the availability SQL in other modules. */
  static availableSql = AVAILABLE_SQL;
}
