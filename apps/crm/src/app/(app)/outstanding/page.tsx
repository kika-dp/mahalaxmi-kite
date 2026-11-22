'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download, HandCoins } from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui/core';
import { EmptyState, KpiCard, PageHeader, Pagination, PaymentStatusBadge, Table, TableSkeleton, Td, Th, Tr } from '@/components/ui/data';
import { FilterSelect, SearchInput } from '@/components/ui/inputs';
import { api, downloadFile } from '@/lib/api';
import { dateTime, inr } from '@/lib/utils';

const ageDays = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

export default function OutstandingPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [salespersonId, setSalespersonId] = useState('');
  const [page, setPage] = useState(1);
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => api.users.staff() });
  const params = { hasOutstanding: true, status: 'FINALIZED', q, salespersonId, sort: 'oldest', page, pageSize: 50 };
  const list = useQuery({ queryKey: ['bills', 'outstanding', params], queryFn: () => api.invoices.list(params), placeholderData: (p) => p });
  const totals = list.data?.meta.totals as { outstandingPaise: number } | undefined;

  return (
    <div>
      <PageHeader
        title="Outstanding payments"
        description="Bills with money still to collect, oldest first."
        actions={
          <Button variant="secondary" onClick={() => downloadFile('/reports/outstanding', 'outstanding.xlsx', { format: 'xlsx' })}>
            <Download /> Export
          </Button>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total outstanding" value={inr(totals?.outstandingPaise)} tone="red" icon={<HandCoins />} loading={!list.data} />
        <KpiCard label="Bills" value={list.data?.meta.total ?? '—'} loading={!list.data} />
      </div>
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-ink-100 p-4">
          <SearchInput value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Customer, mobile or bill no." className="w-full sm:w-72" />
          <FilterSelect value={salespersonId} onChange={(v) => (setSalespersonId(v), setPage(1))} placeholder="All salespeople" options={(staff.data ?? []).map((s) => ({ value: s.id, label: s.fullName }))} />
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Bill</Th>
              <Th>Customer</Th>
              <Th>Billed</Th>
              <Th>Age</Th>
              <Th>Salesperson</Th>
              <Th align="right">Total</Th>
              <Th align="right">Paid</Th>
              <Th align="right">Due</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          {list.isLoading ? (
            <TableSkeleton cols={9} />
          ) : (
            <tbody>
              {list.data?.data.map((b) => {
                const age = ageDays(b.createdAt);
                return (
                  <Tr key={b.id} onClick={() => router.push(`/bills/${b.id}`)}>
                    <Td className="font-medium text-ink-900">{b.invoiceNumber}</Td>
                    <Td>
                      {b.customerName}
                      <div className="text-xs text-ink-500">{b.customerPhone ?? 'no mobile'}</div>
                    </Td>
                    <Td className="text-xs">{dateTime(b.createdAt)}</Td>
                    <Td>
                      <Badge tone={age > 30 ? 'red' : age > 7 ? 'amber' : 'neutral'}>{age === 0 ? 'today' : `${age} d`}</Badge>
                    </Td>
                    <Td>{b.salesperson.fullName}</Td>
                    <Td align="right">{inr(b.totalPaise - b.returnedAmountPaise)}</Td>
                    <Td align="right">{inr(b.amountPaidPaise - b.amountRefundedPaise)}</Td>
                    <Td align="right" className="font-semibold text-red-600">{inr(b.outstandingPaise)}</Td>
                    <Td>
                      <PaymentStatusBadge status={b.paymentStatus} />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          )}
        </Table>
        {list.data?.data.length === 0 && <EmptyState title="Nothing outstanding" description="Every bill is fully paid. 🎉" />}
        {list.data && <Pagination page={page} pageSize={50} total={list.data.meta.total} onPage={setPage} />}
      </Card>
    </div>
  );
}
