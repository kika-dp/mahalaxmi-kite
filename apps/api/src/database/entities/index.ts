import { Product, ProductBundleItem, ProductCategory, StockBalance, Supplier } from './catalog.entities';
import {
  AuditLog,
  DocumentSequence,
  SeasonEntity,
  ShopSettingsEntity,
  User,
  UserSession,
} from './identity.entities';
import {
  StockAdjustmentEntity,
  StockCountEntity,
  StockCountItemEntity,
  StockMovementEntity,
} from './inventory.entities';
import {
  CashMovementEntity,
  CashSessionEntity,
  CustomerEntity,
  InvoiceEntity,
  InvoiceItemComponentEntity,
  InvoiceItemEntity,
  PaymentEntity,
  PurchaseEntity,
  PurchaseItemEntity,
  ReturnEntity,
  ReturnItemEntity,
  SupplierPaymentEntity,
} from './sales.entities';

export * from './catalog.entities';
export * from './identity.entities';
export * from './inventory.entities';
export * from './sales.entities';

export const ENTITIES = [
  User,
  UserSession,
  ShopSettingsEntity,
  SeasonEntity,
  AuditLog,
  DocumentSequence,
  ProductCategory,
  Supplier,
  Product,
  ProductBundleItem,
  StockBalance,
  StockMovementEntity,
  StockAdjustmentEntity,
  StockCountEntity,
  StockCountItemEntity,
  CustomerEntity,
  InvoiceEntity,
  InvoiceItemEntity,
  InvoiceItemComponentEntity,
  PaymentEntity,
  ReturnEntity,
  ReturnItemEntity,
  PurchaseEntity,
  PurchaseItemEntity,
  SupplierPaymentEntity,
  CashSessionEntity,
  CashMovementEntity,
];
