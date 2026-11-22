'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download, ReceiptIndianRupee } from 'lucide-react';
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, PAYMENT_STATUS_LABELS, PAYMENT_STATUSES, presetRange, tryRupeesToPaise } from '@kite/shared';
import { Badge, Button, Card, Input } from '@/components/ui/core';
import { EmptyState, PageHeader, Pagination, PaymentStatusBadge, Table, TableSkeleton, Td, Th, Tr } from '@/components/ui/data';
import { DateRangePicker, FilterSelect, MoneyInput, SearchInput, type DateRange } from '@/components/ui/inputs';
import { api, downloadFile } from '@/lib/api';
import { dateTime, inr } from '@/lib/utils';

export default function BillsPage() {
  const router = useRouter();
  const [range, setRange] = useState<DateRange>(presetRange('today'));
  const [q, setQ] = useState('');
  const [phone, setPhone] = useState('');
  const [salespersonId, setSalespersonId] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [status, setStatus] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [page, setPage] = useState(1);
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => api.users.staff(), staleTime: 300_000 });
  const params = {
    ...range,
    q,
    customerPhone: phone,
    salespersonId,
    paymentStatus,
    paymentMethod,
    status,
    minTotalPaise: tryRupeesToPaise(min) ?? undefined,
    maxTotalPaise: tryRupeesToPaise(max) ?? undefined,
    page,
    pageSize: 25,
  };
  const list = useQuery({ queryKey: ['bills', params], queryFn: () => api.invoices.list(params), placeholderData: (p) => p, refetchInterval: 20_000 });
  const totals = list.data?.meta.totals as { totalPaise: number; paidPaise: number; outstandingPaise: number; discountPaise: number } | undefined;
  const set = <T,>(fn: (v: T) => void) => (v: T) => (fn(v), setPage(1));

  return (
    <div>
      <PageHeader
        title="Bills"
        description="Every bill from every counter, live."
        actions={
          <>
            <DateRangePicker value={range} onChange={set(setRange)} />
            <Button variant="secondary" onClick={() => downloadFile('/reports/daily-sales', `sales-${range.from}_${range.to}.xlsx`, { ...range, format: 'xlsx' })}>
              <Download /> Export
            </Button>
          </>
        }
      />
      {totals && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['Billed (excl. void)', totals.totalPaise],
            ['Received (net)', totals.paidPaise],
            ['Outstanding', totals.outstandingPaise],
            ['Discounts', totals.discountPaise],
          ].map(([l, v]) => (
            <Card key={l as string} className="px-4 py-3">
              <p className="text-xs text-ink-500">{l}</p>
              <p className="tnum text-lg font-semibold">{inr(v as number)}</p>
            </Card>
          ))}
        </div>
      )}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 p-4">
          <SearchInput value={q} onChange={set(setQ)} placeholder="Bill no. or customer" className="w-full sm:w-56" />
          <SearchInput value={phone} onChange={set(setPhone)} placeholder="Customer mobile" className="w-full sm:w-44" />
          <FilterSelect value={salespersonId} onChange={set(setSalespersonId)} placeholder="All salespeople" options={(staff.data ?? []).map((s) => ({ value: s.id, label: s.fullName }))} />
          <FilterSelect value={paymentStatus} onChange={set(setPaymentStatus)} placeholder="Any payment status" options={PAYMENT_STATUSES.map((s) => ({ value: s, label: PAYMENT_STATUS_LABELS[s] }))} />
          <FilterSelect value={paymentMethod} onChange={set(setPaymentMethod)} placeholder="Any method" options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} />
          <FilterSelect value={status} onChange={set(setStatus)} placeholder="Active & void" options={[{ value: 'FINALIZED', label: 'Active only' }, { value: 'VOID', label: 'Void only' }]} />
          <div className="flex items-center gap-1">
            <div className="w-28">
              <MoneyInput value={min} onChange={(e) => set(setMin)(e.target.value)} placeholder="Min" aria-label="Minimum amount" />
            </div>
            <span className="text-ink-400">–</span>
            <div className="w-28">
              <MoneyInput value={max} onChange={(e) => set(setMax)(e.target.value)} placeholder="Max" aria-label="Maximum amount" />
            </div>
          </div>
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Bill</Th>
              <Th>Date & time</Th>
              <Th>Customer</Th>
              <Th>Salesperson</Th>
              <Th align="right">Items</Th>
              <Th align="right">Subtotal</Th>
              <Th align="right">Discount</Th>
              <Th align="right">Total</Th>
              <Th align="right">Paid</Th>
              <Th align="right">Due</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          {list.isLoading ? (
            <TableSkeleton cols={11} />
          ) : (
            <tbody>
              {list.data?.data.map((b) => (
                <Tr key={b.id} onClick={() => router.push(`/bills/${b.id}`)} className={b.status === 'VOID' ? 'opacity-60' : ''}>
                  <Td className="font-medium text-ink-900">{b.invoiceNumber}</Td>
                  <Td className="whitespace-nowrap text-xs">{dateTime(b.createdAt)}</Td>
                  <Td>
                    {b.customerName ?? <span className="text-ink-400">Walk-in</span>}
                    {b.customerPhone && <div className="text-xs text-ink-500">{b.customerPhone}</div>}
                  </Td>
                  <Td>{b.salesperson.fullName}</Td>
                  <Td align="right">{b.itemCount}</Td>
                  <Td align="right">{inr(b.grossSubtotalPaise)}</Td>
                  <Td align="right" className="text-ink-500">{b.discountTotalPaise ? `−${inr(b.discountTotalPaise)}` : '—'}</Td>
                  <Td align="right" className="font-semibold text-ink-900">{inr(b.totalPaise)}</Td>
                  <Td align="right">{inr(b.amountPaidPaise - b.amountRefundedPaise)}</Td>
                  <Td align="right" className={b.outstandingPaise > 0 ? 'font-medium text-red-600' : 'text-ink-400'}>{b.outstandingPaise ? inr(b.outstandingPaise) : '—'}</Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      <PaymentStatusBadge status={b.paymentStatus} invoiceStatus={b.status} />
                      {b.paymentMethods.map((m) => (
                        <Badge key={m} tone="neutral" className="text-[10px]">
                          {m}
                        </Badge>
                      ))}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          )}
        </Table>
        {list.data?.data.length === 0 && <EmptyState icon={<ReceiptIndianRupee className="size-6" />} title="No bills for these filters" description="Bills created in the POS app appear here instantly." />}
        {list.data && <Pagination page={page} pageSize={25} total={list.data.meta.total} onPage={setPage} />}
      </Card>
    </div>
  );
}
