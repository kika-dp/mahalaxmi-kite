'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, PackagePlus } from 'lucide-react';
import { Permission, type InventoryRow } from '@kite/shared';
import { Badge, Button, Card } from '@/components/ui/core';
import { EmptyState, PageHeader, Table, TableSkeleton, Td, Th, Tr } from '@/components/ui/data';
import { ReceiveDialog } from '@/components/receive-dialog';
import { api, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date } from '@/lib/utils';

export default function LowStockPage() {
  const { can } = useAuth();
  const [row, setRow] = useState<InventoryRow | null>(null);
  const list = useQuery({ queryKey: ['inventory', 'low'], queryFn: () => api.inventory.lowStock(), refetchInterval: 60_000 });
  const rows = [...(list.data ?? [])].sort((a, b) => a.quantity / Math.max(1, a.minStockAlert) - b.quantity / Math.max(1, b.minStockAlert));
  return (
    <div>
      <PageHeader
        title="Low stock"
        description="Items at or below their alert level, most urgent first."
        actions={
          <Button variant="secondary" onClick={() => downloadFile('/reports/low-stock', 'low-stock.csv', { format: 'csv' })}>
            Export CSV
          </Button>
        }
      />
      {rows.length > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="size-4" />
          {rows.filter((r) => r.quantity === 0).length} out of stock, {rows.filter((r) => r.quantity > 0).length} running low.
        </div>
      )}
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th>Category</Th>
              <Th align="right">In stock</Th>
              <Th align="right">Alert at</Th>
              <Th align="right">Shortfall</Th>
              <Th>Last sold</Th>
              <Th />
            </tr>
          </thead>
          {list.isLoading ? (
            <TableSkeleton cols={7} />
          ) : (
            <tbody>
              {rows.map((r) => (
                <Tr key={r.productId}>
                  <Td>
                    <div className="font-medium text-ink-900">{r.name}</div>
                    <div className="text-xs text-ink-500">{r.sku}</div>
                  </Td>
                  <Td>{r.categoryName}</Td>
                  <Td align="right">
                    <Badge tone={r.quantity === 0 ? 'red' : 'amber'}>{r.quantity}</Badge>
                  </Td>
                  <Td align="right">{r.minStockAlert}</Td>
                  <Td align="right" className="font-medium">{Math.max(0, r.minStockAlert - r.quantity)}</Td>
                  <Td className="text-xs text-ink-500">{date(r.lastSaleAt)}</Td>
                  <Td align="right">
                    {can(Permission.INVENTORY_RECEIVE) && (
                      <Button size="sm" onClick={() => setRow(r)}>
                        <PackagePlus /> Receive
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          )}
        </Table>
        {list.data?.length === 0 && <EmptyState title="Nothing is running low" description="All products are above their alert levels." />}
      </Card>
      <ReceiveDialog open={!!row} onOpenChange={(o) => !o && setRow(null)} initial={row ? { id: row.productId, name: row.name, sku: row.sku, availableQuantity: row.quantity, purchasePricePaise: row.purchasePricePaise } : undefined} />
    </div>
  );
}
