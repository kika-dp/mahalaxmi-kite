'use client';
import * as React from 'react';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import {
  PAYMENT_STATUS_LABELS,
  type InvoiceStatus,
  type PaymentStatus,
} from '@kite/shared';
import { cn } from '@/lib/utils';
import { Badge, Button, Card, Skeleton } from './core';

// ---------------------------------------------------------------- Page header
export function PageHeader({ title, description, actions, back }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; back?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {back}
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Table
export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full min-w-full border-collapse text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className, align = 'left', onClick, sorted }: { children?: React.ReactNode; className?: string; align?: 'left' | 'right' | 'center'; onClick?: () => void; sorted?: 'asc' | 'desc' | null }) {
  return (
    <th
      scope="col"
      onClick={onClick}
      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
      className={cn(
        'sticky top-0 border-b border-ink-200 bg-ink-50/80 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-500 backdrop-blur',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        onClick && 'cursor-pointer select-none hover:text-ink-900',
        className,
      )}
    >
      {children}
      {sorted && <span className="ml-1">{sorted === 'asc' ? '↑' : '↓'}</span>}
    </th>
  );
}
export function Td({ children, className, align = 'left', colSpan }: { children?: React.ReactNode; className?: string; align?: 'left' | 'right' | 'center'; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn('border-b border-ink-100 px-4 py-3 text-ink-700', align === 'right' && 'text-right tnum', align === 'center' && 'text-center', className)}>
      {children}
    </td>
  );
}
export function Tr({ children, onClick, className }: { children: React.ReactNode; onClick?: () => void; className?: string }) {
  return (
    <tr onClick={onClick} className={cn('transition-colors', onClick && 'cursor-pointer hover:bg-brand-50/40', className)}>
      {children}
    </tr>
  );
}

export function TableSkeleton({ rows = 6, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <tbody>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c} className="border-b border-ink-100 px-4 py-3.5">
              <Skeleton className="h-4 w-full max-w-32" />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 rounded-2xl bg-brand-50 p-3 text-brand-600">{icon ?? <Inbox className="size-6" />}</div>
      <p className="text-sm font-semibold text-ink-900">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm text-ink-500">
      <span className="tnum">
        {from.toLocaleString('en-IN')}–{to.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <span className="tnum px-2">
          {page} / {pages}
        </span>
        <Button variant="ghost" size="icon" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- KPI card
export function KpiCard({
  label,
  value,
  sub,
  icon,
  tone = 'neutral',
  loading,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'neutral' | 'brand' | 'green' | 'red' | 'amber' | 'blue' | 'violet';
  loading?: boolean;
}) {
  const toneBg = {
    neutral: 'bg-ink-100 text-ink-600',
    brand: 'bg-brand-50 text-brand-600',
    green: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600',
    amber: 'bg-amber-50 text-amber-600',
    blue: 'bg-sky-50 text-sky-600',
    violet: 'bg-violet-50 text-violet-600',
  }[tone];
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
        {icon && <div className={cn('rounded-lg p-1.5 [&_svg]:size-4', toneBg)}>{icon}</div>}
      </div>
      {loading ? <Skeleton className="mt-3 h-7 w-28" /> : <p className="tnum mt-2 text-2xl font-semibold tracking-tight text-ink-900">{value}</p>}
      {sub && <p className="mt-1 text-xs text-ink-500">{sub}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------- Status badges
export function PaymentStatusBadge({ status, invoiceStatus }: { status: PaymentStatus; invoiceStatus?: InvoiceStatus }) {
  if (invoiceStatus === 'VOID') return <Badge tone="neutral" className="line-through">Void</Badge>;
  const tone = ({ PAID: 'green', PARTIALLY_PAID: 'amber', UNPAID: 'red', REFUNDED: 'neutral' } as const)[status];
  return <Badge tone={tone}>{PAYMENT_STATUS_LABELS[status]}</Badge>;
}

export function StockBadge({ quantity, min }: { quantity: number; min: number }) {
  if (quantity === 0) return <Badge tone="red">Out of stock</Badge>;
  if (quantity <= min) return <Badge tone="amber">Low · {quantity}</Badge>;
  return <Badge tone="green">{quantity.toLocaleString('en-IN')}</Badge>;
}
