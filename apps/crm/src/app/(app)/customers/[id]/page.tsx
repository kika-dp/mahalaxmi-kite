'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, FileText, HandCoins } from 'lucide-react';
import { toast } from 'sonner';
import {
  addDays,
  customerFormSchema,
  istDateString,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  paiseToDecimalString,
  tryRupeesToPaise,
  type CustomerForm,
  type PaymentMethod,
} from '@kite/shared';
import { Button, Card, CardHeader, Field, Input, Skeleton, Textarea } from '@/components/ui/core';
import { EmptyState, KpiCard, PageHeader, Pagination, PaymentStatusBadge, Table, Td, Th, Tr } from '@/components/ui/data';
import { MoneyInput } from '@/components/ui/inputs';
import { Dialog } from '@/components/ui/overlay';
import { api, downloadFile } from '@/lib/api';
import { date, dateTime, inr } from '@/lib/utils';

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [collect, setCollect] = useState(false);
  const [statement, setStatement] = useState(false);
  const customer = useQuery({ queryKey: ['customer', id], queryFn: () => api.customers.get(id) });
  const invoices = useQuery({ queryKey: ['customer', id, 'invoices', page], queryFn: () => api.customers.invoices(id, { page, pageSize: 20 }) });
  const form = useForm<CustomerForm>({ resolver: zodResolver(customerFormSchema) });
  useEffect(() => {
    if (customer.data) form.reset({ name: customer.data.name, phone: customer.data.phone ?? '', address: customer.data.address ?? '', notes: customer.data.notes ?? '' });
  }, [customer.data, form]);
  const save = useMutation({
    mutationFn: (v: CustomerForm) => api.customers.update(id, { name: v.name, phone: v.phone || null, address: v.address || null, notes: v.notes || null }),
    onSuccess: (c) => (qc.setQueryData(['customer', id], c), toast.success('Saved')),
  });

  if (customer.isLoading) return <Skeleton className="h-96" />;
  if (!customer.data) return <EmptyState title="Customer not found" />;
  const c = customer.data;

  return (
    <div className="space-y-6">
      <PageHeader
        back={
          <Link href="/customers" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900">
            <ArrowLeft className="size-4" /> Customers
          </Link>
        }
        title={c.name}
        description={`${c.phone ?? 'No mobile'} · customer since ${date(c.createdAt)}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setStatement(true)}>
              <FileText /> Statement
            </Button>
            {c.outstandingPaise > 0 && (
              <Button onClick={() => setCollect(true)}>
                <HandCoins /> Collect payment
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Outstanding" value={inr(c.outstandingPaise)} tone={c.outstandingPaise ? 'red' : 'green'} />
        <KpiCard label="Total spent" value={inr(c.totalSpentPaise)} tone="brand" />
        <KpiCard label="Bills" value={c.invoiceCount} />
        <KpiCard label="Last purchase" value={<span className="text-base">{date(c.lastPurchaseAt)}</span>} />
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Purchase history" />
          <Table>
            <thead>
              <tr>
                <Th>Bill</Th>
                <Th>Date</Th>
                <Th align="right">Total</Th>
                <Th align="right">Due</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {invoices.data?.data.map((b) => (
                <Tr key={b.id} onClick={() => router.push(`/bills/${b.id}`)}>
                  <Td className="font-medium text-ink-900">{b.invoiceNumber}</Td>
                  <Td className="text-xs">{dateTime(b.createdAt)}</Td>
                  <Td align="right">{inr(b.totalPaise)}</Td>
                  <Td align="right" className={b.outstandingPaise ? 'text-red-600' : 'text-ink-400'}>{b.outstandingPaise ? inr(b.outstandingPaise) : '—'}</Td>
                  <Td>
                    <PaymentStatusBadge status={b.paymentStatus} invoiceStatus={b.status} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {invoices.data?.data.length === 0 && <EmptyState title="No bills yet" />}
          {invoices.data && <Pagination page={page} pageSize={20} total={invoices.data.meta.total} onPage={setPage} />}
        </Card>
        <Card>
          <CardHeader title="Details" />
          <form className="space-y-4 p-5" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
            <Field label="Name" error={form.formState.errors.name?.message}>
              <Input {...form.register('name')} />
            </Field>
            <Field label="Mobile" error={form.formState.errors.phone?.message}>
              <Input {...form.register('phone')} inputMode="tel" />
            </Field>
            <Field label="Address">
              <Textarea {...form.register('address')} rows={2} />
            </Field>
            <Field label="Notes">
              <Textarea {...form.register('notes')} rows={2} />
            </Field>
            <Button type="submit" variant="secondary" loading={save.isPending} disabled={!form.formState.isDirty}>
              Save details
            </Button>
          </form>
        </Card>
      </div>
      <CollectDialog open={collect} onClose={() => setCollect(false)} customerId={id} outstanding={c.outstandingPaise} />
      <StatementDialog open={statement} onClose={() => setStatement(false)} customerId={id} name={c.name} />
    </div>
  );
}

function CollectDialog({ open, onClose, customerId, outstanding }: { open: boolean; onClose: () => void; customerId: string; outstanding: number }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const paise = tryRupeesToPaise(amount || paiseToDecimalString(outstanding));
  const run = useMutation({
    mutationFn: () => api.customers.collect(customerId, { idempotencyKey: key, amountPaise: paise!, method }),
    onSuccess: (r) => {
      toast.success(`Collected across ${r.allocations.length} bill(s): ${r.allocations.map((a) => a.invoiceNumber).join(', ')}`);
      qc.invalidateQueries({ queryKey: ['customer', customerId] });
      qc.invalidateQueries({ queryKey: ['bills'] });
      setKey(crypto.randomUUID());
      setAmount('');
      onClose();
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Collect payment"
      description={`Applied to the oldest bills first. ${inr(outstanding)} outstanding.`}
      footer={
        <Button onClick={() => run.mutate()} loading={run.isPending} disabled={!paise || paise > outstanding}>
          Collect {paise ? inr(paise) : ''}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Amount" error={paise && paise > outstanding ? 'More than outstanding' : undefined}>
          <MoneyInput value={amount} placeholder={paiseToDecimalString(outstanding)} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-4 gap-2">
          {PAYMENT_METHODS.map((m) => (
            <button key={m} type="button" onClick={() => setMethod(m)} className={`cursor-pointer rounded-lg border px-2 py-2 text-sm font-medium ${method === m ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink-200'}`}>
              {PAYMENT_METHOD_LABELS[m]}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

function StatementDialog({ open, onClose, customerId, name }: { open: boolean; onClose: () => void; customerId: string; name: string }) {
  const [from, setFrom] = useState(addDays(istDateString(), -90));
  const [to, setTo] = useState(istDateString());
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Customer statement"
      description="Bills, returns and payments with a running balance."
      footer={
        <Button onClick={() => downloadFile(`/customers/${customerId}/statement.pdf`, `statement-${name}.pdf`, { from, to }).then(onClose)}>
          <FileText /> Download PDF
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
