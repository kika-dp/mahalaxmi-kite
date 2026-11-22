# UI/UX Specification

## Brand & design tokens
Configurable brand color (shop settings, default **saffron `#F97316`** — the color of Uttarayan skies/kites), deep indigo sidebar `#1E1B4B`, neutrals slate. Typography: Inter (CRM), SF Pro (iOS system). Radii 10 px (cards), 8 px (inputs). Spacing scale 4 px. Status colors: success green-600, warning amber-500, danger red-600, info sky-600. All text/background pairs ≥ 4.5:1 contrast.

Money is always shown as `₹1,23,456.00` (Indian grouping, `en-IN`); zero decimals hidden on POS tiles (`₹20`). Dates as `14 Jan 2027, 10:32 AM` IST.

Payment status badges: Paid (green), Partially paid (amber), Unpaid (red), Refunded (slate), Void (strike-through grey).

## CRM (desktop ≥ 1280 px primary, tablet ≥ 768 px supported)

Layout: collapsible left sidebar (icons + labels, groups: Overview · Sales · Catalog · Inventory · Purchasing · People · Admin), top bar with page title, date-range picker where relevant, user menu (change password, logout). Sidebar collapses to a sheet on tablet. Navigation items are hidden when the user lacks the permission (API still enforces).

Common patterns: data tables with search box, filter chips/selects, sortable headers, pagination, row actions menu, CSV export button; skeleton loaders; empty states with an action ("No products yet — Add product"); toast feedback (sonner); confirmation dialogs for destructive/financial actions showing the consequence ("Void KITE-2026-000123? ₹500 will be refunded in CASH and 12 items restocked."); inline field errors from Zod and from API `VALIDATION_ERROR` details.

| # | Screen | Key content & behaviour |
|---|---|---|
| 1 | Login | Username/email, password (show/hide), error message; forced password change step when required; salesperson → "Use the Kite POS app". |
| 2 | Dashboard | Date range presets (Today, Yesterday, 7d, 30d, Season, Custom). 12 KPI cards (spec §15) with sub-labels (e.g. "₹ collected vs ₹ billed"). Charts: sales trend (area: sales vs collected), payment methods (donut), top products (bar/table), salesperson performance (table with bars), stock overview (counts + valuation). Low-stock alert strip linking to Low stock. Open-cash-session banner if none today. |
| 3 | Products | Table: image, name, SKU, category, kind, price, cost (if permitted), stock (bundles: "available N"), status, favorite star. Filters: category, kind, active, stock state. Actions: add, import CSV, export CSV, bulk price edit mode (editable price column + save). |
| 4 | Add/Edit product | Two-column form: details, pricing (margin shown live), stock alert, image upload with preview, favorite toggle; BUNDLE: component picker with quantities and derived cost; opening stock field on create (STANDARD). Product sales history tab on edit. |
| 5 | Categories | Reorderable list with inline rename, active toggle, product counts. |
| 6 | Inventory | Stock table: qty, min alert, status chip, cost value, retail value, last movement; actions: receive, adjust. Summary cards. |
| 7 | Stock movement history | Ledger table with filters (product, type, user, date); reference links to bills/purchases. |
| 8 | Stock adjustment | Form (product search, type, qty, reason) + pending approvals list (approve/reject for admins) + stock counts (open count → enter counted qty grid → variance review → complete). |
| 9 | Low stock | List sorted by shortfall, quick "Receive stock" action. |
| 10 | Suppliers | List with balance due; detail with purchases & payments; record payment. |
| 11 | Purchases | List; new purchase form (supplier, date, line grid with product search, qty, unit cost, total; paid now). |
| 12 | Bills | Table per spec §13 columns; filters (date presets, salesperson, payment status, method, number, phone, amount range); totals row. |
| 13 | Bill detail | Header (number, status badges, actions: PDF A4/Thermal, Print, Record payment, Return, Refund, Void), items table, totals panel (gross, discounts, tax, total, returned, paid, refunded, outstanding), payments timeline, returns, stock movements, audit trail, customer card. |
| 14 | Customers | Search by phone/name; list with total spent & outstanding. |
| 15 | Customer detail | Profile edit, invoices, payments, outstanding, "Collect payment" (allocates oldest first), statement PDF. |
| 16 | Outstanding | All invoices with outstanding > 0, ageing buckets (0–7, 8–30, 30+ days), collect action. |
| 17 | Reports | Report picker (cards) → filter bar → table preview → export CSV/XLSX. |
| 18 | Users & roles | Users table (role, status, last login); create/edit dialog; activate/deactivate, reset password, revoke sessions; role-permission matrix (read-only). |
| 19 | Shop settings | Shop profile & logo, invoice prefix/title/footer, tax config (with warning about legal requirements), discount cap, low-stock default, brand color; Seasons tab. Cash closing lives under Sales → Cash closing. |
| 20 | Audit logs | Filterable table; row expands to before/after JSON diff. |
| + | Cash closing | Today's session: open (opening cash) → live summary → payouts/receipts → close (counted cash, difference highlighted). History list. |

## Mobile POS (iPhone, portrait, one-handed)

Principles: primary actions in the bottom third; touch targets ≥ 48 pt; numbers large; minimal typing (steppers, quick chips); never lose a cart; always show network state; haptic feedback on add-to-cart and success.

| # | Screen | Content & behaviour |
|---|---|---|
| 1 | Splash | Brand mark; restores session (secure store) → Home or Login. |
| 2 | Login | Username/email, password with eye toggle, "Keep me signed in", big Sign in button; error text; forced password change screen. |
| 3 | Home | Greeting + name; cards: today's bills, sales, collected, my outstanding; giant **New Bill** button; "Resume bill (3 items)" if a cart exists; recent bills list; sync status pill ("Online · catalog 2 min ago"). |
| 4 | Product catalog | Category chips + grid of product tiles (name, price, stock badge); tap = add 1; long-press = quantity pad. |
| 5 | Product search | Search bar autofocus (name/SKU), barcode button → camera scanner; results list with add buttons. |
| 6 | New Bill / Cart | Top: search + scan. Middle: Favorites grid (quick-sell tiles) / category tabs. Bottom sheet cart: lines with − qty + steppers, swipe to remove, line discount on tap; sticky footer: items count, total, **Checkout** button. Clear bill (confirm). |
| 7 | Discount entry | Segmented Fixed ₹ / Percent %; numeric keypad; quick chips (₹10, ₹20, ₹50, 5%, 10%); live "You save ₹X · New total ₹Y"; reason (optional, required over cap); over cap → Manager approval (admin username + password). |
| 8 | Payment checkout | Total large. Status: **Paid** / Partial / Unpaid. Method chips Cash · UPI · Card · Other (one tap). Paid+Cash → "Cash tendered" quick amounts (₹50/100/200/500/2000) → change to return. Split: add second method. Partial/Unpaid → customer name (required) + phone. Confirm button with amount. |
| 9 | Bill success | Check animation, bill number, total/paid/balance, buttons: Share PDF, Print, View bill, **New Bill** (primary). |
| 10 | Invoice preview | PDF rendered via WebView of downloaded file; Share/Print actions. |
| 11 | Bill history | My bills (today default; date filter), status badges, search by number/phone. |
| 12 | Bill details | Items, totals, payments; Collect payment (if outstanding), Share/Print, Repeat bill. |
| 13 | Outstanding | My invoices with balance; tap → collect payment sheet. |
| 14 | Profile & settings | User info, change password, server URL (dev builds only), catalog refresh, app version, logout (warns if cart not empty). |

Error/edge UI: offline banner (red) + disabled checkout with reason; "Stock changed" sheet listing lines with available qty and "Adjust to available" button; session expired → login, cart kept; server price differs → "Prices were updated" toast and refreshed totals before confirm.
