/**
 * Typed HTTP client for the Kite Shop API, shared by the CRM (browser) and the POS app (React Native).
 * - Attaches the bearer token, refreshes once on TOKEN_EXPIRED (single-flight), retries the request.
 * - Normalizes every failure into ApiError (network errors have status 0 / code NETWORK_ERROR).
 */
import type {
  ApiErrorBody,
  AuditLogEntry,
  CashSession,
  CashSummary,
  Category,
  CreateInvoiceRequest,
  Customer,
  DailyStockRow,
  DashboardSummary,
  EmployeePerformance,
  InventoryRow,
  InventorySummary,
  Invoice,
  InvoicePreview,
  InvoiceSummary,
  LoginRequest,
  LoginResponse,
  MeResponse,
  MySummary,
  PageMeta,
  PaymentMethodSummary,
  PosCatalog,
  Product,
  Purchase,
  RecordPaymentsRequest,
  RepeatCartLine,
  ReportResult,
  ReturnRequest,
  SalesTrendPoint,
  Season,
  ShopSettings,
  StockAdjustment,
  StockCount,
  StockMovement,
  StockOverview,
  Supplier,
  SupplierPayment,
  TokenPair,
  TopProduct,
  UserRecord,
} from '@kite/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get isNetwork(): boolean {
    return this.status === 0;
  }
  /** Field errors from VALIDATION_ERROR responses, keyed by field path. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) {
      for (const d of this.details as { field?: string; message?: string }[]) {
        if (d?.field && d.message && !out[d.field]) out[d.field] = d.message;
      }
    }
    return out;
  }
}

/** Any plain object of query params; null/undefined/'' values are omitted. */
export type Query = object;

export interface ClientOptions {
  baseUrl: string;
  getAccessToken: () => string | null;
  /** Obtain a new access token (or null). Called at most once concurrently. */
  refreshAccessToken: () => Promise<string | null>;
  /** Called when refresh fails — the session is over. */
  onSessionExpired?: (err: ApiError) => void;
  /** 'include' for the CRM (refresh cookie); 'omit' for mobile. */
  credentials?: 'include' | 'omit' | 'same-origin';
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface Paged<T> {
  data: T[];
  meta: PageMeta & Record<string, unknown>;
}

export function buildQuery(q?: Query): string {
  if (!q) return '';
  const parts = Object.entries(q as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export function createApiClient(opts: ClientOptions) {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  let refreshing: Promise<string | null> | null = null;

  const refreshOnce = () => {
    if (!refreshing) {
      refreshing = opts.refreshAccessToken().finally(() => {
        setTimeout(() => (refreshing = null), 0);
      });
    }
    return refreshing;
  };

  async function raw(method: string, path: string, init: { query?: Query; body?: unknown; form?: FormData; retry?: boolean; headers?: Record<string, string> } = {}): Promise<Response> {
    const url = `${opts.baseUrl}${path}${buildQuery(init.query)}`;
    const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers ?? {}) };
    const token = opts.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    let body: BodyInit | undefined;
    if (init.form) body = init.form;
    else if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.body);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(url, { method, headers, body, credentials: opts.credentials ?? 'omit', signal: controller.signal });
    } catch (e) {
      const aborted = (e as Error)?.name === 'AbortError';
      throw new ApiError(0, 'NETWORK_ERROR', aborted ? 'The server took too long to respond' : 'No connection to the server', e);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 && init.retry !== false && token) {
      const body401 = (await res.clone().json().catch(() => null)) as ApiErrorBody | null;
      const code = body401?.error?.code;
      if (code === 'TOKEN_EXPIRED' || code === 'UNAUTHENTICATED') {
        const fresh = await refreshOnce().catch(() => null);
        if (fresh) return raw(method, path, { ...init, retry: false });
      }
    }
    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as ApiErrorBody | null;
      const err = new ApiError(
        res.status,
        errBody?.error?.code ?? `HTTP_${res.status}`,
        errBody?.error?.message ?? `Request failed (${res.status})`,
        errBody?.error?.details,
        errBody?.requestId ?? res.headers.get('X-Request-Id') ?? undefined,
      );
      if (res.status === 401 && !path.startsWith('/auth/login')) opts.onSessionExpired?.(err);
      throw err;
    }
    return res;
  }

  async function json<T>(method: string, path: string, init: { query?: Query; body?: unknown; form?: FormData } = {}): Promise<T> {
    const res = await raw(method, path, init);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  const data = async <T>(method: string, path: string, init: { query?: Query; body?: unknown; form?: FormData } = {}) =>
    (await json<{ data: T }>(method, path, init)).data;
  const page = <T>(path: string, query?: Query) => json<Paged<T>>('GET', path, { query });
  const get = <T>(path: string, query?: Query) => data<T>('GET', path, { query });
  const post = <T>(path: string, body?: unknown) => data<T>('POST', path, { body: body ?? {} });
  const patch = <T>(path: string, body?: unknown) => data<T>('PATCH', path, { body: body ?? {} });
  const put = <T>(path: string, body?: unknown) => data<T>('PUT', path, { body: body ?? {} });
  const del = <T>(path: string) => data<T>('DELETE', path);
  const upload = <T>(path: string, form: FormData, query?: Query) => data<T>('POST', path, { form, query });
  /** Binary download (PDF/CSV/XLSX). */
  const blob = async (path: string, query?: Query) => (await raw('GET', path, { query })).blob();
  const arrayBuffer = async (path: string, query?: Query) => (await raw('GET', path, { query })).arrayBuffer();

  return {
    raw,
    get,
    post,
    patch,
    put,
    del,
    page,
    upload,
    blob,
    arrayBuffer,
    /** Full JSON envelope (data + meta) for endpoints that return meta. */
    envelope: <T>(method: string, path: string, body?: unknown) => json<{ data: T; meta?: Record<string, unknown> }>(method, path, { body }),

    auth: {
      login: (body: LoginRequest) => data<LoginResponse>('POST', '/auth/login', { body }),
      refresh: (refreshToken?: string) => data<TokenPair>('POST', '/auth/refresh', { body: refreshToken ? { refreshToken } : {} }),
      logout: (refreshToken?: string) => data<{ success: boolean }>('POST', '/auth/logout', { body: refreshToken ? { refreshToken } : {} }),
      me: () => get<MeResponse>('/auth/me'),
      changePassword: (currentPassword: string, newPassword: string) => post<TokenPair>('/auth/change-password', { currentPassword, newPassword }),
    },
    settings: {
      get: () => get<ShopSettings>('/settings'),
      update: (body: Partial<ShopSettings>) => patch<ShopSettings>('/settings', body),
      uploadLogo: (form: FormData) => upload<ShopSettings>('/settings/logo', form),
      seasons: () => get<Season[]>('/seasons'),
      createSeason: (body: Omit<Season, 'id' | 'isActive'>) => post<Season>('/seasons', body),
      updateSeason: (id: string, body: Partial<Season>) => patch<Season>(`/seasons/${id}`, body),
      activateSeason: (id: string) => post<Season>(`/seasons/${id}/activate`),
    },
    users: {
      list: (q?: Query) => page<UserRecord>('/users', q),
      staff: () => get<{ id: string; username: string; fullName: string; role: string; isActive: boolean }[]>('/users/salespeople'),
      create: (body: object) => post<UserRecord>('/users', body),
      update: (id: string, body: object) => patch<UserRecord>(`/users/${id}`, body),
      activate: (id: string) => post<UserRecord>(`/users/${id}/activate`),
      deactivate: (id: string) => post<UserRecord>(`/users/${id}/deactivate`),
      resetPassword: (id: string, temporaryPassword: string) => post<UserRecord>(`/users/${id}/reset-password`, { temporaryPassword }),
      revokeSessions: (id: string) => post<{ revoked: number }>(`/users/${id}/revoke-sessions`),
    },
    catalog: {
      categories: (includeInactive = false) => get<Category[]>('/categories', { includeInactive }),
      createCategory: (body: { name: string; sortOrder?: number }) => post<Category>('/categories', body),
      updateCategory: (id: string, body: Partial<Category>) => patch<Category>(`/categories/${id}`, body),
      deleteCategory: (id: string) => del<{ deleted: boolean }>(`/categories/${id}`),
      products: (q?: Query) => page<Product>('/products', q),
      product: (id: string) => get<Product>(`/products/${id}`),
      lookup: (code: string) => get<Product>('/products/lookup', { code }),
      posCatalog: () => get<PosCatalog>('/products/pos-catalog'),
      createProduct: (body: object) => post<Product>('/products', body),
      updateProduct: (id: string, body: object) => patch<Product>(`/products/${id}`, body),
      deleteProduct: (id: string) => del<{ archived: boolean; deleted: boolean }>(`/products/${id}`),
      uploadImage: (id: string, form: FormData) => upload<Product>(`/products/${id}/image`, form),
      bulkPrice: (items: { productId: string; sellingPricePaise?: number; purchasePricePaise?: number }[]) => post<{ updated: number }>('/products/bulk-price', { items }),
      importCsv: (form: FormData, dryRun: boolean) =>
        upload<{ dryRun: boolean; rows: number; toCreate: number; toUpdate: number; created: number; updated: number; errors: { row: number; field?: string; message: string }[] }>(
          '/products/import',
          form,
          { dryRun },
        ),
      sales: (id: string, q?: Query) => page<Record<string, unknown>>(`/products/${id}/sales`, q),
    },
    inventory: {
      list: (q?: Query) => page<InventoryRow>('/inventory', q),
      summary: () => get<InventorySummary>('/inventory/summary'),
      lowStock: () => get<InventoryRow[]>('/inventory/low-stock'),
      movements: (q?: Query) => page<StockMovement>('/inventory/movements', q),
      dailyStock: (q?: Query) => get<DailyStockRow[]>('/inventory/daily-stock', q),
      opening: (items: { productId: string; quantity: number; unitCostPaise?: number }[], reason?: string) => post('/inventory/opening', { items, reason }),
      receive: (items: { productId: string; quantity: number; unitCostPaise?: number }[], reason?: string) =>
        post<{ referenceNumber: string }>('/inventory/receipts', { items, reason }),
      adjustments: (q?: Query) => page<StockAdjustment>('/inventory/adjustments', q),
      adjust: (body: { productId: string; type: string; quantity: number; reason: string }) => post<StockAdjustment>('/inventory/adjustments', body),
      approve: (id: string, note?: string) => post<StockAdjustment>(`/inventory/adjustments/${id}/approve`, { note }),
      reject: (id: string, note?: string) => post<StockAdjustment>(`/inventory/adjustments/${id}/reject`, { note }),
      counts: (q?: Query) => page<StockCount>('/inventory/counts', q),
      count: (id: string) => get<StockCount>(`/inventory/counts/${id}`),
      openCount: (notes?: string) => post<StockCount>('/inventory/counts', { notes }),
      recordCount: (id: string, items: { productId: string; countedQuantity: number }[]) => put<StockCount>(`/inventory/counts/${id}/items`, { items }),
      completeCount: (id: string) => post<StockCount>(`/inventory/counts/${id}/complete`),
      cancelCount: (id: string) => post<StockCount>(`/inventory/counts/${id}/cancel`),
    },
    suppliers: {
      list: (q?: Query) => page<Supplier>('/suppliers', q),
      get: (id: string) => get<Supplier & { purchases: Purchase[]; payments: SupplierPayment[] }>(`/suppliers/${id}`),
      create: (body: object) => post<Supplier>('/suppliers', body),
      update: (id: string, body: object) => patch<Supplier>(`/suppliers/${id}`, body),
      pay: (id: string, body: { purchaseId?: string; amountPaise: number; method: string; note?: string }) => post(`/suppliers/${id}/payments`, body),
      purchases: (q?: Query) => page<Purchase>('/purchases', q),
      purchase: (id: string) => get<Purchase>(`/purchases/${id}`),
      createPurchase: (body: object) => post<Purchase>('/purchases', body),
    },
    customers: {
      list: (q?: Query) => page<Customer>('/customers', q),
      lookup: (phone: string) => get<Customer | null>('/customers/lookup', { phone }),
      get: (id: string) => get<Customer>(`/customers/${id}`),
      create: (body: object) => post<Customer>('/customers', body),
      update: (id: string, body: object) => patch<Customer>(`/customers/${id}`, body),
      invoices: (id: string, q?: Query) => page<InvoiceSummary>(`/customers/${id}/invoices`, q),
      collect: (id: string, body: { idempotencyKey: string; amountPaise: number; method: string; invoiceIds?: string[]; reference?: string; note?: string }) =>
        post<{ customer: Customer; allocations: { invoiceId: string; invoiceNumber: string; amountPaise: number }[] }>(`/customers/${id}/payments`, body),
    },
    invoices: {
      list: (q?: Query) => page<InvoiceSummary>('/invoices', q),
      get: (id: string) => get<Invoice>(`/invoices/${id}`),
      preview: (body: Omit<CreateInvoiceRequest, 'idempotencyKey'> & { idempotencyKey?: string }) => post<InvoicePreview>('/invoices/preview', body),
      create: (body: CreateInvoiceRequest) => json<{ data: Invoice; meta: { replayed: boolean } }>('POST', '/invoices', { body }),
      pay: (id: string, body: RecordPaymentsRequest) => json<{ data: Invoice; meta: { replayed: boolean } }>('POST', `/invoices/${id}/payments`, { body }),
      returnItems: (id: string, body: ReturnRequest) => post<Invoice>(`/invoices/${id}/returns`, body),
      refund: (id: string, body: { method: string; amountPaise: number; reason: string }) => post<Invoice>(`/invoices/${id}/refunds`, body),
      void: (id: string, body: { reason: string; refundMethod?: string }) => post<Invoice>(`/invoices/${id}/void`, body),
      repeat: (id: string) => get<RepeatCartLine[]>(`/invoices/${id}/repeat`),
      pdfPath: (id: string, format: 'a4' | 'thermal' = 'a4') => `/invoices/${id}/pdf${buildQuery({ format })}`,
    },
    me: {
      summary: () => get<MySummary>('/me/summary'),
      outstanding: (q?: Query) => page<InvoiceSummary>('/me/outstanding', q),
    },
    dashboard: {
      summary: (q?: Query) => get<DashboardSummary>('/dashboard/summary', q),
      trend: (q?: Query) => get<SalesTrendPoint[]>('/dashboard/sales-trend', q),
      payments: (q?: Query) => get<PaymentMethodSummary[]>('/dashboard/payment-summary', q),
      topProducts: (q?: Query) => get<TopProduct[]>('/dashboard/top-products', q),
      employees: (q?: Query) => get<EmployeePerformance[]>('/dashboard/employee-performance', q),
      stock: () => get<StockOverview>('/dashboard/stock-overview'),
    },
    reports: {
      run: (type: string, q?: Query) => get<ReportResult>(`/reports/${type}`, q),
    },
    cash: {
      list: (q?: Query) => page<CashSession>('/cash-sessions', q),
      today: () => get<{ session: CashSession | null; preview: CashSummary }>('/cash-sessions/today'),
      get: (id: string) => get<CashSession>(`/cash-sessions/${id}`),
      open: (openingCashPaise: number, notes?: string) => post<CashSession>('/cash-sessions', { openingCashPaise, notes }),
      movement: (id: string, body: { type: string; amountPaise: number; reason: string }) => post<CashSession>(`/cash-sessions/${id}/movements`, body),
      close: (id: string, countedCashPaise: number, notes?: string) => post<CashSession>(`/cash-sessions/${id}/close`, { countedCashPaise, notes }),
      reopen: (id: string, reason: string) => post<CashSession>(`/cash-sessions/${id}/reopen`, { reason }),
    },
    audit: {
      list: (q?: Query) => page<AuditLogEntry>('/audit-logs', q),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Human-friendly message for any error thrown by the client. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}
