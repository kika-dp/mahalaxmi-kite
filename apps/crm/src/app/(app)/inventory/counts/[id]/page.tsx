'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card, Input, Skeleton } from '@/components/ui/core';
import { EmptyState, PageHeader, Table, Td, Th, Tr } from '@/components/ui/data';
import { SearchInput } from '@/components/ui/inputs';
import { ConfirmDialog } from '@/components/ui/overlay';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/utils';

export default function CountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<'complete' | 'cancel' | null>(null);
  const count = useQuery({ queryKey: ['count', id], queryFn: () => api.inventory.count(id) });
  const stock = useQuery({ queryKey: ['inventory', 'list', 'count', q], queryFn: () => api.inventory.list({ q, pageSize: 200 }) });
  const open = count.data?.status === 'OPEN';
  useEffect(() => setEntries({}), [count.data?.status]);

  const save = useMutation({
    mutationFn: () =>
      api.inventory.recordCount(
        id,
        Object.entries(entries)
          .filter(([, v]) => v !== '' && Number.isInteger(Number(v)) && Number(v) >= 0)
          .map(([productId, v]) => ({ productId, countedQuantity: Number(v) })),
      ),
    onSuccess: (c) => {
      qc.setQueryData(['count', id], c);
      setEntries({});
      toast.success('Counts saved');
    },
  });
  const finish = useMutation({
    mutationFn: () => (confirm === 'complete' ? api.inventory.completeCount(id) : api.inventory.cancelCount(id)),
    onSuccess: (c) => {
      qc.setQueryData(['count', id], c);
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['counts'] });
      toast.success(c.status === 'COMPLETED' ? 'Stock corrected to match the count' : 'Count cancelled');
      setConfirm(null);
    },
  });

  if (count.isLoading) return <Skeleton className="h-96" />;
  if (!count.data) return <EmptyState title="Count not found" />;
  const c = count.data;
  const counted = new Map((c.items ?? []).map((i) => [i.productId, i]));
  const variances = (c.items ?? []).filter((i) => i.variance !== 0);

  return (
    <div className="space-y-6">
      <PageHeader
        back={
          <Link href="/inventory/counts" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900">
            <ArrowLeft className="size-4" /> Stock counts
          </Link>
        }
        title={c.countNumber}
        description={`${c.notes ? `${c.notes} · ` : ''}Started ${dateTime(c.createdAt)} by ${c.createdBy.fullName}`}
        actions={
          open ? (
            <>
              <Button variant="secondary" onClick={() => setConfirm('cancel')}>
                Cancel count
              </Button>
              <Button variant="secondary" onClick={() => save.mutate()} loading={save.isPending} disabled={!Object.keys(entries).length}>
                <Save /> Save {Object.keys(entries).length || ''} counts
              </Button>
              <Button onClick={() => setConfirm('complete')} disabled={!c.itemCount || Object.keys(entries).length > 0}>
                Complete & correct stock
              </Button>
            </>
          ) : (
            <Badge tone={c.status === 'COMPLETED' ? 'green' : 'neutral'} className="text-sm">
              {c.status.toLowerCase()} {c.completedAt && `· ${dateTime(c.completedAt)}`}
            </Badge>
          )
        }
      />
      {variances.length > 0 && (
        <Card className="p-4 text-sm">
          <span className="font-medium">{variances.length} items differ</span> · net variance{' '}
          <span className={`tnum font-semibold ${(c.totalVariance ?? 0) < 0 ? 'text-red-600' : 'text-green-700'}`}>{c.totalVariance}</span> units. Completing applies each difference to current stock (sales made after counting are kept).
        </Card>
      )}
      <Card>
        {open && (
          <div className="border-b border-ink-100 p-4">
            <SearchInput value={q} onChange={setQ} placeholder="Find product to count" className="w-full sm:w-80" />
          </div>
        )}
        <Table>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th align="right">System now</Th>
              <Th align="right">System at count</Th>
              <Th align="right">Counted</Th>
              <Th align="right">Variance</Th>
              {open && <Th align="right">Enter count</Th>}
            </tr>
          </thead>
          <tbody>
            {(open ? stock.data?.data ?? [] : []).map((r) => {
              const it = counted.get(r.productId);
              return (
                <Tr key={r.productId}>
                  <Td>
                    <div className="font-medium text-ink-900">{r.name}</div>
                    <div className="text-xs text-ink-500">{r.sku}</div>
                  </Td>
                  <Td align="right">{r.quantity}</Td>
                  <Td align="right" className="text-ink-500">{it?.systemQuantity ?? '—'}</Td>
                  <Td align="right">{it?.countedQuantity ?? '—'}</Td>
                  <Td align="right" className={it && it.variance < 0 ? 'text-red-600' : it && it.variance > 0 ? 'text-green-700' : ''}>
                    {it ? (it.variance > 0 ? `+${it.variance}` : it.variance) : '—'}
                  </Td>
                  <Td align="right">
                    <Input
                      type="number"
                      min={0}
                      className="ml-auto h-8 w-24 text-right"
                      value={entries[r.productId] ?? ''}
                      onChange={(e) => setEntries((m) => ({ ...m, [r.productId]: e.target.value }))}
                      aria-label={`Counted quantity for ${r.name}`}
                    />
                  </Td>
                </Tr>
              );
            })}
            {!open &&
              (c.items ?? []).map((i) => (
                <Tr key={i.productId}>
                  <Td>
                    <div className="font-medium text-ink-900">{i.productName}</div>
                    <div className="text-xs text-ink-500">{i.sku}</div>
                  </Td>
                  <Td align="right">{i.currentQuantity}</Td>
                  <Td align="right" className="text-ink-500">{i.systemQuantity}</Td>
                  <Td align="right">{i.countedQuantity}</Td>
                  <Td align="right" className={i.variance < 0 ? 'text-red-600' : i.variance > 0 ? 'text-green-700' : ''}>
                    {i.variance > 0 ? `+${i.variance}` : i.variance}
                  </Td>
                </Tr>
              ))}
          </tbody>
        </Table>
      </Card>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'complete' ? 'Complete this count?' : 'Cancel this count?'}
        description={confirm === 'complete' ? `Stock will be corrected for ${variances.length} item(s). This is recorded in the stock ledger and cannot be undone.` : 'No stock will change.'}
        confirmLabel={confirm === 'complete' ? 'Complete & correct' : 'Cancel count'}
        tone={confirm === 'complete' ? 'primary' : 'danger'}
        loading={finish.isPending}
        onConfirm={() => finish.mutate()}
      />
    </div>
  );
}
