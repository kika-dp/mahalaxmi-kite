'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { istDateString, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, paiseToDecimalString, tryRupeesToPaise, type PaymentMethod, type Product } from '@kite/shared';
import { Button, Card, CardHeader, Field, Input, Select, Switch, Textarea } from '@/components/ui/core';
import { PageHeader } from '@/components/ui/data';
import { MoneyInput } from '@/components/ui/inputs';
import { ProductPicker } from '@/components/product-picker';
import { api } from '@/lib/api';
import { inr } from '@/lib/utils';

interface Line {
  productId: string;
  name: string;
  sku: string;
  quantity: string;
  cost: string;
}

function NewPurchase() {
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const suppliers = useQuery({ queryKey: ['suppliers', 'all'], queryFn: () => api.suppliers.list({ pageSize: 200 }) });
  const [supplierId, setSupplierId] = useState(sp.get('supplierId') ?? '');
  const [purchaseDate, setDate] = useState(istDateString());
  const [lines, setLines] = useState<Line[]>([]);
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [notes, setNotes] = useState('');
  const [updateCost, setUpdateCost] = useState(true);

  const add = (p: Product) =>
    setLines((ls) => (ls.some((l) => l.productId === p.id) ? ls : [...ls, { productId: p.id, name: p.name, sku: p.sku, quantity: '', cost: p.purchasePricePaise !== undefined ? paiseToDecimalString(p.purchasePricePaise) : '' }]));
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (tryRupeesToPaise(l.cost) ?? 0), 0);
  const paidPaise = tryRupeesToPaise(paid) ?? 0;
  const valid = lines.length > 0 && lines.every((l) => Number.isInteger(Number(l.quantity)) && Number(l.quantity) > 0 && tryRupeesToPaise(l.cost) !== null) && paidPaise <= total && (!paidPaise || supplierId);

  const save = useMutation({
    mutationFn: () =>
      api.suppliers.createPurchase({
        supplierId: supplierId || null,
        purchaseDate,
        items: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), unitCostPaise: tryRupeesToPaise(l.cost)! })),
        amountPaidPaise: paidPaise || undefined,
        paymentMethod: paidPaise ? method : undefined,
        notes: notes || undefined,
        updateCostPrice: updateCost,
      }),
    onSuccess: (p) => {
      toast.success(`${p.purchaseNumber} saved — stock added`);
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      router.push(supplierId ? `/suppliers/${supplierId}` : '/purchases');
    },
  });

  return (
    <div>
      <PageHeader
        back={
          <Link href="/purchases" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900">
            <ArrowLeft className="size-4" /> Purchases
          </Link>
        }
        title="New purchase"
        description="Receiving a purchase adds stock right away and records it in the stock ledger."
        actions={
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!valid}>
            Save & receive stock
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Items" />
          <div className="space-y-3 p-5">
            <ProductPicker onPick={add} />
            {lines.length === 0 && <p className="text-sm text-ink-500">Search and add the products you bought.</p>}
            {lines.map((l, i) => (
              <div key={l.productId} className="grid grid-cols-[1fr_6rem_8rem_7rem_auto] items-end gap-2 border-t border-ink-100 pt-3">
                <div className="pb-2 text-sm">
                  <div className="font-medium">{l.name}</div>
                  <div className="text-xs text-ink-500">{l.sku}</div>
                </div>
                <Field label="Qty">
                  <Input type="number" min={1} value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                </Field>
                <Field label="Unit cost">
                  <MoneyInput value={l.cost} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))} />
                </Field>
                <div className="pb-2.5 text-right text-sm tnum">{inr((Number(l.quantity) || 0) * (tryRupeesToPaise(l.cost) ?? 0))}</div>
                <Button variant="ghost" size="icon" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove ${l.name}`}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <div className="flex justify-end border-t border-ink-100 pt-3 text-base font-semibold">
              Total <span className="tnum ml-6">{inr(total)}</span>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Purchase details" />
          <div className="space-y-4 p-5">
            <Field label="Supplier">
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">No supplier</option>
                {suppliers.data?.data.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Purchase date">
              <Input type="date" value={purchaseDate} max={istDateString()} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Paid now" error={paidPaise > total ? 'More than the total' : paidPaise && !supplierId ? 'Select a supplier to record a payment' : undefined} hint={total ? `Balance owed: ${inr(Math.max(0, total - paidPaise))}` : undefined}>
              <MoneyInput value={paid} onChange={(e) => setPaid(e.target.value)} />
            </Field>
            {paidPaise > 0 && (
              <Field label="Paid by">
                <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>
                <span className="font-medium">Update product cost</span>
                <span className="block text-xs text-ink-500">Use these unit costs for profit going forward</span>
              </span>
              <Switch checked={updateCost} onCheckedChange={setUpdateCost} />
            </label>
            <Field label="Notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Supplier bill no., etc." />
            </Field>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function NewPurchasePage() {
  return (
    <Suspense>
      <NewPurchase />
    </Suspense>
  );
}
