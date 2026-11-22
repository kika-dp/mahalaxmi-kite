'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { STOCK_MOVEMENT_TYPES, type StockMovement } from '@kite/shared';
import { Badge, Button, Card } from '@/components/ui/core';
import { EmptyState, PageHeader, Pagination, Table, TableSkeleton, Td, Th, Tr } from '@/components/ui/data';
import { FilterSelect } from '@/components/ui/inputs';
import { Input } from '@/components/ui/core';
import { ProductPicker } from '@/components/product-picker';
import { api, downloadFile } from '@/lib/api';
import { dateTime } from '@/lib/utils';


const LABELS: Record<string, string> = {
  OPENING: 'Opening',
  PURCHASE_RECEIPT: 'Received',
  ADJUSTMENT_IN: 'Adjusted +',
  ADJUSTMENT_OUT: 'Adjusted −',
  DAMAGED: 'Damaged',
  LOST: 'Lost',
  COUNT_CORRECTION: 'Count correction',
  SALE: 'Sale',
  SALE_RETURN: 'Return',
  VOID_RESTORE: 'Void restore',
  TRANSFER_IN: 'Transfer in',
  TRANSFER_OUT: 'Transfer out',
};

function refLink(m: StockMovement) {
  if (!m.referenceNumber && !m.referenceId) return '—';
  if ((m.referenceType === 'INVOICE' || m.referenceType === 'VOID') && m.referenceId) {
    return (
      <Link href={`/bills/${m.referenceId}`} className="text-brand-600 hover:underline">
        {m.referenceNumber ?? 'Bill'}
      </Link>
    );
  }
  if (m.referenceType === 'PURCHASE' && m.referenceId) {
    return (
      <Link href={`/purchases?open=${m.referenceId}`} className="text-brand-600 hover:underline">
        {m.referenceNumber}
      </Link>
    );
  }
  return <span className="text-ink-700">{m.referenceNumber ?? m.referenceType}</span>;
}

function Movements() {
  const sp = useSearchParams();
  const [product, setProduct] = useState<{ id: string; name: string } | null>(sp.get('productId') ? { id: sp.get('productId')!, name: 'Selected product' } : null);
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const params = { productId: product?.id, type, from, to, page, pageSize: 50 };
  const list = useQuery({ queryKey: ['inventory', 'movements', params], queryFn: () => api.inventory.movements(params), placeholderData: (p) => p });
  const productName = list.data?.data[0] && product && product.name === 'Selected product' ? list.data.data[0].productName : product?.name;

  return (
    <div>
      <PageHeader
        title="Stock history"
        description="The permanent ledger of every stock change: who, when, why and the balance before and after."
        actions={
          <Button variant="secondary" onClick={() => downloadFile('/reports/stock-movements', 'stock-movements.csv', { format: 'csv', from: from || undefined, to: to || undefined, productId: product?.id })}>
            Export summary
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 p-4">
          {product ? (
            <Badge tone="brand" className="h-10 px-3 text-sm">
              {productName}
              <button className="ml-2" onClick={() => (setProduct(null), setPage(1))} aria-label="Clear product filter">
                ×
              </button>
            </Badge>
          ) : (
            <ProductPicker onPick={(p) => (setProduct({ id: p.id, name: p.name }), setPage(1))} className="w-full sm:w-72" placeholder="Filter by product" />
          )}
          <FilterSelect value={type} onChange={(v) => (setType(v), setPage(1))} placeholder="All movement types" options={STOCK_MOVEMENT_TYPES.filter((t) => !t.startsWith('TRANSFER')).map((t) => ({ value: t, label: LABELS[t] }))} />
          <Input type="date" className="h-10 w-40" value={from} onChange={(e) => (setFrom(e.target.value), setPage(1))} aria-label="From date" />
          <Input type="date" className="h-10 w-40" value={to} onChange={(e) => (setTo(e.target.value), setPage(1))} aria-label="To date" />
        </div>
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Product</Th>
              <Th>Type</Th>
              <Th align="right">Change</Th>
              <Th align="right">Before</Th>
              <Th align="right">After</Th>
              <Th>Reference</Th>
              <Th>Reason</Th>
              <Th>By</Th>
            </tr>
          </thead>
          {list.isLoading ? (
            <TableSkeleton cols={9} />
          ) : (
            <tbody>
              {list.data?.data.map((m) => (
                <Tr key={m.id}>
                  <Td className="whitespace-nowrap text-xs">{dateTime(m.createdAt)}</Td>
                  <Td>
                    <div className="font-medium text-ink-900">{m.productName}</div>
                    <div className="text-xs text-ink-500">{m.sku}</div>
                  </Td>
                  <Td>
                    <Badge tone={m.quantityChange > 0 ? 'green' : m.movementType === 'SALE' ? 'blue' : 'amber'}>{LABELS[m.movementType]}</Badge>
                  </Td>
                  <Td align="right" className={m.quantityChange > 0 ? 'font-semibold text-green-700' : 'font-semibold text-red-600'}>
                    {m.quantityChange > 0 ? `+${m.quantityChange}` : m.quantityChange}
                  </Td>
                  <Td align="right" className="text-ink-500">{m.previousQuantity}</Td>
                  <Td align="right" className="font-medium">{m.newQuantity}</Td>
                  <Td className="text-xs">{refLink(m)}</Td>
                  <Td className="max-w-56 truncate text-xs text-ink-500" >{m.reason ?? '—'}</Td>
                  <Td className="text-xs">{m.createdBy?.fullName ?? 'System'}</Td>
                </Tr>
              ))}
            </tbody>
          )}
        </Table>
        {list.data?.data.length === 0 && <EmptyState title="No stock movements" />}
        {list.data && <Pagination page={page} pageSize={50} total={list.data.meta.total} onPage={setPage} />}
      </Card>
    </div>
  );
}

export default function MovementsPage() {
  return (
    <Suspense>
      <Movements />
    </Suspense>
  );
}
