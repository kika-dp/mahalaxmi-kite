'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Banknote, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, Permission, tryRupeesToPaise, type PaymentMethod } from '@kite/shared';
import { Button, Card, CardHeader, Field, Input, Select, Skeleton } from '@/components/ui/core';
import { EmptyState, KpiCard, PageHeader, Table, Td, Th, Tr } from '@/components/ui/data';
import { MoneyInput } from '@/components/ui/inputs';
import { Dialog } from '@/components/ui/overlay';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, dateTime, inr } from '@/lib/utils';

export default function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const qc = useQueryClient();
  const [pay, setPay] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [purchaseId, setPurchaseId] = useState('');
  const [note, setNote] = useState('');
  const s = useQuery({ queryKey: ['supplier', id], queryFn: () => api.suppliers.get(id) });
  const paise = tryRupeesToPaise(amount);
  const save = useMutation({
    mutationFn: () => api.suppliers.pay(id, { amountPaise: paise!, method, purchaseId: purchaseId || undefined, note: note || undefined }),
    onSuccess: () => {
      toast.success('Supplier payment recorded');
      qc.invalidateQueries({ queryKey: ['supplier', id] });
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      setPay(false);
      setAmount('');
      setNote('');
    },
  });
  if (s.isLoading) return <Skeleton className="h-96" />;
  if (!s.data) return <EmptyState title="Supplier not found" />;
  const d = s.data;
  const openPurchases = d.purchases.filter((p) => p.balancePaise > 0);
  return (
    <div className="space-y-6">
      <PageHeader
        back={
          <Link href="/suppliers" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900">
            <ArrowLeft className="size-4" /> Suppliers
          </Link>
        }
        title={d.name}
        description={[d.phone, d.address].filter(Boolean).join(' · ') || undefined}
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href={`/purchases/new?supplierId=${id}`}>
                <Plus /> New purchase
              </Link>
            </Button>
            {can(Permission.SUPPLIERS_PAY) && d.balancePaise > 0 && (
              <Button onClick={() => setPay(true)}>
                <Banknote /> Pay supplier
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-cols-3 gap-4">
        <KpiCard label="Purchased" value={inr(d.totalPurchasedPaise)} />
        <KpiCard label="Paid" value={inr(d.totalPaidPaise)} tone="green" />
        <KpiCard label="You owe" value={inr(d.balancePaise)} tone={d.balancePaise > 0 ? 'red' : 'green'} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Purchases" />
          <Table>
            <thead>
              <tr>
                <Th>Purchase</Th>
                <Th>Date</Th>
                <Th align="right">Total</Th>
                <Th align="right">Balance</Th>
              </tr>
            </thead>
            <tbody>
              {d.purchases.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-medium">{p.purchaseNumber}</Td>
                  <Td>{date(p.purchaseDate)}</Td>
                  <Td align="right">{inr(p.subtotalPaise)}</Td>
                  <Td align="right" className={p.balancePaise ? 'text-red-600' : 'text-ink-400'}>{p.balancePaise ? inr(p.balancePaise) : 'paid'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {d.purchases.length === 0 && <EmptyState title="No purchases yet" />}
        </Card>
        <Card>
          <CardHeader title="Payments to supplier" />
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>For</Th>
                <Th>Method</Th>
                <Th align="right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {d.payments.map((p) => (
                <Tr key={p.id}>
                  <Td className="text-xs">{dateTime(p.paidAt)}</Td>
                  <Td>{p.purchaseNumber ?? 'On account'}</Td>
                  <Td>{PAYMENT_METHOD_LABELS[p.method]}</Td>
                  <Td align="right">{inr(p.amountPaise)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {d.payments.length === 0 && <EmptyState title="No payments yet" />}
        </Card>
      </div>
      <Dialog
        open={pay}
        onOpenChange={setPay}
        title="Pay supplier"
        description={`You owe ${inr(d.balancePaise)}.`}
        footer={
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!paise || paise > d.balancePaise}>
            Record payment
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="Amount">
            <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
          <Field label="Against purchase (optional)">
            <Select value={purchaseId} onChange={(e) => setPurchaseId(e.target.value)}>
              <option value="">On account</option>
              {openPurchases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.purchaseNumber} — {inr(p.balancePaise)} due
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
