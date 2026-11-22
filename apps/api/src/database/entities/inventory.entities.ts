import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import type {
  AdjustmentStatus,
  AdjustmentType,
  StockCountStatus,
  StockMovementType,
  StockReferenceType,
} from '@kite/shared';
import { bigintNumber } from '../transformers';
import { Product } from './catalog.entities';
import { User } from './identity.entities';

@Entity('stock_movements')
export class StockMovementEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') productId: string;
  @ManyToOne(() => Product) @JoinColumn({ name: 'product_id' }) product: Product;
  @Column({ type: 'varchar', length: 20 }) movementType: StockMovementType;
  @Column('int') quantityChange: number;
  @Column('int') previousQuantity: number;
  @Column('int') newQuantity: number;
  @Column({ type: 'bigint', nullable: true, transformer: bigintNumber }) unitCostPaise: number | null;
  @Column({ type: 'varchar', length: 20, nullable: true }) referenceType: StockReferenceType | null;
  @Column({ type: 'uuid', nullable: true }) referenceId: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) referenceNumber: string | null;
  @Column({ type: 'text', nullable: true }) reason: string | null;
  @Column({ type: 'uuid', nullable: true }) createdById: string | null;
  @ManyToOne(() => User, { nullable: true }) @JoinColumn({ name: 'created_by_id' }) createdBy: User | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('stock_adjustments')
export class StockAdjustmentEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') productId: string;
  @ManyToOne(() => Product) @JoinColumn({ name: 'product_id' }) product: Product;
  @Column({ type: 'varchar', length: 20 }) adjustmentType: AdjustmentType;
  @Column('int') quantity: number;
  @Column('text') reason: string;
  @Column({ type: 'varchar', length: 10 }) status: AdjustmentStatus;
  @Column('uuid') requestedById: string;
  @ManyToOne(() => User) @JoinColumn({ name: 'requested_by_id' }) requestedBy: User;
  @Column({ type: 'uuid', nullable: true }) decidedById: string | null;
  @ManyToOne(() => User, { nullable: true }) @JoinColumn({ name: 'decided_by_id' }) decidedBy: User | null;
  @Column({ type: 'timestamptz', nullable: true }) decidedAt: Date | null;
  @Column({ type: 'text', nullable: true }) decisionNote: string | null;
  @Column({ type: 'uuid', nullable: true }) movementId: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('stock_counts')
export class StockCountEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 30, unique: true }) countNumber: string;
  @Column({ type: 'varchar', length: 10 }) status: StockCountStatus;
  @Column({ type: 'text', nullable: true }) notes: string | null;
  @Column('uuid') createdById: string;
  @ManyToOne(() => User) @JoinColumn({ name: 'created_by_id' }) createdBy: User;
  @Column({ type: 'uuid', nullable: true }) completedById: string | null;
  @ManyToOne(() => User, { nullable: true }) @JoinColumn({ name: 'completed_by_id' }) completedBy: User | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) completedAt: Date | null;
  @OneToMany(() => StockCountItemEntity, (i) => i.stockCount) items: StockCountItemEntity[];
}

@Entity('stock_count_items')
export class StockCountItemEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') stockCountId: string;
  @ManyToOne(() => StockCountEntity, (c) => c.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'stock_count_id' })
  stockCount: StockCountEntity;
  @Column('uuid') productId: string;
  @ManyToOne(() => Product) @JoinColumn({ name: 'product_id' }) product: Product;
  @Column('int') systemQuantity: number;
  @Column('int') countedQuantity: number;
  @Column('int') variance: number;
  @Column('uuid') countedById: string;
  @Column({ type: 'timestamptz' }) countedAt: Date;
}
