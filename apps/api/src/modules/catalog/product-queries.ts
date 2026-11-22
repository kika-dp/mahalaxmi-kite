import { Product as ProductDto, ProductKind, UnitType } from '@kite/shared';
import { publicUrl } from '../../common/utils/uploads';

/**
 * SQL expression for a product's sellable quantity.
 * STANDARD → its balance. BUNDLE → min(floor(component balance / qty)); 0 if any component is inactive.
 */
export const AVAILABLE_SQL = (p = 'p') => `
  CASE WHEN ${p}.kind = 'STANDARD' THEN COALESCE((SELECT sb.quantity FROM stock_balances sb WHERE sb.product_id = ${p}.id), 0)
  ELSE COALESCE((
    SELECT MIN(CASE WHEN cp.is_active THEN FLOOR(cb.quantity::numeric / bi.quantity) ELSE 0 END)::int
    FROM product_bundle_items bi
    JOIN products cp ON cp.id = bi.component_product_id
    JOIN stock_balances cb ON cb.product_id = bi.component_product_id
    WHERE bi.bundle_product_id = ${p}.id), 0)
  END`;

/** Effective unit cost: own purchase price, or Σ component cost × qty for bundles. */
export const COST_SQL = (p = 'p') => `
  CASE WHEN ${p}.kind = 'STANDARD' THEN ${p}.purchase_price_paise
  ELSE COALESCE((
    SELECT SUM(cp.purchase_price_paise * bi.quantity)
    FROM product_bundle_items bi JOIN products cp ON cp.id = bi.component_product_id
    WHERE bi.bundle_product_id = ${p}.id), 0)
  END`;

export const PRODUCT_SELECT = `
  p.id, p.sku::text AS sku, p.barcode, p.name, p.description, p.category_id, c.name::text AS category_name,
  p.kind, p.unit_type, p.selling_price_paise::bigint AS selling_price_paise, p.mrp_paise,
  (${COST_SQL('p')})::bigint AS cost_paise,
  p.min_stock_alert, p.supplier_id, s.name AS supplier_name, p.image_url, p.is_active, p.is_favorite,
  p.favorite_order, p.has_opening_stock, p.created_at, p.updated_at,
  (${AVAILABLE_SQL('p')})::int AS available_quantity`;

export const PRODUCT_FROM = `
  FROM products p
  JOIN product_categories c ON c.id = p.category_id
  LEFT JOIN suppliers s ON s.id = p.supplier_id`;

export interface ProductRow {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  category_id: string;
  category_name: string;
  kind: ProductKind;
  unit_type: UnitType;
  selling_price_paise: string;
  mrp_paise: string | null;
  cost_paise: string;
  min_stock_alert: number;
  supplier_id: string | null;
  supplier_name: string | null;
  image_url: string | null;
  is_active: boolean;
  is_favorite: boolean;
  favorite_order: number;
  has_opening_stock: boolean;
  created_at: Date;
  updated_at: Date;
  available_quantity: number;
}

export function mapProductRow(r: ProductRow, viewCost: boolean): ProductDto {
  const available = Number(r.available_quantity);
  return {
    id: r.id,
    sku: r.sku,
    barcode: r.barcode,
    name: r.name,
    description: r.description,
    categoryId: r.category_id,
    categoryName: r.category_name,
    kind: r.kind,
    unitType: r.unit_type,
    sellingPricePaise: Number(r.selling_price_paise),
    mrpPaise: r.mrp_paise === null ? null : Number(r.mrp_paise),
    ...(viewCost ? { purchasePricePaise: Number(r.cost_paise) } : {}),
    minStockAlert: r.min_stock_alert,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    imageUrl: publicUrl(r.image_url),
    isActive: r.is_active,
    isFavorite: r.is_favorite,
    favoriteOrder: r.favorite_order,
    availableQuantity: available,
    isLowStock: r.kind === 'STANDARD' && available <= r.min_stock_alert,
    hasOpeningStock: r.has_opening_stock,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}
