/**
 * OPTIONAL demo catalog for local development (`seed:dev -- --with-demo-catalog`).
 * Never runs automatically, so production dashboards never contain dummy data.
 * Opening stock goes through StockService so the ledger is consistent.
 */
import { DataSource } from 'typeorm';
import { StockMovementType, StockReferenceType } from '@kite/shared';
import { StockService } from '../../modules/inventory/stock.service';

interface DemoProduct {
  sku: string;
  name: string;
  category: string;
  unit: string;
  price: number; // rupees
  cost: number;
  stock: number;
  min?: number;
  barcode?: string;
  favorite?: number;
}

const STANDARD: DemoProduct[] = [
  { sku: 'KITE-REG-10', name: 'Regular Kite', category: 'Regular Kites', unit: 'PIECE', price: 10, cost: 6, stock: 1500, min: 200, barcode: '8901234500011', favorite: 1 },
  { sku: 'KITE-REG-05', name: 'Small Regular Kite', category: 'Regular Kites', unit: 'PIECE', price: 5, cost: 3, stock: 2000, min: 200, barcode: '8901234500028', favorite: 2 },
  { sku: 'KITE-DES-20', name: 'Designer Kite', category: 'Designer Kites', unit: 'PIECE', price: 20, cost: 12, stock: 600, min: 80, barcode: '8901234500035', favorite: 3 },
  { sku: 'KITE-PRM-50', name: 'Premium Kite', category: 'Premium Kites', unit: 'PIECE', price: 50, cost: 30, stock: 200, min: 10, barcode: '8901234500042', favorite: 4 },
  { sku: 'KITE-KID-15', name: 'Kids Cartoon Kite', category: 'Kids Kites', unit: 'PIECE', price: 15, cost: 9, stock: 300, min: 40 },
  { sku: 'MANJHA-1000', name: 'Manjha 1000 m', category: 'Manjha', unit: 'ROLL', price: 100, cost: 65, stock: 150, min: 20, barcode: '8901234500059', favorite: 5 },
  { sku: 'MANJHA-2500', name: 'Manjha 2500 m', category: 'Manjha', unit: 'ROLL', price: 200, cost: 130, stock: 80, min: 10 },
  { sku: 'FIRKI-WOOD', name: 'Wooden Firki', category: 'Firki', unit: 'PIECE', price: 200, cost: 120, stock: 60, min: 10, barcode: '8901234500066', favorite: 6 },
  { sku: 'THREAD-COT', name: 'Cotton Kite Thread', category: 'Kite Threads', unit: 'ROLL', price: 60, cost: 35, stock: 100, min: 15 },
  { sku: 'ACC-TAPE', name: 'Kite Repair Tape', category: 'Accessories', unit: 'ROLL', price: 20, cost: 10, stock: 200, min: 20 },
  { sku: 'ACC-GUARD', name: 'Finger Guard', category: 'Accessories', unit: 'PIECE', price: 10, cost: 5, stock: 300, min: 30 },
];

const BUNDLES = [
  { sku: 'PKT-REG-10', name: 'Regular Kite Packet (10)', category: 'Regular Kites', unit: 'PACKET', price: 90, favorite: 7, items: [['KITE-REG-10', 10]] },
  {
    sku: 'COMBO-START',
    name: 'Uttarayan Starter Kit',
    category: 'Other Products',
    unit: 'BUNDLE',
    price: 399,
    favorite: 8,
    items: [['KITE-REG-10', 10], ['FIRKI-WOOD', 1], ['MANJHA-1000', 1]],
  },
] as const;

export async function seedDemoCatalog(ds: DataSource): Promise<number> {
  const stock = new StockService();
  return ds.transaction(async (m) => {
    const cats: { id: string; name: string }[] = await m.query(`SELECT id, name::text AS name FROM product_categories`);
    const catId = (name: string) => cats.find((c) => c.name === name)!.id;
    const ids = new Map<string, string>();
    let created = 0;
    for (const p of STANDARD) {
      const [existing] = await m.query(`SELECT id FROM products WHERE sku = $1`, [p.sku]);
      if (existing) {
        ids.set(p.sku, existing.id);
        continue;
      }
      const [row] = await m.query(
        `INSERT INTO products (sku, barcode, name, category_id, kind, unit_type, purchase_price_paise, selling_price_paise,
           min_stock_alert, is_favorite, favorite_order, has_opening_stock)
         VALUES ($1,$2,$3,$4,'STANDARD',$5,$6,$7,$8,$9,$10,true) RETURNING id`,
        [p.sku, p.barcode ?? null, p.name, catId(p.category), p.unit, p.cost * 100, p.price * 100, p.min ?? 10, !!p.favorite, p.favorite ?? 0],
      );
      ids.set(p.sku, row.id);
      await m.query(`INSERT INTO stock_balances (product_id, quantity) VALUES ($1, 0)`, [row.id]);
      await stock.apply(
        m,
        [{ productId: row.id, change: p.stock, type: StockMovementType.OPENING, referenceType: StockReferenceType.OPENING, reason: 'Demo opening stock', unitCostPaise: p.cost * 100 }],
        null,
      );
      created++;
    }
    for (const b of BUNDLES) {
      const [existing] = await m.query(`SELECT id FROM products WHERE sku = $1`, [b.sku]);
      if (existing) continue;
      const [row] = await m.query(
        `INSERT INTO products (sku, name, category_id, kind, unit_type, selling_price_paise, min_stock_alert, is_favorite, favorite_order)
         VALUES ($1,$2,$3,'BUNDLE',$4,$5,0,true,$6) RETURNING id`,
        [b.sku, b.name, catId(b.category), b.unit, b.price * 100, b.favorite],
      );
      for (const [sku, qty] of b.items) {
        await m.query(`INSERT INTO product_bundle_items (bundle_product_id, component_product_id, quantity) VALUES ($1,$2,$3)`, [row.id, ids.get(sku), qty]);
      }
      created++;
    }
    return created;
  });
}
