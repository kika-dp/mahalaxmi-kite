/** API contract types shared by the API, CRM and mobile app (api-specification.md). */
import type {
  AdjustmentStatus,
  AdjustmentType,
  CashMovementType,
  CashSessionStatus,
  DiscountType,
  ErrorCode,
  InvoiceStatus,
  PaymentDirection,
  PaymentMethod,
  PaymentStatus,
  ProductKind,
  Role,
  StockCountStatus,
  StockMovementType,
  StockReferenceType,
  UnitType,
} from './enums';
import type { Permission } from './permissions';

// ---------- envelopes ----------
export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}
export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}
export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}
export interface ApiErrorBody {
  error: { code: ErrorCode | string; message: string; details?: unknown };
  requestId?: string;
}
export interface UserRef {
  id: string;
  fullName: string;
  username: string;
}

// ---------- auth & users ----------
export interface AuthUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  mustChangePassword: boolean;
  maxDiscountBps: number | null;
}
export interface LoginRequest {
  identifier: string;
  password: string;
  remember?: boolean;
  client?: 'crm' | 'mobile';
}
export interface TokenPair {
  accessToken: string;
  /** omitted for CRM clients (set as httpOnly cookie instead) */
  refreshToken?: string;
  expiresIn: number;
}
export interface LoginResponse extends TokenPair {
  user: AuthUser;
  permissions: Permission[];
}
export interface MeResponse {
  user: AuthUser;
  permissions: Permission[];
  effectiveMaxDiscountBps: number | null;
}
export interface UserRecord extends AuthUser {
  isActive: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
  activeSessions: number;
}

// ---------- settings ----------
export interface ShopSettings {
  shopName: string;
  address: string;
  phone: string;
  email: string | null;
  logoUrl: string | null;
  brandColor: string;
  invoicePrefix: string;
  invoiceTitle: string;
  invoiceFooter: string | null;
  taxEnabled: boolean;
  taxLabel: string;
  taxRateBps: number;
  gstin: string | null;
  salespersonMaxDiscountBps: number;
  defaultMinStockAlert: number;
  requireCustomerPhoneForCredit: boolean;
  updatedAt: string;
}
export interface Season {
  id: string;
  name: string;
  code: string;
  startsOn: string;
  endsOn: string;
  invoiceSeries: string;
  isActive: boolean;
}

// ---------- catalog ----------
export interface Category {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  productCount?: number;
}
export interface BundleItem {
  componentProductId: string;
  componentName: string;
  componentSku: string;
  quantity: number;
  componentAvailable: number;
}
export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  categoryId: string;
  categoryName: string;
  kind: ProductKind;
  unitType: UnitType;
  sellingPricePaise: number;
  mrpPaise: number | null;
  /** present only with catalog.viewCost */
  purchasePricePaise?: number;
  minStockAlert: number;
  supplierId: string | null;
  supplierName: string | null;
  imageUrl: string | null;
  isActive: boolean;
  isFavorite: boolean;
  favoriteOrder: number;
  availableQuantity: number;
  isLowStock: boolean;
  hasOpeningStock: boolean;
  bundleItems?: BundleItem[];
  createdAt: string;
  updatedAt: string;
}
/** Compact product for the POS cache. */
export interface PosCatalogItem {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  categoryId: string;
  kind: ProductKind;
  unitType: UnitType;
  sellingPricePaise: number;
  availableQuantity: number;
  imageUrl: string | null;
  isFavorite: boolean;
  favoriteOrder: number;
}
export interface PosCatalog {
  generatedAt: string;
  categories: Category[];
  products: PosCatalogItem[];
}

// ---------- inventory ----------
export interface InventoryRow {
  productId: string;
  sku: string;
  name: string;
  categoryName: string;
  unitType: UnitType;
  quantity: number;
  minStockAlert: number;
  isLowStock: boolean;
  isOutOfStock: boolean;
  purchasePricePaise?: number;
  sellingPricePaise: number;
  costValuePaise?: number;
  retailValuePaise: number;
  lastMovementAt: string | null;
  lastReceiptAt: string | null;
  lastSaleAt: string | null;
}
export interface InventorySummary {
  standardProducts: number;
  totalUnits: number;
  inStock: number;
  lowStock: number;
  outOfStock: number;
  costValuePaise?: number;
  retailValuePaise: number;
}
export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  movementType: StockMovementType;
  quantityChange: number;
  previousQuantity: number;
  newQuantity: number;
  unitCostPaise?: number | null;
  referenceType: StockReferenceType | null;
  referenceId: string | null;
  referenceNumber: string | null;
  reason: string | null;
  createdBy: UserRef | null;
  createdAt: string;
}
export interface StockAdjustment {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  adjustmentType: AdjustmentType;
  quantity: number;
  reason: string;
  status: AdjustmentStatus;
  requestedBy: UserRef;
  decidedBy: UserRef | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}
export interface StockCountItem {
  productId: string;
  productName: string;
  sku: string;
  systemQuantity: number;
  countedQuantity: number;
  variance: number;
  currentQuantity: number;
  countedAt: string;
}
export interface StockCount {
  id: string;
  countNumber: string;
  status: StockCountStatus;
  notes: string | null;
  createdBy: UserRef;
  completedBy: UserRef | null;
  createdAt: string;
  completedAt: string | null;
  items?: StockCountItem[];
  itemCount: number;
  totalVariance?: number;
}
export interface DailyStockRow {
  date: string;
  productId: string;
  productName: string;
  openingQuantity: number;
  inQuantity: number;
  outQuantity: number;
  closingQuantity: number;
}

// ---------- suppliers ----------
export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  totalPurchasedPaise: number;
  totalPaidPaise: number;
  balancePaise: number;
  createdAt: string;
}
export interface PurchaseItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitCostPaise: number;
  lineTotalPaise: number;
}
export interface Purchase {
  id: string;
  purchaseNumber: string;
  supplierId: string | null;
  supplierName: string | null;
  purchaseDate: string;
  subtotalPaise: number;
  amountPaidPaise: number;
  balancePaise: number;
  notes: string | null;
  createdBy: UserRef;
  createdAt: string;
  items?: PurchaseItem[];
  itemCount: number;
}
export interface SupplierPayment {
  id: string;
  supplierId: string;
  purchaseId: string | null;
  purchaseNumber: string | null;
  amountPaise: number;
  method: PaymentMethod;
  note: string | null;
  paidAt: string;
  createdBy: UserRef;
}

// ---------- customers ----------
export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  lastPurchaseAt: string | null;
  createdAt: string;
  invoiceCount: number;
  totalSpentPaise: number;
  outstandingPaise: number;
}

// ---------- invoices ----------
export interface CreateInvoiceItem {
  productId: string;
  quantity: number;
  discount?: { type: Exclude<DiscountType, 'NONE'>; value: number } | null;
  note?: string;
}
export interface PaymentInput {
  method: PaymentMethod;
  amountPaise: number;
  reference?: string;
  note?: string;
}
export interface CreateInvoiceRequest {
  idempotencyKey: string;
  items: CreateInvoiceItem[];
  billDiscount?: { type: Exclude<DiscountType, 'NONE'>; value: number; reason?: string } | null;
  customer?: { customerId?: string; name?: string; phone?: string } | null;
  payments?: PaymentInput[];
  discountApproval?: { username: string; password: string } | null;
  /** Why a discount was given (required when it exceeds the salesperson's cap). */
  discountReason?: string;
  notes?: string;
}
export interface InvoicePreviewLine {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPricePaise: number;
  grossPaise: number;
  lineDiscountPaise: number;
  lineTotalPaise: number;
  availableQuantity: number;
}
export interface InvoicePreview {
  lines: InvoicePreviewLine[];
  grossSubtotalPaise: number;
  lineDiscountTotalPaise: number;
  billDiscountPaise: number;
  discountTotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  discountBpsOfGross: number;
  maxDiscountBps: number | null;
  requiresDiscountApproval: boolean;
  stockIssues: { productId: string; name: string; requested: number; available: number }[];
}
export interface InvoiceItemComponent {
  productId: string;
  productName: string;
  quantityPerUnit: number;
}
export interface InvoiceItem {
  id: string;
  lineNo: number;
  productId: string;
  productName: string;
  sku: string;
  unitType: UnitType;
  kind: ProductKind;
  quantity: number;
  unitPricePaise: number;
  unitCostPaise?: number;
  grossPaise: number;
  lineDiscountType: DiscountType;
  lineDiscountValue: number;
  lineDiscountPaise: number;
  billDiscountAllocPaise: number;
  taxAllocPaise: number;
  lineTotalPaise: number;
  returnedQuantity: number;
  note: string | null;
  components?: InvoiceItemComponent[];
}
export interface Payment {
  id: string;
  invoiceId: string;
  invoiceNumber?: string;
  direction: PaymentDirection;
  method: PaymentMethod;
  amountPaise: number;
  reference: string | null;
  note: string | null;
  receivedBy: UserRef;
  createdAt: string;
}
export interface ReturnItem {
  invoiceItemId: string;
  productName: string;
  quantity: number;
  amountPaise: number;
  restocked: boolean;
}
export interface InvoiceReturn {
  id: string;
  returnNumber: string;
  reason: string;
  totalPaise: number;
  createdBy: UserRef;
  createdAt: string;
  items: ReturnItem[];
}
export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  paymentStatus: PaymentStatus;
  salesperson: UserRef;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  itemCount: number;
  grossSubtotalPaise: number;
  discountTotalPaise: number;
  totalPaise: number;
  returnedAmountPaise: number;
  amountPaidPaise: number;
  amountRefundedPaise: number;
  outstandingPaise: number;
  paymentMethods: PaymentMethod[];
  createdAt: string;
}
export interface Invoice extends InvoiceSummary {
  seasonId: string | null;
  lineDiscountTotalPaise: number;
  billDiscountType: DiscountType;
  billDiscountValue: number;
  billDiscountPaise: number;
  taxableAmountPaise: number;
  taxRateBps: number;
  taxPaise: number;
  costTotalPaise?: number;
  creditDuePaise: number;
  discountReason: string | null;
  discountAppliedBy: UserRef | null;
  discountApprovedBy: UserRef | null;
  notes: string | null;
  voidedAt: string | null;
  voidedBy: UserRef | null;
  voidReason: string | null;
  items: InvoiceItem[];
  payments: Payment[];
  returns: InvoiceReturn[];
  stockMovements?: StockMovement[];
  auditTrail?: AuditLogEntry[];
}
export interface RecordPaymentsRequest {
  idempotencyKey: string;
  payments?: PaymentInput[];
  markPaid?: boolean;
  method?: PaymentMethod;
}
export interface ReturnRequest {
  reason: string;
  items: { invoiceItemId: string; quantity: number; restock: boolean }[];
  refund?: { method: PaymentMethod; amountPaise: number } | null;
}
export interface RepeatCartLine {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  sellingPricePaise: number;
  availableQuantity: number;
  isActive: boolean;
}
export interface MySummary {
  date: string;
  billsCount: number;
  salesPaise: number;
  collectedPaise: number;
  outstandingPaise: number;
  outstandingCount: number;
}

// ---------- dashboard ----------
export interface DashboardSummary {
  range: { from: string; to: string };
  salesPaise: number;
  grossInvoicedPaise: number;
  returnsPaise: number;
  seasonSalesPaise: number;
  season: { id: string; name: string; from: string; to: string } | null;
  cashCollectedPaise: number;
  upiCollectedPaise: number;
  cardCollectedPaise: number;
  otherCollectedPaise: number;
  totalCollectedPaise: number;
  refundsPaise: number;
  outstandingPaise: number;
  outstandingInvoices: number;
  billsCount: number;
  productsInInventory: number;
  unitsInInventory: number;
  lowStockCount: number;
  outOfStockCount: number;
  inventoryCostValuePaise: number;
  inventoryRetailValuePaise: number;
  estimatedGrossProfitPaise: number;
  averageBillValuePaise: number;
  discountGivenPaise: number;
}
export interface SalesTrendPoint {
  date: string;
  salesPaise: number;
  collectedPaise: number;
  bills: number;
}
export interface PaymentMethodSummary {
  method: PaymentMethod;
  inPaise: number;
  outPaise: number;
  count: number;
}
export interface TopProduct {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  revenuePaise: number;
}
export interface EmployeePerformance {
  userId: string;
  fullName: string;
  username: string;
  bills: number;
  salesPaise: number;
  collectedPaise: number;
  discountPaise: number;
  voids: number;
}
export interface StockOverview {
  available: number;
  lowStock: number;
  outOfStock: number;
  costValuePaise: number;
  retailValuePaise: number;
  lowStockItems: { productId: string; name: string; quantity: number; minStockAlert: number }[];
}

// ---------- reports ----------
export interface ReportColumn {
  key: string;
  label: string;
  type: 'text' | 'money' | 'number' | 'date' | 'datetime' | 'percent';
}
export interface ReportResult {
  type: string;
  title: string;
  filters: Record<string, unknown>;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals?: Record<string, number>;
}

// ---------- cash ----------
export interface CashMovement {
  id: string;
  type: CashMovementType;
  amountPaise: number;
  reason: string;
  createdBy: UserRef;
  createdAt: string;
}
export interface CashSummary {
  businessDate: string;
  openingCashPaise: number;
  cashSalesPaise: number;
  otherReceiptsPaise: number;
  cashRefundsPaise: number;
  payoutsPaise: number;
  expectedCashPaise: number;
  upiPaise: number;
  cardPaise: number;
  otherMethodPaise: number;
  billsCount: number;
  billsValuePaise: number;
  pendingCustomerPaymentsPaise: number;
}
export interface CashSession {
  id: string;
  businessDate: string;
  status: CashSessionStatus;
  openingCashPaise: number;
  openedBy: UserRef;
  openedAt: string;
  closedBy: UserRef | null;
  closedAt: string | null;
  expectedCashPaise: number | null;
  countedCashPaise: number | null;
  differencePaise: number | null;
  notes: string | null;
  movements: CashMovement[];
  summary: CashSummary;
}

// ---------- audit ----------
export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorUsername: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
  ip: string | null;
  createdAt: string;
}
