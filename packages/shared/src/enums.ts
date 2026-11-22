export const Role = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  INVENTORY_MANAGER: 'INVENTORY_MANAGER',
  SALESPERSON: 'SALESPERSON',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const ROLES = Object.values(Role);

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  INVENTORY_MANAGER: 'Inventory Manager',
  SALESPERSON: 'Salesperson',
};

export const ProductKind = { STANDARD: 'STANDARD', BUNDLE: 'BUNDLE' } as const;
export type ProductKind = (typeof ProductKind)[keyof typeof ProductKind];
export const PRODUCT_KINDS = Object.values(ProductKind);

export const UnitType = {
  PIECE: 'PIECE',
  PACKET: 'PACKET',
  BUNDLE: 'BUNDLE',
  BOX: 'BOX',
  DOZEN: 'DOZEN',
  ROLL: 'ROLL',
} as const;
export type UnitType = (typeof UnitType)[keyof typeof UnitType];
export const UNIT_TYPES = Object.values(UnitType);
export const UNIT_LABELS: Record<UnitType, string> = {
  PIECE: 'pc',
  PACKET: 'pkt',
  BUNDLE: 'bdl',
  BOX: 'box',
  DOZEN: 'dz',
  ROLL: 'roll',
};

export const StockMovementType = {
  OPENING: 'OPENING',
  PURCHASE_RECEIPT: 'PURCHASE_RECEIPT',
  ADJUSTMENT_IN: 'ADJUSTMENT_IN',
  ADJUSTMENT_OUT: 'ADJUSTMENT_OUT',
  DAMAGED: 'DAMAGED',
  LOST: 'LOST',
  COUNT_CORRECTION: 'COUNT_CORRECTION',
  SALE: 'SALE',
  SALE_RETURN: 'SALE_RETURN',
  VOID_RESTORE: 'VOID_RESTORE',
  TRANSFER_IN: 'TRANSFER_IN',
  TRANSFER_OUT: 'TRANSFER_OUT',
} as const;
export type StockMovementType = (typeof StockMovementType)[keyof typeof StockMovementType];
export const STOCK_MOVEMENT_TYPES = Object.values(StockMovementType);

export const StockReferenceType = {
  INVOICE: 'INVOICE',
  RETURN: 'RETURN',
  VOID: 'VOID',
  PURCHASE: 'PURCHASE',
  RECEIPT: 'RECEIPT',
  ADJUSTMENT: 'ADJUSTMENT',
  STOCK_COUNT: 'STOCK_COUNT',
  OPENING: 'OPENING',
} as const;
export type StockReferenceType = (typeof StockReferenceType)[keyof typeof StockReferenceType];
export const STOCK_REFERENCE_TYPES = Object.values(StockReferenceType);

export const AdjustmentType = {
  ADJUSTMENT_IN: 'ADJUSTMENT_IN',
  ADJUSTMENT_OUT: 'ADJUSTMENT_OUT',
  DAMAGED: 'DAMAGED',
  LOST: 'LOST',
} as const;
export type AdjustmentType = (typeof AdjustmentType)[keyof typeof AdjustmentType];
export const ADJUSTMENT_TYPES = Object.values(AdjustmentType);
/** Adjustment types that increase stock. All others decrease it. */
export const INCREASING_ADJUSTMENTS: readonly AdjustmentType[] = [AdjustmentType.ADJUSTMENT_IN];

export const AdjustmentStatus = { PENDING: 'PENDING', APPLIED: 'APPLIED', REJECTED: 'REJECTED' } as const;
export type AdjustmentStatus = (typeof AdjustmentStatus)[keyof typeof AdjustmentStatus];

export const StockCountStatus = { OPEN: 'OPEN', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED' } as const;
export type StockCountStatus = (typeof StockCountStatus)[keyof typeof StockCountStatus];

export const DiscountType = { NONE: 'NONE', FIXED: 'FIXED', PERCENT: 'PERCENT' } as const;
export type DiscountType = (typeof DiscountType)[keyof typeof DiscountType];

export const InvoiceStatus = { FINALIZED: 'FINALIZED', VOID: 'VOID' } as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];
export const INVOICE_STATUSES = Object.values(InvoiceStatus);

export const PaymentStatus = {
  UNPAID: 'UNPAID',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];
export const PAYMENT_STATUSES = Object.values(PaymentStatus);
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
  REFUNDED: 'Refunded',
};

export const PaymentMethod = { CASH: 'CASH', UPI: 'UPI', CARD: 'CARD', OTHER: 'OTHER' } as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];
export const PAYMENT_METHODS = Object.values(PaymentMethod);
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  CARD: 'Card',
  OTHER: 'Other',
};

export const PaymentDirection = { IN: 'IN', OUT: 'OUT' } as const;
export type PaymentDirection = (typeof PaymentDirection)[keyof typeof PaymentDirection];

export const CashSessionStatus = { OPEN: 'OPEN', CLOSED: 'CLOSED' } as const;
export type CashSessionStatus = (typeof CashSessionStatus)[keyof typeof CashSessionStatus];

export const CashMovementType = {
  PAYOUT: 'PAYOUT',
  EXPENSE: 'EXPENSE',
  OTHER_RECEIPT: 'OTHER_RECEIPT',
} as const;
export type CashMovementType = (typeof CashMovementType)[keyof typeof CashMovementType];
export const CASH_MOVEMENT_TYPES = Object.values(CashMovementType);

export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  FORBIDDEN: 'FORBIDDEN',
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  DISCOUNT_APPROVAL_REQUIRED: 'DISCOUNT_APPROVAL_REQUIRED',
  DISCOUNT_APPROVAL_INVALID: 'DISCOUNT_APPROVAL_INVALID',
  NOT_FOUND: 'NOT_FOUND',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  IDEMPOTENCY_KEY_CONFLICT: 'IDEMPOTENCY_KEY_CONFLICT',
  DUPLICATE: 'DUPLICATE',
  INVALID_STATE: 'INVALID_STATE',
  CONCURRENT_MODIFICATION: 'CONCURRENT_MODIFICATION',
  PRODUCT_UNAVAILABLE: 'PRODUCT_UNAVAILABLE',
  DISCOUNT_EXCEEDS_AMOUNT: 'DISCOUNT_EXCEEDS_AMOUNT',
  OVERPAYMENT: 'OVERPAYMENT',
  REFUND_EXCEEDS_CREDIT: 'REFUND_EXCEEDS_CREDIT',
  RETURN_EXCEEDS_SOLD: 'RETURN_EXCEEDS_SOLD',
  CUSTOMER_REQUIRED_FOR_CREDIT: 'CUSTOMER_REQUIRED_FOR_CREDIT',
  BUSINESS_RULE: 'BUSINESS_RULE',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
