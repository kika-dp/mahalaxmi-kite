'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Boxes, CalendarDays, CalendarRange, FileSpreadsheet, FileText, HandCoins, Layers, Package, PiggyBank, Receipt, RotateCcw, ShoppingCart, Tag, Users, Warehouse } from 'lucide-react';
import { formatIstDate, formatIstDateTime, Permission, presetRange, type ReportResult } from '@kite/shared';
import { Button, Card, CardHeader, Skeleton } from '@/components/ui/core';
import { EmptyState, PageHeader, Table, Td, Th, Tr } from '@/components/ui/data';
import { DateRangePicker, FilterSelect, type DateRange } from '@/components/ui/inputs';
import { api, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, inr } from '@/lib/utils';

type Filter = 'date' | 'salesperson' | 'category' | 'method' | 'supplier';
const REPORTS: { type: string; title: string; desc: string; icon: React.ComponentType<{ className?: string }>; perm: Permission; filters: Filter[] }[] = [
  { type: 'daily-sales', title: 'Daily sales', desc: 'Bills, discounts, returns and collections per day', icon: CalendarDays, perm: Permission.REPORTS_FINANCIAL, filters: ['date', 'salesperson'] },
  { type: 'weekly-sales', title: 'Weekly sales', desc: 'The same, grouped by week', icon: CalendarRange, perm: Permission.REPORTS_FINANCIAL, filters: ['date', 'salesperson'] },
  { type: 'seasonal-sales', title: 'Season comparison', desc: 'Compare Uttarayan seasons side by side', icon: BarChart3, perm: Permission.REPORTS_FINANCIAL, filters: [] },
  { type: 'product-sales', title: 'Product-wise sales', desc: 'Units, revenue, cost and profit by product', icon: Package, perm: Permission.REPORTS_FINANCIAL, filters: ['date', 'category'] },
  { type: 'category-sales', title: 'Category-wise sales', desc: 'Kites vs manjha vs firki…', icon: Layers, perm: Permission.REPORTS_FINANCIAL, filters: ['date'] },
  { type: 'salesperson-sales', title: 'Salesperson-wise sales', desc: 'Bills, sales, collections, voids per person', icon: Users, perm: Permission.REPORTS_FINANCIAL, filters: ['date', 'salesperson'] },
  { type: 'payments', title: 'Payment collections', desc: 'Every payment and refund transaction', icon: Receipt, perm: Permission.REPORTS_FINANCIAL, filters: ['date', 'method', 'salesperson'] },
  { type: 'outstanding', title: 'Pending customer payments', desc: 'Dues with ageing buckets', icon: HandCoins, perm: Permission.REPORTS_FINANCIAL, filters: ['salesperson'] },
  { type: 'discounts', title: 'Discounts', desc: 'Who gave how much discount and why', icon: Tag, perm: Permission.REPORTS_FINANCIAL, filters: ['date', 'salesperson'] },
  { type: 'profit', title: 'Estimated gross profit', desc: 'Revenue minus cost of goods (before expenses & tax)', icon: PiggyBank, perm: Permission.REPORTS_FINANCIAL, filters: ['date', 'category'] },
  { type: 'returns', title: 'Returns & refunds', desc: 'Returns, refunds and void refunds', icon: RotateCcw, perm: Permission.REPORTS_FINANCIAL, filters: ['date'] },
  { type: 'stock-movements', title: 'Stock movement summary', desc: 'Opening, received, sold, adjusted, closing', icon: Boxes, perm: Permission.REPORTS_INVENTORY, filters: ['date', 'category'] },
  { type: 'low-stock', title: 'Low stock', desc: 'Items at or below alert level', icon: Package, perm: Permission.REPORTS_INVENTORY, filters: ['category'] },
  { type: 'inventory-valuation', title: 'Inventory valuation', desc: 'Stock value at cost and selling price', icon: Warehouse, perm: Permission.CATALOG_VIEW_COST, filters: ['category'] },
  { type: 'purchases', title: 'Purchases', desc: 'Supplier purchases and balances', icon: ShoppingCart, perm: Permission.REPORTS_INVENTORY, filters: ['date', 'supplier'] },
];

function cell(type: string, v: unknown) {
  if (v === null || v === undefined || v === '') return '—';
  if (type === 'money') return inr(Number(v));
  if (type === 'date') return formatIstDate(String(v));
  if (type === 'datetime') return formatIstDateTime(String(v));
  if (type === 'percent') return `${v}%`;
  if (type === 'number') return Number(v).toLocaleString('en-IN');
  return String(v);
}

export default function ReportsPage() {
  const { can } = useAuth();
  const available = REPORTS.filter((r) => can(r.perm));
  const [type, setType] = useState(available[0]?.type ?? 'low-stock');
  const def = REPORTS.find((r) => r.type === type)!;
  const [range, setRange] = useState<DateRange>(presetRange('last7'));
  const [salespersonId, setSalespersonId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [method, setMethod] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => api.users.staff(), enabled: can(Permission.INVOICES_READ_ALL) || can(Permission.REPORTS_FINANCIAL) });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.catalog.categories() });
  const sups = useQuery({ queryKey: ['suppliers', 'all'], queryFn: () => api.suppliers.list({ pageSize: 200 }), enabled: can(Permission.SUPPLIERS_MANAGE) });
  const params = {
    ...(def.filters.includes('date') ? range : {}),
    ...(def.filters.includes('salesperson') && salespersonId ? { salespersonId } : {}),
    ...(def.filters.includes('category') && categoryId ? { categoryId } : {}),
    ...(def.filters.includes('method') && method ? { method } : {}),
    ...(def.filters.includes('supplier') && supplierId ? { supplierId } : {}),
  };
  const report = useQuery({ queryKey: ['report', type, params], queryFn: () => api.reports.run(type, params) });
  const r: ReportResult | undefined = report.data;

  return (
    <div>
      <PageHeader title="Reports" description="Generated from actual bills, payments and stock movements. Export to CSV or Excel." />
      <div className="grid gap-6 xl:grid-cols-[280px_1fr]">
        <Card className="h-fit p-2">
          <ul className="space-y-0.5">
            {available.map((rep) => (
              <li key={rep.type}>
                <button
                  onClick={() => setType(rep.type)}
                  className={cn('flex w-full cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 text-left', type === rep.type ? 'bg-brand-50' : 'hover:bg-ink-50')}
                >
                  <rep.icon className={cn('mt-0.5 size-4 shrink-0', type === rep.type ? 'text-brand-600' : 'text-ink-400')} />
                  <span>
                    <span className="block text-sm font-medium text-ink-900">{rep.title}</span>
                    <span className="block text-xs text-ink-500">{rep.desc}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="min-w-0">
          <CardHeader
            title={r?.title ?? def.title}
            action={
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => downloadFile(`/reports/${type}`, `${type}.csv`, { ...params, format: 'csv' })}>
                  <FileText /> CSV
                </Button>
                <Button size="sm" variant="secondary" onClick={() => downloadFile(`/reports/${type}`, `${type}.xlsx`, { ...params, format: 'xlsx' })}>
                  <FileSpreadsheet /> Excel
                </Button>
              </div>
            }
          />
          {def.filters.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 p-4">
              {def.filters.includes('date') && <DateRangePicker value={range} onChange={setRange} />}
              {def.filters.includes('salesperson') && <FilterSelect value={salespersonId} onChange={setSalespersonId} placeholder="All salespeople" options={(staff.data ?? []).map((s) => ({ value: s.id, label: s.fullName }))} />}
              {def.filters.includes('category') && <FilterSelect value={categoryId} onChange={setCategoryId} placeholder="All categories" options={(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />}
              {def.filters.includes('method') && <FilterSelect value={method} onChange={setMethod} placeholder="All methods" options={['CASH', 'UPI', 'CARD', 'OTHER'].map((m) => ({ value: m, label: m }))} />}
              {def.filters.includes('supplier') && <FilterSelect value={supplierId} onChange={setSupplierId} placeholder="All suppliers" options={(sups.data?.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />}
            </div>
          )}
          {report.isLoading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-6" />
              ))}
            </div>
          ) : !r || r.rows.length === 0 ? (
            <EmptyState title="No data for these filters" />
          ) : (
            <Table className="max-h-[65vh] overflow-y-auto">
              <thead>
                <tr>
                  {r.columns.map((c) => (
                    <Th key={c.key} align={['money', 'number', 'percent'].includes(c.type) ? 'right' : 'left'}>
                      {c.label}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row, i) => (
                  <Tr key={i}>
                    {r.columns.map((c) => (
                      <Td key={c.key} align={['money', 'number', 'percent'].includes(c.type) ? 'right' : 'left'} className={i === 0 && c === r.columns[0] ? 'font-medium' : ''}>
                        {cell(c.type, row[c.key])}
                      </Td>
                    ))}
                  </Tr>
                ))}
                {r.totals && (
                  <tr className="bg-ink-50 font-semibold">
                    {r.columns.map((c, i) => (
                      <Td key={c.key} align={['money', 'number', 'percent'].includes(c.type) ? 'right' : 'left'} className="text-ink-900">
                        {i === 0 ? 'Total' : c.key in r.totals! ? cell(c.type, r.totals![c.key]) : ''}
                      </Td>
                    ))}
                  </tr>
                )}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
