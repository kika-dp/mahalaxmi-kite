'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { supplierFormSchema, type SupplierForm } from '@kite/shared';
import { Badge, Button, Card, Field, Input, Textarea } from '@/components/ui/core';
import { EmptyState, PageHeader, Pagination, Table, TableSkeleton, Td, Th, Tr } from '@/components/ui/data';
import { SearchInput } from '@/components/ui/inputs';
import { Dialog } from '@/components/ui/overlay';
import { api } from '@/lib/api';
import { inr } from '@/lib/utils';

export default function SuppliersPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const list = useQuery({ queryKey: ['suppliers', q, page], queryFn: () => api.suppliers.list({ q, page, pageSize: 25 }) });
  const form = useForm<SupplierForm>({ resolver: zodResolver(supplierFormSchema), defaultValues: { name: '', phone: '', address: '', notes: '' } });
  const create = useMutation({
    mutationFn: (v: SupplierForm) => api.suppliers.create({ name: v.name, phone: v.phone || null, address: v.address || null, notes: v.notes || null }),
    onSuccess: () => (toast.success('Supplier added'), qc.invalidateQueries({ queryKey: ['suppliers'] }), setOpen(false)),
  });
  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Who you buy from and what you owe them. Supplier dues are tracked separately from customer dues."
        actions={
          <Button onClick={() => (form.reset(), setOpen(true))}>
            <Plus /> Add supplier
          </Button>
        }
      />
      <Card>
        <div className="border-b border-ink-100 p-4">
          <SearchInput value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Search suppliers" className="w-full sm:w-72" />
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Supplier</Th>
              <Th>Phone</Th>
              <Th align="right">Purchased</Th>
              <Th align="right">Paid</Th>
              <Th align="right">You owe</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          {list.isLoading ? (
            <TableSkeleton cols={6} />
          ) : (
            <tbody>
              {list.data?.data.map((s) => (
                <Tr key={s.id} onClick={() => router.push(`/suppliers/${s.id}`)}>
                  <Td className="font-medium text-ink-900">{s.name}</Td>
                  <Td>{s.phone ?? '—'}</Td>
                  <Td align="right">{inr(s.totalPurchasedPaise)}</Td>
                  <Td align="right">{inr(s.totalPaidPaise)}</Td>
                  <Td align="right" className={s.balancePaise > 0 ? 'font-semibold text-red-600' : 'text-ink-400'}>{s.balancePaise ? inr(s.balancePaise) : '—'}</Td>
                  <Td>{s.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                </Tr>
              ))}
            </tbody>
          )}
        </Table>
        {list.data?.data.length === 0 && <EmptyState icon={<Truck className="size-6" />} title="No suppliers yet" />}
        {list.data && <Pagination page={page} pageSize={25} total={list.data.meta.total} onPage={setPage} />}
      </Card>
      <Dialog open={open} onOpenChange={setOpen} title="Add supplier" footer={<Button onClick={form.handleSubmit((v) => create.mutate(v))} loading={create.isPending}>Save</Button>}>
        <div className="space-y-4">
          <Field label="Name" error={form.formState.errors.name?.message}>
            <Input {...form.register('name')} autoFocus />
          </Field>
          <Field label="Phone" error={form.formState.errors.phone?.message}>
            <Input {...form.register('phone')} inputMode="tel" />
          </Field>
          <Field label="Address">
            <Textarea {...form.register('address')} rows={2} />
          </Field>
          <Field label="Notes">
            <Input {...form.register('notes')} />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
