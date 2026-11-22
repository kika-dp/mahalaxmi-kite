# API Specification

Base URL: `/api/v1`. Interactive OpenAPI (Swagger UI) at `/api/docs` (disabled in production unless `SWAGGER_ENABLED=true`).
Auth: `Authorization: Bearer <accessToken>` on every route except `POST /auth/login`, `POST /auth/refresh`, `GET /health/*`.

## Conventions
- JSON, UTF-8. Money in integer **paise**; percentages in **bps** unless a field says `percent`.
- Success: `{ "data": … }`; lists: `{ "data": [...], "meta": { "page", "pageSize", "total" } }`.
- Pagination: `page` (1-based, default 1), `pageSize` (default 25, max 200).
- Dates: query params `from`, `to` are IST calendar dates `YYYY-MM-DD` (inclusive). Timestamps in responses are ISO-8601 UTC.
- Errors: see specification.md §20. Every response carries `X-Request-Id`.
- Exports: report endpoints accept `format=json|csv|xlsx`.
- Permissions shown as `[perm]`; see specification.md §3.

## Health
| Method | Path | Notes |
|---|---|---|
| GET | /health/live | process up |
| GET | /health/ready | DB reachable |

## Auth
| Method | Path | Body / Notes |
|---|---|---|
| POST | /auth/login | `{identifier, password, remember?: bool, client?: "crm"\|"mobile"}` → `{accessToken, refreshToken, expiresIn, user}`. Rate-limited. |
| POST | /auth/refresh | `{refreshToken}` → new pair (rotation). |
| POST | /auth/logout | `{refreshToken?}` revokes current session. |
| GET | /auth/me | `{user, permissions[]}` |
| POST | /auth/change-password | `{currentPassword, newPassword}` → revokes other sessions, returns new token pair. |

## Users `[users.manage]`
| Method | Path | Notes |
|---|---|---|
| GET | /users | filters `role`, `isActive`, `q` |
| POST | /users | `{username, email, fullName, phone?, role, password, maxDiscountPercent?}` (ADMIN/SUPER_ADMIN roles need `users.manageAdmins`) |
| GET | /users/:id | |
| PATCH | /users/:id | `{fullName?, email?, phone?, role?, maxDiscountPercent?}` |
| POST | /users/:id/activate · /deactivate | deactivate revokes sessions |
| POST | /users/:id/reset-password | `{temporaryPassword}` → mustChangePassword, revokes sessions |
| POST | /users/:id/revoke-sessions | |
| GET | /users/salespeople | `[catalog.read]` id + name list for filters |

## Settings & seasons
| Method | Path | Perm |
|---|---|---|
| GET | /settings | any authenticated (public fields; cost-free) |
| PATCH | /settings | `[settings.manage]` |
| POST | /settings/logo | multipart `file` `[settings.manage]` |
| GET | /seasons | any |
| POST | /seasons · PATCH /seasons/:id · POST /seasons/:id/activate | `[settings.manage]` |

## Categories
| GET | /categories | `[catalog.read]` (`includeInactive`) |
|---|---|---|
| POST | /categories | `[catalog.write]` `{name, sortOrder?}` |
| PATCH | /categories/:id | `[catalog.write]` `{name?, sortOrder?, isActive?}` |
| DELETE | /categories/:id | `[catalog.write]` only if unused, else 409 |

## Products
| Method | Path | Notes |
|---|---|---|
| GET | /products | `[catalog.read]` `q, categoryId, kind, isActive, isFavorite, stock=in\|low\|out, sort=name\|price\|quantity\|updated, order=asc\|desc, page, pageSize`. Items include `availableQuantity` (bundles computed), `isLowStock`; cost fields only with `catalog.viewCost`. |
| GET | /products/pos-catalog | `[catalog.read]` all active products, compact, for the POS cache. Supports `If-None-Match` (ETag) → 304. |
| GET | /products/lookup?code= | `[catalog.read]` exact barcode or SKU match |
| GET | /products/:id | `[catalog.read]` with bundle items |
| POST | /products | `[catalog.write]` `{name, sku?, barcode?, categoryId, kind, unitType, description?, purchasePricePaise?, sellingPricePaise, mrpPaise?, minStockAlert?, supplierId?, isFavorite?, favoriteOrder?, bundleItems?}` |
| PATCH | /products/:id | `[catalog.write]` same fields (kind immutable once sold) |
| DELETE | /products/:id | `[catalog.write]` archive (or hard delete if no history) |
| POST | /products/:id/image | `[catalog.write]` multipart `file` |
| POST | /products/bulk-price | `[catalog.write]` `{items:[{productId, sellingPricePaise?, purchasePricePaise?}]}` |
| POST | /products/import | `[catalog.write]` multipart CSV; `dryRun=true` validates only |
| GET | /products/export | `[catalog.read]` CSV |
| GET | /products/:id/sales | `[reports.financial]` sales history lines |

CSV columns: `sku,name,category,kind,unitType,sellingPrice,purchasePrice,mrp,minStockAlert,barcode,isActive,isFavorite,description` (prices in rupees with up to 2 decimals). Bundles are not importable via CSV.

## Inventory
| Method | Path | Notes |
|---|---|---|
| GET | /inventory | `[inventory.viewLedger]` stock list with quantity, value, last movement |
| GET | /inventory/summary | `[inventory.viewLedger]` counts & valuation |
| GET | /inventory/movements | `[inventory.viewLedger]` `productId, type, referenceType, userId, from, to, page` |
| GET | /inventory/low-stock | `[inventory.viewLedger]` |
| POST | /inventory/opening | `[inventory.receive]` `{items:[{productId, quantity, unitCostPaise?}]}` |
| POST | /inventory/receipts | `[inventory.receive]` `{items:[{productId, quantity, unitCostPaise?}], reason?}` |
| POST | /inventory/adjustments | `[inventory.adjust]` `{productId, type, quantity, reason}` → APPLIED or PENDING |
| GET | /inventory/adjustments | `[inventory.viewLedger]` `status` |
| POST | /inventory/adjustments/:id/approve · /reject | `[inventory.approve]` `{note?}` |
| GET/POST | /inventory/counts | `[inventory.adjust]` list / open count |
| GET | /inventory/counts/:id | with items & variance |
| PUT | /inventory/counts/:id/items | `{items:[{productId, countedQuantity}]}` upsert |
| POST | /inventory/counts/:id/complete · /cancel | |
| GET | /inventory/daily-stock | `[inventory.viewLedger]` `from,to,productId?` opening/closing per day |

## Suppliers & purchases `[suppliers.manage]`
| GET/POST | /suppliers | |
|---|---|---|
| PATCH | /suppliers/:id | |
| GET | /suppliers/:id | with balance, purchases, payments |
| GET/POST | /purchases | `{supplierId?, purchaseDate, items:[{productId, quantity, unitCostPaise}], amountPaidPaise?, paymentMethod?, notes?, updateCostPrice?}` |
| GET | /purchases/:id | |
| POST | /suppliers/:id/payments | `{purchaseId?, amountPaise, method, note?}` (ADMIN+) |

## Customers
| Method | Path | Perm |
|---|---|---|
| GET | /customers | `[customers.read]` `q` (name/phone), `hasOutstanding` |
| GET | /customers/lookup?phone= | `[customers.read]` |
| POST | /customers | `[customers.write]` `{name, phone?, address?, notes?}` |
| PATCH | /customers/:id | `[customers.write]` (ADMIN+) |
| GET | /customers/:id | `[customers.read]` with totals (salesperson: only name/phone/outstanding of own invoices) |
| GET | /customers/:id/invoices | `[customers.read]` |
| POST | /customers/:id/payments | `[payments.record]` `{amountPaise, method, invoiceIds?, reference?, note?, idempotencyKey}` allocates oldest-first |
| GET | /customers/:id/statement.pdf | `[reports.financial]` `from,to` |

## Invoices
| Method | Path | Notes |
|---|---|---|
| POST | /invoices/preview | `[invoices.create]` same body as create; returns computed totals & stock check, writes nothing |
| POST | /invoices | `[invoices.create]` see specification §8.1 (plus optional `discountReason`, required when the discount needs manager approval). `201` new, `200` idempotent replay (`meta.replayed=true`). |
| GET | /invoices | `[invoices.readAll \| readOwn]` filters: `from,to,salespersonId,paymentStatus,status,paymentMethod,number,customerPhone,customerId,minTotalPaise,maxTotalPaise,q,page,pageSize,sort` (`mine=true` for own) |
| GET | /invoices/:id | full detail: items, components, payments, returns, stock movements, audit trail |
| GET | /invoices/:id/pdf | `format=a4\|thermal`, `application/pdf` |
| POST | /invoices/:id/payments | `[payments.record]` `{idempotencyKey, payments:[{method, amountPaise, reference?, note?}]}` or `{markPaid: true, method}` |
| POST | /invoices/:id/returns | `[invoices.return]` `{reason, items:[{invoiceItemId, quantity, restock}], refund?: {method, amountPaise}}` |
| POST | /invoices/:id/refunds | `[invoices.refund]` `{method, amountPaise, reason}` |
| POST | /invoices/:id/void | `[invoices.void]` `{reason, refundMethod?}` |
| GET | /invoices/:id/repeat | `[invoices.create]` returns cart lines with current price/stock |

List responses include `meta.totals` (`totalPaise`, `paidPaise`, `outstandingPaise`, `discountPaise`) for the filtered set.

Invoice response (abridged):
```json
{ "id":"…","invoiceNumber":"KITE-2026-000001","status":"FINALIZED","paymentStatus":"PARTIALLY_PAID",
  "salesperson":{"id":"…","fullName":"Seller 01"},"customerName":"Ramesh","customerPhone":"9876543210",
  "grossSubtotalPaise":55000,"lineDiscountTotalPaise":0,"billDiscountType":"FIXED","billDiscountValue":5000,
  "billDiscountPaise":5000,"discountTotalPaise":5000,"taxPaise":0,"totalPaise":50000,
  "amountPaidPaise":30000,"amountRefundedPaise":0,"returnedAmountPaise":0,"outstandingPaise":20000,
  "items":[{"lineNo":1,"productName":"Regular Kite","quantity":10,"unitPricePaise":2000,"lineTotalPaise":18182,…}],
  "payments":[{"direction":"IN","method":"CASH","amountPaise":30000,"receivedBy":{…},"createdAt":"…"}],
  "createdAt":"2026-01-14T04:31:00Z" }
```

## Me (salesperson self-service)
| GET | /me/summary | `today` bills count, sales, collected, own outstanding |
|---|---|---|
| GET | /me/outstanding | own invoices with outstanding > 0 |

## Dashboard `[dashboard.view]`
| GET | /dashboard/summary | `from,to` → all KPIs (spec §15) incl. `season` block |
|---|---|---|
| GET | /dashboard/sales-trend | `from,to` → `[{date, salesPaise, collectedPaise, bills}]` (zero-filled) |
| GET | /dashboard/payment-summary | `from,to` → per method IN/OUT |
| GET | /dashboard/top-products | `from,to,limit` |
| GET | /dashboard/employee-performance | `from,to` |
| GET | /dashboard/stock-overview | counts & valuation |

## Reports
`GET /reports/:type?from&to&…&format=json|csv|xlsx`

| type | perm | filters |
|---|---|---|
| daily-sales, weekly-sales | reports.financial | from,to,salespersonId |
| seasonal-sales | reports.financial | seasonIds (comma) |
| product-sales | reports.financial | from,to,categoryId,productId |
| category-sales | reports.financial | from,to |
| salesperson-sales | reports.financial | from,to,salespersonId |
| payments | reports.financial | from,to,method,salespersonId |
| outstanding | reports.financial | asOf, salespersonId |
| discounts | reports.financial | from,to,salespersonId |
| stock-movements | reports.inventory | from,to,productId,categoryId,type |
| low-stock | reports.inventory | categoryId |
| inventory-valuation | reports.inventory (+catalog.viewCost) | categoryId |
| purchases | reports.inventory | from,to,supplierId |
| profit | reports.financial | from,to,categoryId |
| returns | reports.financial | from,to |

## Cash sessions `[cash.manage]`
| GET | /cash-sessions | list |
|---|---|---|
| GET | /cash-sessions/today | current IST date session + live summary (or `null` + preview summary) |
| GET | /cash-sessions/:id | with movements & summary |
| POST | /cash-sessions | `{openingCashPaise, notes?}` opens today |
| POST | /cash-sessions/:id/movements | `{type, amountPaise, reason}` |
| POST | /cash-sessions/:id/close | `{countedCashPaise, notes?}` |
| POST | /cash-sessions/:id/reopen | SUPER_ADMIN `{reason}` |

## Audit `[audit.view]`
`GET /audit-logs?actorId&action&entityType&entityId&from&to&page`

## Uploads
`GET /uploads/:file` static (images only; random file names; `Cache-Control: public, max-age=31536000, immutable`).
