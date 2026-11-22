'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Permission } from '@kite/shared';
import { Card, CardHeader, Skeleton } from '@/components/ui/core';
import { EmptyState, Pagination, Table, Td, Th, Tr } from '@/components/ui/data';
import { ProductFormView } from '@/components/product-form';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime, inr } from '@/lib/utils';

export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const product = useQuery({ queryKey: ['product', id], queryFn: () => api.catalog.product(id) });
  const sales = useQuery({ queryKey: ['product-sales', id, page], queryFn: () => api.catalog.sales(id, { page, pageSize: 10 }), enabled: can(Permission.REPORTS_FINANCIAL) });

  if (product.isLoading) return <Skeleton className="h-96" />;
  if (!product.data) return <EmptyState title="Product not found" />;
  return (
    <div className="space-y-6">
      <ProductFormView key={product.data.updatedAt} product={product.data} />
      {can(Permission.REPORTS_FINANCIAL) && (
        <Card>
          <CardHeader title="Sales history" description="Every bill that included this product" />
          <Table>
            <thead>
              <tr>
                <Th>Bill</Th>
                <Th>Date</Th>
                <Th>Salesperson</Th>
                <Th align="right">Qty</Th>
                <Th align="right">Rate</Th>
                <Th align="right">Line total</Th>
              </tr>
            </thead>
            <tbody>
              {sales.data?.data.map((r) => {
                const row = r as { invoiceId: string; invoiceNumber: string; status: string; createdAt: string; salesperson: string; quantity: number; returnedQuantity: number; unitPricePaise: number; lineTotalPaise: number };
                return (
                  <Tr key={`${row.invoiceId}-${row.quantity}-${row.lineTotalPaise}`}>
                    <Td>
                      <Link className="font-medium text-brand-600 hover:underline" href={`/bills/${row.invoiceId}`}>
                        {row.invoiceNumber}
                      </Link>
                      {row.status === 'VOID' && <span className="ml-2 text-xs text-ink-400">void</span>}
                    </Td>
                    <Td>{dateTime(row.createdAt)}</Td>
                    <Td>{row.salesperson}</Td>
                    <Td align="right">
                      {row.quantity}
                      {row.returnedQuantity > 0 && <span className="text-xs text-ink-400"> ({row.returnedQuantity} ret.)</span>}
                    </Td>
                    <Td align="right">{inr(row.unitPricePaise)}</Td>
                    <Td align="right">{inr(row.lineTotalPaise)}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          {sales.data && sales.data.data.length === 0 && <EmptyState title="Not sold yet" />}
          {sales.data && <Pagination page={page} pageSize={10} total={sales.data.meta.total} onPage={setPage} />}
        </Card>
      )}
    </div>
  );
}
