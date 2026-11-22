'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { customerFormSchema, type CustomerForm } from '@kite/shared';
import { Button, Card, Field, Input, Textarea } from '@/components/ui/core';
import { EmptyState, PageHeader, Pagination, Table, TableSkeleton, Td, Th, Tr } from '@/components/ui/data';
import { SearchInput } from '@/components/ui/inputs';
import { Dialog } from '@/components/ui/overlay';
import { api } from '@/lib/api';
import { date, inr } from '@/lib/utils';

export default function CustomersPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [due, setDue] = useState(false);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const params = { q, hasOutstanding: due || undefined, page, pageSize: 25 };
  const list = useQuery({ queryKey: ['customers', params], queryFn: () => api.customers.list(params), placeholderData: (p) => p });
  const form = useForm<CustomerForm>({ resolver: zodResolver(customerFormSchema), defaultValues: { name: '', phone: '', address: '', notes: '' } });
  const create = useMutation({
    mutationFn: (v: CustomerForm) => api.customers.create({ name: v.name, phone: v.phone || null, address: v.address || null, notes: v.notes || null }),
    onSuccess: (c) => {
      toast.success('Customer added');
      qc.invalidateQueries({ queryKey: ['customers'] });
      setOpen(false);
      router.push(`/customers/${c.id}`);
    },
  });
  return (
    <div>
      <PageHeader
        title="Customers"
        description="Regulars and credit customers. Walk-in cash sales don't need a customer record."
        actions={
          <Button onClick={() => (form.reset(), setOpen(true))}>
            <Plus /> Add customer
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 p-4">
          <SearchInput value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Name or mobile number" className="w-full sm:w-72" />
          <label className="flex items-center gap-2 text-sm text-ink-600">
            <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={due} onChange={(e) => (setDue(e.target.checked), setPage(1))} /> Only with dues
          </label>
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Customer</Th>
              <Th>Mobile</Th>
              <Th align="right">Bills</Th>
              <Th align="right">Total spent</Th>
              <Th align="right">Outstanding</Th>
              <Th>Last purchase</Th>
            </tr>
          </thead>
          {list.isLoading ? (
            <TableSkeleton cols={6} />
          ) : (
            <tbody>
              {list.data?.data.map((c) => (
                <Tr key={c.id} onClick={() => router.push(`/customers/${c.id}`)}>
                  <Td className="font-medium text-ink-900">{c.name}</Td>
                  <Td>{c.phone ?? '—'}</Td>
                  <Td align="right">{c.invoiceCount}</Td>
                  <Td align="right">{inr(c.totalSpentPaise)}</Td>
                  <Td align="right" className={c.outstandingPaise > 0 ? 'font-semibold text-red-600' : 'text-ink-400'}>{c.outstandingPaise ? inr(c.outstandingPaise) : '—'}</Td>
                  <Td className="text-xs">{date(c.lastPurchaseAt)}</Td>
                </Tr>
              ))}
            </tbody>
          )}
        </Table>
        {list.data?.data.length === 0 && <EmptyState icon={<Users className="size-6" />} title="No customers found" />}
        {list.data && <Pagination page={page} pageSize={25} total={list.data.meta.total} onPage={setPage} />}
      </Card>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Add customer"
        footer={
          <Button onClick={form.handleSubmit((v) => create.mutate(v))} loading={create.isPending}>
            Save
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="Name" error={form.formState.errors.name?.message}>
            <Input {...form.register('name')} autoFocus />
          </Field>
          <Field label="Mobile number" error={form.formState.errors.phone?.message}>
            <Input {...form.register('phone')} inputMode="tel" placeholder="98765 43210" />
          </Field>
          <Field label="Address (optional)">
            <Textarea {...form.register('address')} rows={2} />
          </Field>
          <Field label="Notes (optional)">
            <Input {...form.register('notes')} />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
