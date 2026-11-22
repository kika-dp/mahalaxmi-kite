'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Permission, type StockAdjustment } from '@kite/shared';
import { Badge, Button, Card, CardHeader, Input } from '@/components/ui/core';
import { EmptyState, PageHeader, Pagination, Table, TableSkeleton, Td, Th, Tr } from '@/components/ui/data';
import { FilterSelect } from '@/components/ui/inputs';
import { Dialog } from '@/components/ui/overlay';
import { AdjustDialog } from '@/components/adjust-dialog';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime } from '@/lib/utils';

const TYPE: Record<string, string> = { ADJUSTMENT_IN: 'Added', ADJUSTMENT_OUT: 'Removed', DAMAGED: 'Damaged', LOST: 'Lost' };
const STATUS_TONE = { PENDING: 'amber', APPLIED: 'green', REJECTED: 'neutral' } as const;

export default function AdjustmentsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [decide, setDecide] = useState<{ adj: StockAdjustment; approve: boolean } | null>(null);
  const [note, setNote] = useState('');
  const approver = can(Permission.INVENTORY_APPROVE);

  const pending = useQuery({ queryKey: ['adjustments', 'pending'], queryFn: () => api.inventory.adjustments({ status: 'PENDING', pageSize: 100 }) });
  const params = { status, page, pageSize: 25 };
  const list = useQuery({ queryKey: ['adjustments', 'list', params], queryFn: () => api.inventory.adjustments(params), placeholderData: (p) => p });

  const act = useMutation({
    mutationFn: () => (decide!.approve ? api.inventory.approve(decide!.adj.id, note || undefined) : api.inventory.reject(decide!.adj.id, note || undefined)),
    onSuccess: () => {
      toast.success(decide!.approve ? 'Approved and applied' : 'Rejected');
      setDecide(null);
      setNote('');
      qc.invalidateQueries({ queryKey: ['adjustments'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });

  const row = (a: StockAdjustment, actions: boolean) => (
    <Tr key={a.id}>
      <Td className="whitespace-nowrap text-xs">{dateTime(a.createdAt)}</Td>
      <Td>
        <div className="font-medium text-ink-900">{a.productName}</div>
        <div className="text-xs text-ink-500">{a.sku}</div>
      </Td>
      <Td>{TYPE[a.adjustmentType]}</Td>
      <Td align="right" className="font-semibold">
        {a.adjustmentType === 'ADJUSTMENT_IN' ? '+' : '−'}
        {a.quantity}
      </Td>
      <Td className="max-w-64 text-sm">{a.reason}</Td>
      <Td className="text-xs">{a.requestedBy.fullName}</Td>
      <Td>
        <Badge tone={STATUS_TONE[a.status]}>{a.status.toLowerCase()}</Badge>
        {a.decidedBy && <div className="mt-0.5 text-[11px] text-ink-400">by {a.decidedBy.fullName}</div>}
      </Td>
      {actions && (
        <Td align="right">
          <div className="flex justify-end gap-1">
            <Button size="sm" onClick={() => setDecide({ adj: a, approve: true })}>
              <Check /> Approve
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setDecide({ adj: a, approve: false })}>
              <X /> Reject
            </Button>
          </div>
        </Td>
      )}
    </Tr>
  );

  const head = (actions: boolean) => (
    <thead>
      <tr>
        <Th>Requested</Th>
        <Th>Product</Th>
        <Th>Type</Th>
        <Th align="right">Qty</Th>
        <Th>Reason</Th>
        <Th>By</Th>
        <Th>Status</Th>
        {actions && <Th />}
      </tr>
    </thead>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock adjustments"
        description="Damaged, lost and corrected stock — every change needs a reason."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> New adjustment
          </Button>
        }
      />
      {(pending.data?.data.length ?? 0) > 0 && (
        <Card className="border-amber-200">
          <CardHeader title={`Waiting for approval (${pending.data!.data.length})`} description={approver ? 'Stock changes only after you approve.' : 'An admin must approve these before stock changes.'} />
          <Table>
            {head(approver)}
            <tbody>{pending.data!.data.map((a) => row(a, approver))}</tbody>
          </Table>
        </Card>
      )}
      <Card>
        <div className="flex gap-2 border-b border-ink-100 p-4">
          <FilterSelect value={status} onChange={(v) => (setStatus(v), setPage(1))} placeholder="All statuses" options={[{ value: 'APPLIED', label: 'Applied' }, { value: 'PENDING', label: 'Pending' }, { value: 'REJECTED', label: 'Rejected' }]} />
        </div>
        <Table>
          {head(false)}
          {list.isLoading ? <TableSkeleton cols={7} /> : <tbody>{list.data?.data.map((a) => row(a, false))}</tbody>}
        </Table>
        {list.data?.data.length === 0 && <EmptyState title="No adjustments yet" />}
        {list.data && <Pagination page={page} pageSize={25} total={list.data.meta.total} onPage={setPage} />}
      </Card>
      <AdjustDialog open={open} onOpenChange={setOpen} />
      <Dialog
        open={!!decide}
        onOpenChange={(o) => !o && setDecide(null)}
        title={decide?.approve ? 'Approve adjustment' : 'Reject adjustment'}
        description={decide && `${TYPE[decide.adj.adjustmentType]} ${decide.adj.quantity} × ${decide.adj.productName} — “${decide.adj.reason}”`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDecide(null)}>
              Cancel
            </Button>
            <Button variant={decide?.approve ? 'primary' : 'danger'} onClick={() => act.mutate()} loading={act.isPending}>
              {decide?.approve ? 'Approve & apply' : 'Reject'}
            </Button>
          </>
        }
      >
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Decision note" />
      </Dialog>
    </div>
  );
}
