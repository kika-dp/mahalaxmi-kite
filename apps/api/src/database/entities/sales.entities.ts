import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  CashMovementType,
  CashSessionStatus,
  DiscountType,
  InvoiceStatus,
  PaymentDirection,
  PaymentMethod,
  PaymentStatus,
  ProductKind,
  UnitType,
} from '@kite/shared';
import { bigintNumber } from '../transformers';
import { Product, Supplier } from './catalog.entities';
import { User } from './identity.entities';

const money = { type: 'bigint' as const, default: 0, transformer: bigintNumber };

@Entity('customers')
export class CustomerEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 100 }) name: string;
  @Column({ type: 'varchar', length: 10, nullable: true, unique: true }) phone: string | null;
  @Column({ type: 'text', nullable: true }) address: string | null;
  @Column({ type: 'text', nullable: true }) notes: string | null;
  @Column({ type: 'timestamptz', nullable: true }) lastPurchaseAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

@Entity('invoices')
export class InvoiceEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 30, unique: true }) invoiceNumber: string;
  @Column({ type: 'uuid', unique: true }) idempotencyKey: string;
  @Column({ type: 'char', length: 64 }) requestHash: string;
  @Column({ type: 'uuid', nullable: true }) seasonId: string | null;
  @Column({ type: 'varchar', length: 10 }) status: InvoiceStatus;
  @Column({ type: 'varchar', length: 16 }) paymentStatus: PaymentStatus;
  @Column('uuid') salespersonId: string;
  @ManyToOne(() => User) @JoinColumn({ name: 'salesperson_id' }) salesperson: User;
  @Column({ type: 'uuid', nullable: true }) customerId: string | null;
  @ManyToOne(() => CustomerEntity, { nullable: true }) @JoinColumn({ name: 'customer_id' }) customer: CustomerEntity | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) customerName: string | null;
  @Column({ type: 'varchar', length: 10, nullable: true }) customerPhone: string | null;
  @Column(money) grossSubtotalPaise: number;
  @Column(money) lineDiscountTotalPaise: number;
  @Column({ type: 'varchar', length: 8, default: 'NONE' }) billDiscountType: DiscountType;
  @Column(money) billDiscountValue: number;
  @Column(money) billDiscountPaise: number;
  @Column(money) discountTotalPaise: number;
  @Column(money) taxableAmountPaise: number;
  @Column({ type: 'int', default: 0 }) taxRateBps: number;
  @Column(money) taxPaise: number;
  @Column(money) totalPaise: number;
  @Column(money) costTotalPaise: number;
  @Column(money) returnedAmountPaise: number;
  @Column(money) amountPaidPaise: number;
  @Column(money) amountRefundedPaise: number;
  @Column(money) outstandingPaise: number;
  @Column({ type: 'varchar', length: 200, nullable: true }) discountReason: string | null;
  @Column({ type: 'uuid', nullable: true }) discountAppliedById: string | null;
  @ManyToOne(() => User, { nullable: true }) @JoinColumn({ name: 'discount_applied_by_id' }) discountAppliedBy: User | null;
  @Column({ type: 'uuid', nullable: true }) discountApprovedById: string | null;
  @ManyToOne(() => User, { nullable: true }) @JoinColumn({ name: 'discount_approved_by_id' }) discountApprovedBy: User | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) notes: string | null;
  @Column({ type: 'timestamptz', nullable: true }) voidedAt: Date | null;
  @Column({ type: 'uuid', nullable: true }) voidedById: string | null;
  @ManyToOne(() => User, { nullable: true }) @JoinColumn({ name: 'voided_by_id' }) voidedBy: User | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) voidReason: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
  @OneToMany(() => InvoiceItemEntity, (i) => i.invoice) items: InvoiceItemEntity[];
  @OneToMany(() => PaymentEntity, (p) => p.invoice) payments: PaymentEntity[];
  @OneToMany(() => ReturnEntity, (r) => r.invoice) returns: ReturnEntity[];
}

@Entity('invoice_items')
export class InvoiceItemEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') invoiceId: string;
  @ManyToOne(() => InvoiceEntity, (i) => i.items, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'invoice_id' }) invoice: InvoiceEntity;
  @Column('int') lineNo: number;
  @Column('uuid') productId: string;
  @ManyToOne(() => Product) @JoinColumn({ name: 'product_id' }) product: Product;
  @Column({ type: 'varchar', length: 120 }) productName: string;
  @Column({ type: 'varchar', length: 40 }) sku: string;
  @Column({ type: 'varchar', length: 10 }) unitType: UnitType;
  @Column({ type: 'varchar', length: 10 }) kind: ProductKind;
  @Column('int') quantity: number;
  @Column(money) unitPricePaise: number;
  @Column(money) unitCostPaise: number;
  @Column(money) grossPaise: number;
  @Column({ type: 'varchar', length: 8, default: 'NONE' }) lineDiscountType: DiscountType;
  @Column(money) lineDiscountValue: number;
  @Column(money) lineDiscountPaise: number;
  @Column(money) billDiscountAllocPaise: number;
  @Column(money) taxAllocPaise: number;
  @Column(money) lineTotalPaise: number;
  @Column({ type: 'int', default: 0 }) returnedQuantity: number;
  @Column({ type: 'varchar', length: 200, nullable: true }) note: string | null;
  @OneToMany(() => InvoiceItemComponentEntity, (c) => c.invoiceItem) components: InvoiceItemComponentEntity[];
}

@Entity('invoice_item_components')
export class InvoiceItemComponentEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') invoiceItemId: string;
  @ManyToOne(() => InvoiceItemEntity, (i) => i.components, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_item_id' })
  invoiceItem: InvoiceItemEntity;
  @Column('uuid') productId: string;
  @ManyToOne(() => Product) @JoinColumn({ name: 'product_id' }) product: Product;
  @Column({ type: 'varchar', length: 120 }) productName: string;
  @Column('int') quantityPerUnit: number;
  @Column(money) unitCostPaise: number;
}

@Entity('payments')
export class PaymentEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') invoiceId: string;
  @ManyToOne(() => InvoiceEntity, (i) => i.payments) @JoinColumn({ name: 'invoice_id' }) invoice: InvoiceEntity;
  @Column({ type: 'varchar', length: 3 }) direction: PaymentDirection;
  @Column({ type: 'varchar', length: 5 }) method: PaymentMethod;
  @Column({ type: 'bigint', transformer: bigintNumber }) amountPaise: number;
  @Column({ type: 'varchar', length: 60, nullable: true }) reference: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) note: string | null;
  @Column('uuid') receivedById: string;
  @ManyToOne(() => User) @JoinColumn({ name: 'received_by_id' }) receivedBy: User;
  @Column({ type: 'uuid', nullable: true }) returnId: string | null;
  @Column({ type: 'uuid', nullable: true }) idempotencyKey: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('returns')
export class ReturnEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 30, unique: true }) returnNumber: string;
  @Column('uuid') invoiceId: string;
  @ManyToOne(() => InvoiceEntity, (i) => i.returns) @JoinColumn({ name: 'invoice_id' }) invoice: InvoiceEntity;
  @Column('text') reason: string;
  @Column(money) totalPaise: number;
  @Column(money) taxPaise: number;
  @Column(money) costPaise: number;
  @Column('uuid') createdById: string;
  @ManyToOne(() => User) @JoinColumn({ name: 'created_by_id' }) createdBy: User;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @OneToMany(() => ReturnItemEntity, (i) => i.salesReturn) items: ReturnItemEntity[];
}

@Entity('return_items')
export class ReturnItemEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') returnId: string;
  @ManyToOne(() => ReturnEntity, (r) => r.items, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'return_id' }) salesReturn: ReturnEntity;
  @Column('uuid') invoiceItemId: string;
  @ManyToOne(() => InvoiceItemEntity) @JoinColumn({ name: 'invoice_item_id' }) invoiceItem: InvoiceItemEntity;
  @Column('uuid') productId: string;
  @Column('int') quantity: number;
  @Column(money) amountPaise: number;
  @Column(money) taxPaise: number;
  @Column(money) costPaise: number;
  @Column('boolean') restocked: boolean;
}

@Entity('purchases')
export class PurchaseEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 30, unique: true }) purchaseNumber: string;
  @Column({ type: 'uuid', nullable: true }) supplierId: string | null;
  @ManyToOne(() => Supplier, { nullable: true }) @JoinColumn({ name: 'supplier_id' }) supplier: Supplier | null;
  @Column({ type: 'date' }) purchaseDate: string;
  @Column(money) subtotalPaise: number;
  @Column(money) amountPaidPaise: number;
  @Column({ type: 'text', nullable: true }) notes: string | null;
  @Column('uuid') createdById: string;
  @ManyToOne(() => User) @JoinColumn({ name: 'created_by_id' }) createdBy: User;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @OneToMany(() => PurchaseItemEntity, (i) => i.purchase) items: PurchaseItemEntity[];
}

@Entity('purchase_items')
export class PurchaseItemEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') purchaseId: string;
  @ManyToOne(() => PurchaseEntity, (p) => p.items, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'purchase_id' }) purchase: PurchaseEntity;
  @Column('uuid') productId: string;
  @ManyToOne(() => Product) @JoinColumn({ name: 'product_id' }) product: Product;
  @Column('int') quantity: number;
  @Column(money) unitCostPaise: number;
  @Column(money) lineTotalPaise: number;
}

@Entity('supplier_payments')
export class SupplierPaymentEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') supplierId: string;
  @ManyToOne(() => Supplier) @JoinColumn({ name: 'supplier_id' }) supplier: Supplier;
  @Column({ type: 'uuid', nullable: true }) purchaseId: string | null;
  @ManyToOne(() => PurchaseEntity, { nullable: true }) @JoinColumn({ name: 'purchase_id' }) purchase: PurchaseEntity | null;
  @Column({ type: 'bigint', transformer: bigintNumber }) amountPaise: number;
  @Column({ type: 'varchar', length: 5 }) method: PaymentMethod;
  @Column({ type: 'varchar', length: 200, nullable: true }) note: string | null;
  @Column({ type: 'timestamptz' }) paidAt: Date;
  @Column('uuid') createdById: string;
  @ManyToOne(() => User) @JoinColumn({ name: 'created_by_id' }) createdBy: User;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('cash_sessions')
export class CashSessionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'date', unique: true }) businessDate: string;
  @Column({ type: 'varchar', length: 6 }) status: CashSessionStatus;
  @Column(money) openingCashPaise: number;
  @Column('uuid') openedById: string;
  @ManyToOne(() => User) @JoinColumn({ name: 'opened_by_id' }) openedBy: User;
  @Column({ type: 'timestamptz' }) openedAt: Date;
  @Column({ type: 'uuid', nullable: true }) closedById: string | null;
  @ManyToOne(() => User, { nullable: true }) @JoinColumn({ name: 'closed_by_id' }) closedBy: User | null;
  @Column({ type: 'timestamptz', nullable: true }) closedAt: Date | null;
  @Column({ type: 'bigint', nullable: true, transformer: bigintNumber }) expectedCashPaise: number | null;
  @Column({ type: 'bigint', nullable: true, transformer: bigintNumber }) countedCashPaise: number | null;
  @Column({ type: 'bigint', nullable: true, transformer: bigintNumber }) differencePaise: number | null;
  @Column({ type: 'text', nullable: true }) notes: string | null;
  @Column({ type: 'jsonb', nullable: true }) summary: unknown;
  @OneToMany(() => CashMovementEntity, (m) => m.cashSession) movements: CashMovementEntity[];
}

@Entity('cash_movements')
export class CashMovementEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') cashSessionId: string;
  @ManyToOne(() => CashSessionEntity, (s) => s.movements) @JoinColumn({ name: 'cash_session_id' }) cashSession: CashSessionEntity;
  @Column({ type: 'varchar', length: 15 }) type: CashMovementType;
  @Column({ type: 'bigint', transformer: bigintNumber }) amountPaise: number;
  @Column({ type: 'varchar', length: 200 }) reason: string;
  @Column('uuid') createdById: string;
  @ManyToOne(() => User) @JoinColumn({ name: 'created_by_id' }) createdBy: User;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
