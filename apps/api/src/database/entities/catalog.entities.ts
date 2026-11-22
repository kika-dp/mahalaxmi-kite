import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ProductKind, UnitType } from '@kite/shared';
import { bigintNumber } from '../transformers';

@Entity('product_categories')
export class ProductCategory {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'citext', unique: true }) name: string;
  @Column({ type: 'int', default: 0 }) sortOrder: number;
  @Column({ type: 'boolean', default: true }) isActive: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

@Entity('suppliers')
export class Supplier {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 120 }) name: string;
  @Column({ type: 'varchar', length: 15, nullable: true }) phone: string | null;
  @Column({ type: 'text', nullable: true }) address: string | null;
  @Column({ type: 'text', nullable: true }) notes: string | null;
  @Column({ type: 'boolean', default: true }) isActive: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'citext', unique: true }) sku: string;
  @Column({ type: 'varchar', length: 64, nullable: true, unique: true }) barcode: string | null;
  @Column({ type: 'varchar', length: 120 }) name: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column('uuid') categoryId: string;
  @ManyToOne(() => ProductCategory) @JoinColumn({ name: 'category_id' }) category: ProductCategory;
  @Column({ type: 'varchar', length: 10 }) kind: ProductKind;
  @Column({ type: 'varchar', length: 10 }) unitType: UnitType;
  @Column({ type: 'bigint', default: 0, transformer: bigintNumber }) purchasePricePaise: number;
  @Column({ type: 'bigint', transformer: bigintNumber }) sellingPricePaise: number;
  @Column({ type: 'bigint', nullable: true, transformer: bigintNumber }) mrpPaise: number | null;
  @Column({ type: 'int', default: 10 }) minStockAlert: number;
  @Column({ type: 'uuid', nullable: true }) supplierId: string | null;
  @ManyToOne(() => Supplier, { nullable: true }) @JoinColumn({ name: 'supplier_id' }) supplier: Supplier | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) imageUrl: string | null;
  @Column({ type: 'boolean', default: true }) isActive: boolean;
  @Column({ type: 'boolean', default: false }) isFavorite: boolean;
  @Column({ type: 'int', default: 0 }) favoriteOrder: number;
  @Column({ type: 'boolean', default: false }) hasOpeningStock: boolean;
  @Column({ type: 'uuid', nullable: true }) createdBy: string | null;
  @Column({ type: 'uuid', nullable: true }) updatedBy: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
  @OneToMany(() => ProductBundleItem, (b) => b.bundleProduct) bundleItems: ProductBundleItem[];
  @OneToOne(() => StockBalance, (s) => s.product) stock: StockBalance | null;
}

@Entity('product_bundle_items')
export class ProductBundleItem {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') bundleProductId: string;
  @ManyToOne(() => Product, (p) => p.bundleItems, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bundle_product_id' })
  bundleProduct: Product;
  @Column('uuid') componentProductId: string;
  @ManyToOne(() => Product) @JoinColumn({ name: 'component_product_id' }) componentProduct: Product;
  @Column('int') quantity: number;
}

@Entity('stock_balances')
export class StockBalance {
  @PrimaryColumn('uuid') productId: string;
  @OneToOne(() => Product, (p) => p.stock) @JoinColumn({ name: 'product_id' }) product: Product;
  @Column({ type: 'int', default: 0 }) quantity: number;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}
