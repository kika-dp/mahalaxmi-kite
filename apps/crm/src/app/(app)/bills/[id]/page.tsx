'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Download, FileText, HandCoins, Printer, RotateCcw, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  paiseToDecimalString,
  Permission,
  tryRupeesToPaise,
  UNIT_LABELS,
  type Invoice,
  type PaymentMethod,
} from '@kite/shared';
import { Badge, Button, Card, CardHeader, Field, Input, Select, Skeleton, Textarea } from '@/components/ui/core';
import { EmptyState, PageHeader, PaymentStatusBadge, Table, Td, Th, Tr } from '@/components/ui/data';
import { MoneyInput } from '@/components/ui/inputs';
import { ConfirmDialog, Dialog, Menu } from '@/components/ui/overlay';
import { api, downloadFile, printPdf } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime, inr } from '@/lib/utils';

const uuid = () => crypto.randomUUID();

export default function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const qc = useQueryClient();
  const bill = useQuery({ queryKey: ['bill', id], queryFn: () => api.invoices.get(id) });
  const [dialog, setDialog] = useState<'pay' | 'return' | 'refund' | 'void' | null>(null);
  const onDone = (inv: Invoice, msg: string) => {
    qc.setQueryData(['bill', id], inv);
    qc.invalidateQueries({ queryKey: ['bills'] });
    qc.invalidateQueries({ queryKey: ['dash'] });
    qc.invalidateQueries({ queryKey: ['inventory'] });
    toast.success(msg);
    setDialog(null);
  };

  if (bill.isLoading) return <Skeleton className="h-[32rem]" />;
  if (!bill.data) return <EmptyState title="Bill not found" />;
  const b = bill.data;
  const active = b.status === 'FINALIZED';
  const pdf = (format: 'a4' | 'thermal') => api.invoices.pdfPath(b.id, format);

  return (
    <div className="space-y-6">
      <PageHeader
        back={
          <Link href="/bills" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900">
            <ArrowLeft className="size-4" /> Bills
          </Link>
        }
        title={b.invoiceNumber}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {dateTime(b.createdAt)} · by {b.salesperson.fullName}
            <PaymentStatusBadge status={b.paymentStatus} invoiceStatus={b.status} />
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => downloadFile(pdf('a4'), `${b.invoiceNumber}.pdf`, undefined, true)}>
              <FileText /> View PDF
            </Button>
            <Button variant="secondary" onClick={() => printPdf(pdf('a4')).catch((e) => toast.error(e.message))}>
              <Printer /> Print
            </Button>
            <Menu
              trigger={
                <Button variant="secondary">
                  <Download /> Download
                </Button>
              }
              items={[
                { label: 'A4 invoice (PDF)', onSelect: () => downloadFile(pdf('a4'), `${b.invoiceNumber}.pdf`) },
                { label: 'Thermal 80 mm (PDF)', onSelect: () => downloadFile(pdf('thermal'), `${b.invoiceNumber}-thermal.pdf`) },
              ]}
            />
            {active && b.outstandingPaise > 0 && can(Permission.PAYMENTS_RECORD) && (
              <Button onClick={() => setDialog('pay')}>
                <HandCoins /> Record payment
              </Button>
            )}
            {active && (can(Permission.INVOICES_RETURN) || can(Permission.INVOICES_VOID)) && (
              <Menu
                trigger={<Button variant="secondary">More</Button>}
                items={[
                  { label: 'Return items', icon: <Undo2 />, onSelect: () => setDialog('return'), hidden: !can(Permission.INVOICES_RETURN) || b.items.every((i) => i.returnedQuantity >= i.quantity) },
                  { label: 'Refund money', icon: <RotateCcw />, onSelect: () => setDialog('refund'), hidden: !can(Permission.INVOICES_REFUND) || b.amountPaidPaise - b.amountRefundedPaise <= 0 },
                  'sep',
                  { label: 'Void bill', icon: <Ban />, onSelect: () => setDialog('void'), danger: true, hidden: !can(Permission.INVOICES_VOID) },
                ]}
              />
            )}
          </>
        }
      />

      {b.status === 'VOID' && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Voided {dateTime(b.voidedAt)} by {b.voidedBy?.fullName}: “{b.voidReason}”. Stock was restored and received money refunded.
        </div>
      )}
      {b.creditDuePaise > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          The customer is owed {inr(b.creditDuePaise)} after returns. Use “Refund money” to record the payout.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Items" />
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Item</Th>
                <Th align="right">Qty</Th>
                <Th align="right">Rate</Th>
                <Th align="right">Item discount</Th>
                <Th align="right">Bill discount share</Th>
                <Th align="right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {b.items.map((it) => (
                <Tr key={it.id}>
                  <Td className="text-ink-400">{it.lineNo}</Td>
                  <Td>
                    <div className="font-medium text-ink-900">{it.productName}</div>
                    <div className="text-xs text-ink-500">
                      {it.sku}
                      {it.components && it.components.length > 0 && ` · contains ${it.components.map((c) => `${c.quantityPerUnit}× ${c.productName}`).join(', ')}`}
                    </div>
                    {it.note && <div className="text-xs italic text-ink-500">“{it.note}”</div>}
                    {it.returnedQuantity > 0 && <Badge tone="amber" className="mt-1">{it.returnedQuantity} returned</Badge>}
                  </Td>
                  <Td align="right">
                    {it.quantity} {UNIT_LABELS[it.unitType]}
                  </Td>
                  <Td align="right">{inr(it.unitPricePaise)}</Td>
                  <Td align="right" className="text-ink-500">{it.lineDiscountPaise ? `−${inr(it.lineDiscountPaise)}` : '—'}</Td>
                  <Td align="right" className="text-ink-500">{it.billDiscountAllocPaise ? `−${inr(it.billDiscountAllocPaise)}` : '—'}</Td>
                  <Td align="right" className="font-medium">{inr(it.lineTotalPaise)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Totals" />
            <dl className="space-y-2 p-5 text-sm">
              {[
                ['Subtotal', inr(b.grossSubtotalPaise)],
                b.lineDiscountTotalPaise ? ['Item discounts', `−${inr(b.lineDiscountTotalPaise)}`] : null,
                b.billDiscountPaise ? [`Bill discount${b.billDiscountType === 'PERCENT' ? ` (${b.billDiscountValue / 100}%)` : ''}`, `−${inr(b.billDiscountPaise)}`] : null,
                b.taxPaise ? [`Tax @ ${b.taxRateBps / 100}%`, inr(b.taxPaise)] : null,
              ]
                .filter(Boolean)
                .map((r) => (
                  <div key={r![0]} className="flex justify-between">
                    <dt className="text-ink-500">{r![0]}</dt>
                    <dd className="tnum">{r![1]}</dd>
                  </div>
                ))}
              <div className="flex justify-between border-t border-ink-100 pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd className="tnum">{inr(b.totalPaise)}</dd>
              </div>
              {b.returnedAmountPaise > 0 && (
                <div className="flex justify-between text-amber-700">
                  <dt>Returned</dt>
                  <dd className="tnum">−{inr(b.returnedAmountPaise)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-ink-500">Received</dt>
                <dd className="tnum">{inr(b.amountPaidPaise)}</dd>
              </div>
              {b.amountRefundedPaise > 0 && (
                <div className="flex justify-between">
                  <dt className="text-ink-500">Refunded</dt>
                  <dd className="tnum">−{inr(b.amountRefundedPaise)}</dd>
                </div>
              )}
              <div className={`flex justify-between text-base font-semibold ${b.outstandingPaise > 0 ? 'text-red-600' : 'text-green-700'}`}>
                <dt>Balance due</dt>
                <dd className="tnum">{inr(b.outstandingPaise)}</dd>
              </div>
              {b.costTotalPaise !== undefined && b.status === 'FINALIZED' && (
                <div className="flex justify-between border-t border-ink-100 pt-2 text-xs text-ink-500">
                  <dt>Est. gross profit</dt>
                  <dd className="tnum">{inr(b.totalPaise - b.taxPaise - b.costTotalPaise)}</dd>
                </div>
              )}
              {b.discountTotalPaise > 0 && (
                <p className="pt-2 text-xs text-ink-500">
                  Discount by {b.discountAppliedBy?.fullName}
                  {b.discountApprovedBy && `, approved by ${b.discountApprovedBy.fullName}`}
                  {b.discountReason && ` — “${b.discountReason}”`}
                </p>
              )}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Customer" />
            <div className="p-5 text-sm">
              {b.customerName ? (
                <>
                  <p className="font-medium">{b.customerName}</p>
                  {b.customerPhone && <p className="text-ink-500">{b.customerPhone}</p>}
                  {b.customerId && (
                    <Link href={`/customers/${b.customerId}`} className="mt-2 inline-block text-brand-600 hover:underline">
                      Customer history →
                    </Link>
                  )}
                </>
              ) : (
                <p className="text-ink-500">Walk-in customer</p>
              )}
              {b.notes && <p className="mt-3 rounded-lg bg-ink-50 p-2 text-xs">Note: {b.notes}</p>}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Payments" description="Each payment is a permanent record" />
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Type</Th>
                <Th>Method</Th>
                <Th align="right">Amount</Th>
                <Th>By</Th>
              </tr>
            </thead>
            <tbody>
              {b.payments.map((p) => (
                <Tr key={p.id}>
                  <Td className="text-xs">{dateTime(p.createdAt)}</Td>
                  <Td>{p.direction === 'IN' ? <Badge tone="green">Received</Badge> : <Badge tone="amber">Refund</Badge>}</Td>
                  <Td>
                    {PAYMENT_METHOD_LABELS[p.method]}
                    {p.reference && <div className="text-xs text-ink-500">{p.reference}</div>}
                  </Td>
                  <Td align="right" className="font-medium">{p.direction === 'OUT' ? '−' : ''}{inr(p.amountPaise)}</Td>
                  <Td className="text-xs">{p.receivedBy.fullName}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {b.payments.length === 0 && <EmptyState title="No payments yet" />}
        </Card>

        <Card>
          <CardHeader title="Returns & stock" />
          <div className="divide-y divide-ink-100">
            {b.returns.map((r) => (
              <div key={r.id} className="px-5 py-3 text-sm">
                <div className="flex justify-between">
                  <span className="font-medium">{r.returnNumber}</span>
                  <span className="tnum">−{inr(r.totalPaise)}</span>
                </div>
                <p className="text-xs text-ink-500">
                  {dateTime(r.createdAt)} · {r.createdBy.fullName} · “{r.reason}”
                </p>
                <p className="mt-1 text-xs">{r.items.map((i) => `${i.quantity}× ${i.productName}${i.restocked ? '' : ' (not restocked)'}`).join(', ')}</p>
              </div>
            ))}
            {(b.stockMovements ?? []).map((m) => (
              <div key={m.id} className="flex justify-between px-5 py-2 text-xs">
                <span>
                  {m.productName} · {m.movementType.replace('_', ' ').toLowerCase()}
                </span>
                <span className={`tnum ${m.quantityChange < 0 ? 'text-red-600' : 'text-green-700'}`}>
                  {m.quantityChange > 0 ? '+' : ''}
                  {m.quantityChange} → {m.newQuantity}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {b.auditTrail && b.auditTrail.length > 0 && (
        <Card>
          <CardHeader title="Activity" />
          <ol className="space-y-3 p-5">
            {b.auditTrail.map((a) => (
              <li key={a.id} className="flex gap-3 text-sm">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500" />
                <span>
                  <span className="font-medium">{a.action.replaceAll('_', ' ').toLowerCase()}</span>
                  <span className="text-ink-500"> · {a.actorUsername ?? 'system'} · {dateTime(a.createdAt)}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <PayDialog open={dialog === 'pay'} onClose={() => setDialog(null)} bill={b} onDone={onDone} />
      <ReturnDialog open={dialog === 'return'} onClose={() => setDialog(null)} bill={b} onDone={onDone} />
      <RefundDialog open={dialog === 'refund'} onClose={() => setDialog(null)} bill={b} onDone={onDone} />
      <VoidDialog open={dialog === 'void'} onClose={() => setDialog(null)} bill={b} onDone={onDone} />
    </div>
  );
}

type DProps = { open: boolean; onClose: () => void; bill: Invoice; onDone: (inv: Invoice, msg: string) => void };

function MethodPicker({ value, onChange }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {PAYMENT_METHODS.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={`cursor-pointer rounded-lg border px-2 py-2 text-sm font-medium ${value === m ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-700 hover:bg-ink-50'}`}
        >
          {PAYMENT_METHOD_LABELS[m]}
        </button>
      ))}
    </div>
  );
}

function PayDialog({ open, onClose, bill, onDone }: DProps) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [reference, setReference] = useState('');
  // A fresh idempotency key per payment attempt: retries of the SAME attempt reuse it, a new payment never does.
  const [key, setKey] = useState(uuid);
  useEffect(() => {
    if (open) {
      setKey(uuid());
      setAmount('');
      setReference('');
    }
  }, [open]);
  const paise = tryRupeesToPaise(amount || paiseToDecimalString(bill.outstandingPaise));
  const pay = useMutation({
    mutationFn: () => api.invoices.pay(bill.id, { idempotencyKey: key, payments: [{ method, amountPaise: paise!, reference: reference || undefined }] }),
    onSuccess: (r) => onDone(r.data, 'Payment recorded'),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Record payment"
      description={`${inr(bill.outstandingPaise)} outstanding on ${bill.invoiceNumber}. Stock is not affected.`}
      footer={
        <Button onClick={() => pay.mutate()} loading={pay.isPending} disabled={!paise || paise > bill.outstandingPaise}>
          Record {paise ? inr(paise) : ''}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Amount received" error={paise && paise > bill.outstandingPaise ? 'More than the amount due' : undefined}>
          <MoneyInput value={amount} placeholder={paiseToDecimalString(bill.outstandingPaise)} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label="Method">
          <MethodPicker value={method} onChange={setMethod} />
        </Field>
        {method !== 'CASH' && (
          <Field label="Reference (UPI / card txn id)">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

function ReturnDialog({ open, onClose, bill, onDone }: DProps) {
  const [qty, setQty] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const lines = bill.items
    .map((i) => ({ i, q: Number(qty[i.id] || 0) }))
    .filter(({ i, q }) => q > 0 && q <= i.quantity - i.returnedQuantity);
  const estimate = lines.reduce((s, { i, q }) => s + Math.round((i.lineTotalPaise * q) / i.quantity), 0);
  const netPaid = bill.amountPaidPaise - bill.amountRefundedPaise;
  const owedAfter = bill.totalPaise - bill.returnedAmountPaise - estimate;
  const refundable = Math.max(0, netPaid - owedAfter);
  const save = useMutation({
    mutationFn: () =>
      api.invoices.returnItems(bill.id, {
        reason,
        items: lines.map(({ i, q }) => ({ invoiceItemId: i.id, quantity: q, restock: restock[i.id] ?? true })),
        refund: refund && refundable > 0 ? { method, amountPaise: refundable } : null,
      }),
    onSuccess: (inv) => onDone(inv, 'Return recorded'),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Return items"
      description="Restocked items go back into inventory. The bill total is reduced by the value returned."
      size="lg"
      footer={
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!lines.length || reason.trim().length < 3}>
          Record return
        </Button>
      }
    >
      <div className="space-y-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-500">
              <th className="pb-2">Item</th>
              <th className="pb-2 text-right">Returnable</th>
              <th className="pb-2 text-right">Qty</th>
              <th className="pb-2 text-center">Restock</th>
            </tr>
          </thead>
          <tbody>
            {bill.items.map((i) => {
              const left = i.quantity - i.returnedQuantity;
              return (
                <tr key={i.id} className="border-t border-ink-100">
                  <td className="py-2">{i.productName}</td>
                  <td className="py-2 text-right tnum">{left}</td>
                  <td className="py-2 text-right">
                    <Input type="number" min={0} max={left} disabled={left === 0} className="ml-auto h-8 w-20 text-right" value={qty[i.id] ?? ''} onChange={(e) => setQty((m) => ({ ...m, [i.id]: e.target.value }))} aria-label={`Return quantity for ${i.productName}`} />
                  </td>
                  <td className="py-2 text-center">
                    <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={restock[i.id] ?? true} onChange={(e) => setRestock((m) => ({ ...m, [i.id]: e.target.checked }))} aria-label={`Restock ${i.productName}`} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Field label="Reason">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Torn kites returned next morning" />
        </Field>
        <div className="rounded-xl bg-ink-50 p-3 text-sm">
          Return value ≈ <span className="tnum font-semibold">{inr(estimate)}</span>
          {refundable > 0 && (
            <label className="mt-2 flex items-center gap-2">
              <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={refund} onChange={(e) => setRefund(e.target.checked)} />
              Refund {inr(refundable)} to the customer now
            </label>
          )}
          {refund && refundable > 0 && (
            <div className="mt-2">
              <MethodPicker value={method} onChange={setMethod} />
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function RefundDialog({ open, onClose, bill, onDone }: DProps) {
  const max = bill.amountPaidPaise - bill.amountRefundedPaise;
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [reason, setReason] = useState('');
  const paise = tryRupeesToPaise(amount);
  const save = useMutation({ mutationFn: () => api.invoices.refund(bill.id, { method, amountPaise: paise!, reason }), onSuccess: (inv) => onDone(inv, 'Refund recorded') });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Refund money"
      description={`Up to ${inr(max)} received on this bill can be refunded. Use this to correct a mistaken payment or pay back credit after a return.`}
      footer={
        <Button variant="danger" onClick={() => save.mutate()} loading={save.isPending} disabled={!paise || paise > max || reason.trim().length < 3}>
          Refund {paise ? inr(paise) : ''}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Amount" error={paise && paise > max ? 'More than received' : undefined}>
          <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={paiseToDecimalString(bill.creditDuePaise || max)} />
        </Field>
        <Field label="Method">
          <MethodPicker value={method} onChange={setMethod} />
        </Field>
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function VoidDialog({ open, onClose, bill, onDone }: DProps) {
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const netPaid = bill.amountPaidPaise - bill.amountRefundedPaise;
  const units = bill.items.reduce((s, i) => s + i.quantity - i.returnedQuantity, 0);
  const save = useMutation({ mutationFn: () => api.invoices.void(bill.id, { reason, refundMethod: netPaid > 0 ? method : undefined }), onSuccess: (inv) => onDone(inv, 'Bill voided') });
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={`Void ${bill.invoiceNumber}?`}
      description={
        <>
          {units} item(s) will be put back into stock{netPaid > 0 ? ` and ${inr(netPaid)} refunded` : ''}. The bill keeps its number and is excluded from sales. <strong>This cannot be undone.</strong>
        </>
      }
      confirmLabel="Void bill"
      loading={save.isPending}
      onConfirm={() => (reason.trim().length >= 3 ? save.mutate() : toast.error('Enter a reason'))}
    >
      <div className="space-y-3">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" aria-label="Void reason" />
        {netPaid > 0 && (
          <Field label="Refund method">
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </ConfirmDialog>
  );
}
