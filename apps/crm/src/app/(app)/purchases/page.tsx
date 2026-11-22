'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus, ShoppingCart } from 'lucide-react';
import { Button, Card } from '@/components/ui/core';
import { EmptyState, PageHeader, Pagination, Table, TableSkeleton, Td, Th, Tr } from '@/components/ui/data';
import { FilterSelect } from '@/components/ui/inputs';
import { Dialog } from '@/components/ui/overlay';
import { api } from '@/lib/api';
import { date, dateTime, inr } from '@/lib/utils';

function Purchases() {
  const sp = useSearchParams();
  const [supplierId, setSupplierId] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(sp.get('open'));
  const suppliers = useQuery({ queryKey: ['suppliers', 'all'], queryFn: () => api.suppliers.list({ pageSize: 200 }) });
  const list = useQuery({ queryKey: ['purchases', supplierId, page], queryFn: () => api.suppliers.purchases({ supplierId, page, pageSize: 25 }) });
  const detail = useQuery({ queryKey: ['purchase', openId], queryFn: () => api.suppliers.purchase(openId!), enabled: !!openId });
  return (
    <div>
      <PageHeader
        title="Purchases"
        description="Stock bought from suppliers. Saving a purchase adds the stock immediately."
        actions={
          <Button asChild>
            <Link href="/purchases/new">
              <Plus /> New purchase
            </Link>
          </Button>
        }
      />
      <Card>
        <div className="border-b border-ink-100 p-4">
          <FilterSelect value={supplierId} onChange={(v) => (setSupplierId(v), setPage(1))} placeholder="All suppliers" options={(suppliers.data?.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Purchase</Th>
              <Th>Date</Th>
              <Th>Supplier</Th>
              <Th align="right">Lines</Th>
              <Th align="right">Total</Th>
              <Th align="right">Paid</Th>
              <Th align="right">Balance</Th>
              <Th>By</Th>
            </tr>
          </thead>
          {list.isLoading ? (
            <TableSkeleton cols={8} />
          ) : (
            <tbody>
              {list.data?.data.map((p) => (
                <Tr key={p.id} onClick={() => setOpenId(p.id)}>
                  <Td className="font-medium text-ink-900">{p.purchaseNumber}</Td>
                  <Td>{date(p.purchaseDate)}</Td>
                  <Td>{p.supplierName ?? '—'}</Td>
                  <Td align="right">{p.itemCount}</Td>
                  <Td align="right">{inr(p.subtotalPaise)}</Td>
                  <Td align="right">{inr(p.amountPaidPaise)}</Td>
                  <Td align="right" className={p.balancePaise ? 'text-red-600' : 'text-ink-400'}>{p.balancePaise ? inr(p.balancePaise) : '—'}</Td>
                  <Td className="text-xs">{p.createdBy.fullName}</Td>
                </Tr>
              ))}
            </tbody>
          )}
        </Table>
        {list.data?.data.length === 0 && <EmptyState icon={<ShoppingCart className="size-6" />} title="No purchases yet" />}
        {list.data && <Pagination page={page} pageSize={25} total={list.data.meta.total} onPage={setPage} />}
      </Card>
      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)} title={detail.data?.purchaseNumber ?? 'Purchase'} description={detail.data && `${detail.data.supplierName ?? 'No supplier'} · ${date(detail.data.purchaseDate)} · recorded ${dateTime(detail.data.createdAt)} by ${detail.data.createdBy.fullName}`} size="lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-500">
              <th className="pb-2">Product</th>
              <th className="pb-2 text-right">Qty</th>
              <th className="pb-2 text-right">Unit cost</th>
              <th className="pb-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {detail.data?.items?.map((i) => (
              <tr key={i.id} className="border-t border-ink-100">
                <td className="py-2">{i.productName}</td>
                <td className="py-2 text-right tnum">{i.quantity}</td>
                <td className="py-2 text-right tnum">{inr(i.unitCostPaise)}</td>
                <td className="py-2 text-right tnum">{inr(i.lineTotalPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {detail.data?.notes && <p className="mt-3 text-sm text-ink-500">{detail.data.notes}</p>}
      </Dialog>
    </div>
  );
}

export default function PurchasesPage() {
  return (
    <Suspense>
      <Purchases />
    </Suspense>
  );
}
