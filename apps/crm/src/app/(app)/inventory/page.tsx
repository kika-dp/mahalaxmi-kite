'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Boxes, PackagePlus, SlidersHorizontal } from 'lucide-react';
import { Permission, type InventoryRow } from '@kite/shared';
import { Button, Card } from '@/components/ui/core';
import { EmptyState, KpiCard, PageHeader, Pagination, StockBadge, Table, TableSkeleton, Td, Th, Tr } from '@/components/ui/data';
import { FilterSelect, SearchInput } from '@/components/ui/inputs';
import { ReceiveDialog } from '@/components/receive-dialog';
import { AdjustDialog } from '@/components/adjust-dialog';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, inr, num } from '@/lib/utils';

export default function InventoryPage() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [stock, setStock] = useState('');
  const [page, setPage] = useState(1);
  const [receive, setReceive] = useState<{ open: boolean; row?: InventoryRow }>({ open: false });
  const [adjust, setAdjust] = useState<{ open: boolean; row?: InventoryRow }>({ open: false });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.catalog.categories() });
  const summary = useQuery({ queryKey: ['inventory', 'summary'], queryFn: () => api.inventory.summary() });
  const params = { q, categoryId, stock, page, pageSize: 25 };
  const list = useQuery({ queryKey: ['inventory', 'list', params], queryFn: () => api.inventory.list(params), placeholderData: (p) => p });
  const cost = can(Permission.CATALOG_VIEW_COST);
  const s = summary.data;

  return (
    <div>
      <PageHeader
        title="Stock"
        description="Live stock of single items. Packets and combos draw from these."
        actions={
          <>
            {can(Permission.INVENTORY_ADJUST) && (
              <Button variant="secondary" onClick={() => setAdjust({ open: true })}>
                <SlidersHorizontal /> Adjust stock
              </Button>
            )}
            {can(Permission.INVENTORY_RECEIVE) && (
              <Button onClick={() => setReceive({ open: true })}>
                <PackagePlus /> Receive stock
              </Button>
            )}
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard loading={!s} label="Products" value={num(s?.standardProducts)} sub={`${num(s?.totalUnits)} units`} icon={<Boxes />} />
        <KpiCard loading={!s} label="Low stock" value={num(s?.lowStock)} sub={`${num(s?.outOfStock)} out of stock`} tone="amber" />
        {cost && <KpiCard loading={!s} label="Value at cost" value={inr(s?.costValuePaise)} tone="green" />}
        <KpiCard loading={!s} label="Value at selling price" value={inr(s?.retailValuePaise)} tone="brand" />
      </div>
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-ink-100 p-4">
          <SearchInput value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Search name or SKU" className="w-full sm:w-72" />
          <FilterSelect value={categoryId} onChange={(v) => (setCategoryId(v), setPage(1))} placeholder="All categories" options={(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
          <FilterSelect value={stock} onChange={(v) => (setStock(v), setPage(1))} placeholder="Any stock level" options={[{ value: 'in', label: 'In stock' }, { value: 'low', label: 'Low stock' }, { value: 'out', label: 'Out of stock' }]} />
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th>Category</Th>
              <Th align="right">In stock</Th>
              <Th align="right">Alert at</Th>
              {cost && <Th align="right">Cost value</Th>}
              <Th align="right">Retail value</Th>
              <Th>Last received</Th>
              <Th>Last sold</Th>
              <Th />
            </tr>
          </thead>
          {list.isLoading ? (
            <TableSkeleton cols={9} />
          ) : (
            <tbody>
              {list.data?.data.map((r) => (
                <Tr key={r.productId}>
                  <Td>
                    <Link href={`/inventory/movements?productId=${r.productId}`} className="font-medium text-ink-900 hover:text-brand-600">
                      {r.name}
                    </Link>
                    <div className="text-xs text-ink-500">{r.sku}</div>
                  </Td>
                  <Td>{r.categoryName}</Td>
                  <Td align="right">
                    <StockBadge quantity={r.quantity} min={r.minStockAlert} />
                  </Td>
                  <Td align="right" className="text-ink-500">{r.minStockAlert}</Td>
                  {cost && <Td align="right">{inr(r.costValuePaise)}</Td>}
                  <Td align="right">{inr(r.retailValuePaise)}</Td>
                  <Td className="text-xs text-ink-500">{date(r.lastReceiptAt)}</Td>
                  <Td className="text-xs text-ink-500">{date(r.lastSaleAt)}</Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1">
                      {can(Permission.INVENTORY_RECEIVE) && (
                        <Button size="sm" variant="secondary" onClick={() => setReceive({ open: true, row: r })}>
                          Receive
                        </Button>
                      )}
                      {can(Permission.INVENTORY_ADJUST) && (
                        <Button size="sm" variant="ghost" onClick={() => setAdjust({ open: true, row: r })}>
                          Adjust
                        </Button>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          )}
        </Table>
        {list.data?.data.length === 0 && <EmptyState title="No stock items match" />}
        {list.data && <Pagination page={page} pageSize={25} total={list.data.meta.total} onPage={setPage} />}
      </Card>
      <ReceiveDialog
        open={receive.open}
        onOpenChange={(o) => setReceive({ open: o })}
        initial={receive.row ? { id: receive.row.productId, name: receive.row.name, sku: receive.row.sku, availableQuantity: receive.row.quantity, purchasePricePaise: receive.row.purchasePricePaise } : undefined}
      />
      <AdjustDialog open={adjust.open} onOpenChange={(o) => setAdjust({ open: o })} initial={adjust.row ? { id: adjust.row.productId, name: adjust.row.name, sku: adjust.row.sku, availableQuantity: adjust.row.quantity } : undefined} />
    </div>
  );
}
