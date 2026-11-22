'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle,
  Banknote,
  Boxes,
  CalendarRange,
  HandCoins,
  IndianRupee,
  Package,
  PiggyBank,
  Receipt,
  Smartphone,
  Tag,
  TrendingUp,
  Warehouse,
} from 'lucide-react';
import { formatIstDate, PAYMENT_METHOD_LABELS, Permission, presetRange } from '@kite/shared';
import { Badge, Card, CardHeader, Skeleton } from '@/components/ui/core';
import { EmptyState, KpiCard, PageHeader, Table, Td, Th, Tr } from '@/components/ui/data';
import { DateRangePicker, type DateRange } from '@/components/ui/inputs';
import { firstAllowedPath } from '@/components/app-shell';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { inr, num } from '@/lib/utils';

const METHOD_COLORS: Record<string, string> = { CASH: '#16a34a', UPI: '#7c3aed', CARD: '#0284c7', OTHER: '#94a3b8' };
const short = (p: number) => {
  const r = p / 100;
  if (r >= 1e7) return `₹${(r / 1e7).toFixed(1)}Cr`;
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(1)}L`;
  if (r >= 1e3) return `₹${(r / 1e3).toFixed(1)}k`;
  return `₹${Math.round(r)}`;
};

export default function DashboardPage() {
  const { can } = useAuth();
  const router = useRouter();
  const [range, setRange] = useState<DateRange>(presetRange('today'));
  const allowed = can(Permission.DASHBOARD_VIEW);
  useEffect(() => {
    if (!allowed) router.replace(firstAllowedPath(can));
  }, [allowed, can, router]);

  const q = { from: range.from, to: range.to };
  const trendRange = range.from === range.to ? presetRange('last7') : range;
  const summary = useQuery({ queryKey: ['dash', 'summary', q], queryFn: () => api.dashboard.summary(q), enabled: allowed, refetchInterval: 30_000 });
  const trend = useQuery({ queryKey: ['dash', 'trend', trendRange], queryFn: () => api.dashboard.trend(trendRange), enabled: allowed, refetchInterval: 60_000 });
  const pays = useQuery({ queryKey: ['dash', 'pay', q], queryFn: () => api.dashboard.payments(q), enabled: allowed, refetchInterval: 30_000 });
  const top = useQuery({ queryKey: ['dash', 'top', q], queryFn: () => api.dashboard.topProducts({ ...q, limit: 8 }), enabled: allowed });
  const staff = useQuery({ queryKey: ['dash', 'staff', q], queryFn: () => api.dashboard.employees(q), enabled: allowed, refetchInterval: 60_000 });
  const stock = useQuery({ queryKey: ['dash', 'stock'], queryFn: () => api.dashboard.stock(), enabled: allowed, refetchInterval: 60_000 });
  const cash = useQuery({ queryKey: ['cash', 'today'], queryFn: () => api.cash.today(), enabled: can(Permission.CASH_MANAGE) });

  if (!allowed) return null;
  const s = summary.data;
  const L = summary.isLoading;
  const rangeLabel = range.from === range.to ? formatIstDate(range.from) : `${formatIstDate(range.from)} – ${formatIstDate(range.to)}`;
  const payData = (pays.data ?? []).filter((p) => p.inPaise > 0).map((p) => ({ name: PAYMENT_METHOD_LABELS[p.method], value: p.inPaise, method: p.method }));

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Figures for ${rangeLabel}. Sales are net of returns; collections come only from recorded payments.`}
        actions={<DateRangePicker value={range} onChange={setRange} season={s?.season ? { from: s.season.from, to: s.season.to } : null} />}
      />

      {cash.data && !cash.data.session && (
        <Link href="/cash" className="mb-5 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100">
          <Banknote className="size-4" /> Today&apos;s cash session is not open yet. Open it with the opening cash count →
        </Link>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard loading={L} label="Sales" value={inr(s?.salesPaise)} sub={s && s.returnsPaise > 0 ? `${inr(s.grossInvoicedPaise)} billed − ${inr(s.returnsPaise)} returns` : `${num(s?.billsCount)} bills`} icon={<IndianRupee />} tone="brand" />
        <KpiCard loading={L} label="Sales this season" value={inr(s?.seasonSalesPaise)} sub={s?.season?.name ?? 'No active season'} icon={<CalendarRange />} tone="violet" />
        <KpiCard loading={L} label="Cash collected" value={inr(s?.cashCollectedPaise)} sub={s ? `All methods: ${inr(s.totalCollectedPaise)}` : undefined} icon={<Banknote />} tone="green" />
        <KpiCard loading={L} label="UPI collected" value={inr(s?.upiCollectedPaise)} sub={s && s.cardCollectedPaise ? `Card: ${inr(s.cardCollectedPaise)}` : undefined} icon={<Smartphone />} tone="violet" />
        <KpiCard loading={L} label="Outstanding (all time)" value={inr(s?.outstandingPaise)} sub={`${num(s?.outstandingInvoices)} unpaid / partly paid bills`} icon={<HandCoins />} tone="red" />
        <KpiCard loading={L} label="Bills" value={num(s?.billsCount)} sub={s ? `Avg bill ${inr(s.averageBillValuePaise)}` : undefined} icon={<Receipt />} tone="blue" />
        <KpiCard loading={L} label="Products in stock" value={num(s?.productsInInventory)} sub={`${num(s?.unitsInInventory)} units`} icon={<Package />} />
        <KpiCard loading={L} label="Low stock" value={num(s?.lowStockCount)} sub={`${num(s?.outOfStockCount)} out of stock`} icon={<AlertTriangle />} tone={s && s.lowStockCount > 0 ? 'amber' : 'green'} />
        <KpiCard loading={L} label="Inventory value (cost)" value={inr(s?.inventoryCostValuePaise)} sub={s ? `Retail ${inr(s.inventoryRetailValuePaise)}` : undefined} icon={<Warehouse />} />
        <KpiCard loading={L} label="Est. gross profit" value={inr(s?.estimatedGrossProfitPaise)} sub="Before expenses & tax" icon={<PiggyBank />} tone="green" />
        <KpiCard loading={L} label="Average bill" value={inr(s?.averageBillValuePaise)} icon={<TrendingUp />} tone="blue" />
        <KpiCard loading={L} label="Discount given" value={inr(s?.discountGivenPaise)} sub={s && s.refundsPaise ? `Refunds paid ${inr(s.refundsPaise)}` : undefined} icon={<Tag />} tone="amber" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Daily sales vs collections" description={range.from === range.to ? 'Last 7 days' : rangeLabel} />
          <div className="h-72 px-2 py-4">
            {trend.isLoading ? (
              <Skeleton className="mx-4 h-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend.data} margin={{ left: 8, right: 16, top: 8 }}>
                  <defs>
                    <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(d: string) => formatIstDate(d).slice(0, 6)} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={short} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} width={64} />
                  <Tooltip formatter={(v: number, n: string) => [inr(v), n === 'salesPaise' ? 'Sales' : 'Collected']} labelFormatter={(d: string) => formatIstDate(d)} />
                  <Legend formatter={(v: string) => (v === 'salesPaise' ? 'Sales' : 'Collected')} />
                  <Area type="monotone" dataKey="salesPaise" stroke="var(--brand)" strokeWidth={2} fill="url(#gSales)" />
                  <Area type="monotone" dataKey="collectedPaise" stroke="#16a34a" strokeWidth={2} fill="transparent" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Payments by method" description="Money actually received" />
          <div className="h-72 p-4">
            {pays.isLoading ? (
              <Skeleton className="h-full" />
            ) : payData.length === 0 ? (
              <EmptyState title="No payments yet" description="Payments recorded in this period will appear here." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={payData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2}>
                    {payData.map((d) => (
                      <Cell key={d.method} fill={METHOD_COLORS[d.method]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => inr(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Top-selling products" description="By net revenue" />
          <div className="h-80 px-2 py-4">
            {top.isLoading ? (
              <Skeleton className="mx-4 h-full" />
            ) : !top.data?.length ? (
              <EmptyState title="No sales in this period" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={top.data} layout="vertical" margin={{ left: 16, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" tickFormatter={short} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 12, fill: '#334155' }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v: number, n: string) => (n === 'revenuePaise' ? [inr(v), 'Revenue'] : [v, 'Qty'])} />
                  <Bar dataKey="revenuePaise" fill="var(--brand)" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          {top.data && top.data.length > 0 && (
            <Table className="border-t border-ink-100">
              <thead>
                <tr>
                  <Th>Product</Th>
                  <Th align="right">Qty sold</Th>
                  <Th align="right">Revenue</Th>
                </tr>
              </thead>
              <tbody>
                {top.data.map((p) => (
                  <Tr key={p.productId}>
                    <Td className="font-medium text-ink-900">{p.name}</Td>
                    <Td align="right">{num(p.quantity)}</Td>
                    <Td align="right">{inr(p.revenuePaise)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Salesperson performance" />
          <Table>
            <thead>
              <tr>
                <Th>Salesperson</Th>
                <Th align="right">Bills</Th>
                <Th align="right">Sales</Th>
                <Th align="right">Collected</Th>
                <Th align="right">Discounts</Th>
              </tr>
            </thead>
            <tbody>
              {(staff.data ?? []).map((e) => {
                const max = Math.max(1, ...(staff.data ?? []).map((x) => x.salesPaise));
                return (
                  <Tr key={e.userId}>
                    <Td>
                      <div className="font-medium text-ink-900">{e.fullName}</div>
                      <div className="mt-1 h-1.5 w-full max-w-40 rounded-full bg-ink-100">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${(e.salesPaise / max) * 100}%` }} />
                      </div>
                    </Td>
                    <Td align="right">{num(e.bills)}</Td>
                    <Td align="right">{inr(e.salesPaise)}</Td>
                    <Td align="right">{inr(e.collectedPaise)}</Td>
                    <Td align="right">
                      {inr(e.discountPaise)}
                      {e.voids > 0 && <Badge tone="red" className="ml-2">{e.voids} void</Badge>}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Stock overview" action={<Link href="/inventory/low-stock" className="text-sm font-medium text-brand-600 hover:underline">View low stock →</Link>} />
        <div className="grid gap-6 p-5 lg:grid-cols-[1fr_1.4fr]">
          <div className="grid grid-cols-2 gap-3">
            {[
              ['Available', stock.data?.available, 'text-green-700 bg-green-50'],
              ['Low stock', stock.data?.lowStock, 'text-amber-800 bg-amber-50'],
              ['Out of stock', stock.data?.outOfStock, 'text-red-700 bg-red-50'],
              ['Valuation (cost)', stock.data ? inr(stock.data.costValuePaise, true) : undefined, 'text-ink-900 bg-ink-100'],
            ].map(([label, value, cls]) => (
              <div key={label as string} className={`rounded-xl p-4 ${cls}`}>
                <p className="text-xs font-medium opacity-80">{label}</p>
                <p className="tnum mt-1 text-xl font-semibold">{value ?? '—'}</p>
              </div>
            ))}
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Needs restocking</p>
            {stock.data?.lowStockItems.length ? (
              <ul className="divide-y divide-ink-100">
                {stock.data.lowStockItems.map((i) => (
                  <li key={i.productId} className="flex items-center justify-between py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <Boxes className="size-4 text-ink-400" />
                      {i.name}
                    </span>
                    <span className="tnum">
                      <Badge tone={i.quantity === 0 ? 'red' : 'amber'}>{i.quantity === 0 ? 'Out' : `${i.quantity} left`}</Badge>
                      <span className="ml-2 text-xs text-ink-400">alert at {i.minStockAlert}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-500">All products are above their alert levels. 🎉</p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
