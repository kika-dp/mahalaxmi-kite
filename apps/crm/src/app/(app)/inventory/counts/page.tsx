'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus } from 'lucide-react';
import { Badge, Button, Card, Input } from '@/components/ui/core';
import { EmptyState, PageHeader, Pagination, Table, TableSkeleton, Td, Th, Tr } from '@/components/ui/data';
import { Dialog } from '@/components/ui/overlay';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/utils';

export default function CountsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const list = useQuery({ queryKey: ['counts', page], queryFn: () => api.inventory.counts({ page, pageSize: 25 }) });
  const create = useMutation({
    mutationFn: () => api.inventory.openCount(notes || undefined),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['counts'] });
      router.push(`/inventory/counts/${c.id}`);
    },
  });
  return (
    <div>
      <PageHeader
        title="Physical stock counts"
        description="Count shelves, compare with the system and correct differences in one step."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> Start a count
          </Button>
        }
      />
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Count</Th>
              <Th>Started</Th>
              <Th>By</Th>
              <Th align="right">Items counted</Th>
              <Th align="right">Net variance</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          {list.isLoading ? (
            <TableSkeleton cols={6} />
          ) : (
            <tbody>
              {list.data?.data.map((c) => (
                <Tr key={c.id} onClick={() => router.push(`/inventory/counts/${c.id}`)}>
                  <Td className="font-medium text-ink-900">{c.countNumber}</Td>
                  <Td>{dateTime(c.createdAt)}</Td>
                  <Td>{c.createdBy.fullName}</Td>
                  <Td align="right">{c.itemCount}</Td>
                  <Td align="right" className={(c.totalVariance ?? 0) < 0 ? 'text-red-600' : (c.totalVariance ?? 0) > 0 ? 'text-green-700' : ''}>
                    {(c.totalVariance ?? 0) > 0 ? '+' : ''}
                    {c.totalVariance ?? 0}
                  </Td>
                  <Td>
                    <Badge tone={c.status === 'OPEN' ? 'amber' : c.status === 'COMPLETED' ? 'green' : 'neutral'}>{c.status.toLowerCase()}</Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          )}
        </Table>
        {list.data?.data.length === 0 && <EmptyState icon={<ClipboardList className="size-6" />} title="No stock counts yet" description="Run a count at the end of the day to catch differences early." />}
        {list.data && <Pagination page={page} pageSize={25} total={list.data.meta.total} onPage={setPage} />}
      </Card>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Start a stock count"
        footer={
          <Button onClick={() => create.mutate()} loading={create.isPending}>
            Start
          </Button>
        }
      >
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (e.g. Evening count, front shelves)" aria-label="Notes" />
      </Dialog>
    </div>
  );
}
